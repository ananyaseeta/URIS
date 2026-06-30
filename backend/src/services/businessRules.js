/**
 * businessRules.js
 *
 * Business-level validation that goes beyond schema shape checks.
 * These rules require database lookups or domain logic that Joi cannot express.
 *
 * Each function returns a { ok: true } on success, or
 * { ok: false, status: number, message: string } on failure.
 *
 * Controllers call these AFTER Joi schema validation passes.
 */

'use strict';

const prisma = require('../utils/prisma');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given date string represents a date strictly in the future
 * (i.e. after today's date in UTC, ignoring time).
 */
function isFutureDate(dateStr) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setUTCHours(0, 0, 0, 0);
  return target > today;
}

/**
 * Returns true if the given date string represents today or a future date.
 * Used for deadlines — same-day deadlines are allowed.
 */
function isTodayOrFuture(dateStr) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setUTCHours(0, 0, 0, 0);
  return target >= today;
}

const VALID_DAYS        = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const VALID_REASON_CODES = ['Exam', 'Revision', 'Academic Project', 'Personal', 'Sprint', 'Other'];
const HH_MM_RE           = /^\d{2}:\d{2}$/;

// ── Tasks ──────────────────────────────────────────────────────────────────────

/**
 * Validates business rules for task creation.
 *
 * Checks:
 *  1. complexity is an integer 1–5
 *  2. deadline is today or a future date
 *  3. planeTaskId is not already in use
 *  4. internId references a real intern record
 */
async function validateTaskCreation({ complexity, deadline, planeTaskId, internId }) {
  // 1. complexity must be integer 1–5
  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 5) {
    return {
      ok:      false,
      status:  400,
      message: 'task_complexity must be an integer between 1 and 5',
    };
  }

  // 2. deadline must be today or in the future
  if (deadline && !isTodayOrFuture(deadline)) {
    return {
      ok:      false,
      status:  400,
      message: 'deadline must be today or a future date',
    };
  }

  // 3. planeTaskId must be unique (only checked when explicitly provided)
  if (planeTaskId) {
    const existing = await prisma.task.findUnique({ where: { planeTaskId } });
    if (existing) {
      return {
        ok:      false,
        status:  409,
        message: `A task with planeTaskId "${planeTaskId}" already exists`,
      };
    }
  }

  // 4. intern must exist
  const intern = await prisma.intern.findUnique({ where: { id: internId } });
  if (!intern) {
    return {
      ok:      false,
      status:  404,
      message: `Intern with id "${internId}" does not exist`,
    };
  }

  return { ok: true };
}

// ── Reviews ────────────────────────────────────────────────────────────────────

/**
 * Validates business rules for review submission.
 *
 * Checks:
 *  1. All scores are integers in range 1–5
 *  2. taskId references a real task
 *  3. The task must be in 'completed' status
 *  4. internId matches the task's assigned intern
 *  5. A review for this task does not already exist
 */
async function validateReviewSubmission({ taskId, internId, qualityScore, timelinessScore, independenceScore, user }) {
  const { ROLES } = require('../constants/roles');

  // 1. All scores must be integers 1–5
  const scores = { qualityScore, timelinessScore, independenceScore };
  for (const [field, value] of Object.entries(scores)) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return {
        ok:      false,
        status:  400,
        message: `${field} must be an integer between 1 and 5`,
      };
    }
  }

  // 2. Task must exist
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return {
      ok:      false,
      status:  404,
      message: `Task with id "${taskId}" does not exist`,
    };
  }

  // Role-based limited check: Operations Program Manager can only review operational tasks
  if (user && user.role === ROLES.OPERATIONS_PROGRAM_MANAGER) {
    if (!task.isOperational) {
      return {
        ok:      false,
        status:  403,
        message: 'Operations Program Manager can only review operational tasks',
      };
    }
  }

  // 3. Task must be completed
  if (task.status !== 'completed') {
    return {
      ok:      false,
      status:  422,
      message: `Cannot review a task that is not completed. Current status: "${task.status}"`,
    };
  }

  // 4. internId must match the task's assignee
  if (task.internId !== internId) {
    return {
      ok:      false,
      status:  422,
      message: 'internId does not match the intern assigned to this task',
    };
  }

  // 5. Prevent duplicate reviews for the same task
  const existingReview = await prisma.review.findFirst({ where: { taskId } });
  if (existingReview) {
    return {
      ok:      false,
      status:  409,
      message: `A review for task "${taskId}" has already been submitted`,
    };
  }

  // 6. Team scope check — leads may only review interns on their own teams.
  //    CORE_ADMIN and OPERATIONS_LEAD/OPERATIONS_PROGRAM_MANAGER have global scope.
  //    All other reviewer roles must have the task's intern in one of their teams.
  if (user) {
    const GLOBAL_REVIEW_ROLES = new Set([
      ROLES.CORE_ADMIN,
      ROLES.OPERATIONS_LEAD,
      ROLES.OPERATIONS_PROGRAM_MANAGER,
    ]);

    if (!GLOBAL_REVIEW_ROLES.has(user.role)) {
      // Resolve the reviewer's teams
      const reviewerTeams = await prisma.userTeam.findMany({
        where: { userId: user.id, leftAt: null },
        select: { teamId: true },
      });
      const reviewerTeamIds = reviewerTeams.map(t => t.teamId);

      let isInScope = false;
      if (reviewerTeamIds.length > 0) {
        // Get all interns in those teams
        const teamMembers = await prisma.userTeam.findMany({
          where: { teamId: { in: reviewerTeamIds }, leftAt: null },
          select: { userId: true },
        });
        const memberUserIds = teamMembers.map(m => m.userId);

        const teamInterns = await prisma.intern.findMany({
          where: { userId: { in: memberUserIds } },
          select: { id: true },
        });
        const teamInternIds = new Set(teamInterns.map(i => i.id));
        isInScope = teamInternIds.has(task.internId);
      }

      if (!isInScope) {
        return {
          ok:      false,
          status:  403,
          message: 'You can only review tasks assigned to interns on your team',
        };
      }
    }
  }

  return { ok: true };
}

// ── Availability ───────────────────────────────────────────────────────────────

/**
 * Validates business rules for availability submission.
 *
 * Checks:
 *  1. maxFreeBlockHours is an integer 1–6
 *  2. weekStart is a Monday
 *  3. weekEnd is exactly 7 days after weekStart
 *  4. Each busyBlock has a valid day, reason_code, and optional HH:MM times
 *  5. No duplicate day entries in busyBlocks
 *  6. If start/end times are provided, start must be before end
 */
function validateAvailabilitySubmission({ maxFreeBlockHours, weekStart, weekEnd, busyBlocks }) {
  // 1. maxFreeBlockHours must be integer 1–6
  if (!Number.isInteger(maxFreeBlockHours) || maxFreeBlockHours < 1 || maxFreeBlockHours > 6) {
    return {
      ok:      false,
      status:  400,
      message: 'maxFreeBlockHours must be an integer between 1 and 6',
    };
  }

  // 2. weekStart must be a Monday (getUTCDay() === 1)
  if (weekStart) {
    const startDate = new Date(weekStart);
    if (startDate.getUTCDay() !== 1) {
      return {
        ok:      false,
        status:  400,
        message: 'weekStart must be a Monday',
      };
    }
  }

  // 3. weekEnd must be exactly 7 days after weekStart
  if (weekStart && weekEnd) {
    const start   = new Date(weekStart);
    const end     = new Date(weekEnd);
    const diffMs  = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays !== 7) {
      return {
        ok:      false,
        status:  400,
        message: 'weekEnd must be exactly 7 days after weekStart',
      };
    }
  }

  // 4 & 5. Validate each busyBlock structure and check for duplicate days
  if (Array.isArray(busyBlocks)) {
    const seenDays = new Set();

    for (let i = 0; i < busyBlocks.length; i++) {
      const block  = busyBlocks[i];
      const prefix = `busyBlocks[${i}]`;

      if (!block.day || !VALID_DAYS.includes(block.day)) {
        return {
          ok:      false,
          status:  400,
          message: `${prefix}.day must be one of: ${VALID_DAYS.join(', ')}`,
        };
      }

      if (!block.reason_code || !VALID_REASON_CODES.includes(block.reason_code)) {
        return {
          ok:      false,
          status:  400,
          message: `${prefix}.reason_code must be one of: ${VALID_REASON_CODES.join(', ')}`,
        };
      }

      if (seenDays.has(block.day)) {
        return {
          ok:      false,
          status:  400,
          message: `Duplicate busy block for day "${block.day}". Each day may appear at most once`,
        };
      }
      seenDays.add(block.day);

      // 6. If time range provided, validate format and order
      if (block.start !== undefined || block.end !== undefined) {
        if (!HH_MM_RE.test(block.start)) {
          return {
            ok:      false,
            status:  400,
            message: `${prefix}.start must be in HH:MM format`,
          };
        }
        if (!HH_MM_RE.test(block.end)) {
          return {
            ok:      false,
            status:  400,
            message: `${prefix}.end must be in HH:MM format`,
          };
        }
        if (block.start >= block.end) {
          return {
            ok:      false,
            status:  400,
            message: `${prefix}.start must be before ${prefix}.end`,
          };
        }
      }
    }
  }

  return { ok: true };
}

// ── Assignment ─────────────────────────────────────────────────────────────────

/**
 * Maps a user's role to the permission required to assign tasks TO them.
 * Uses the governance-configurable assignment target permissions.
 */
const TARGET_ROLE_PERMISSION_MAP = {
  CORE_ADMIN:                 'CAN_ASSIGN_TO_CORE_ADMIN',
  TECHNICAL_LEAD:             'CAN_ASSIGN_TO_ADMIN',
  OPERATIONS_LEAD:            'CAN_ASSIGN_TO_ADMIN',
  RESEARCH_LEAD:              'CAN_ASSIGN_TO_ADMIN',
  OPERATIONS_PROGRAM_MANAGER: 'CAN_ASSIGN_TO_ADMIN',
  OBSERVER_TEAM_LEAD:         'CAN_ASSIGN_TO_LEAD',
  COLLABORATOR_LEAD:          'CAN_ASSIGN_TO_LEAD',
  TECHNICAL_INTERN:           'CAN_ASSIGN_TO_INTERN',
  OPERATIONS_INTERN:          'CAN_ASSIGN_TO_INTERN',
  RESEARCH_INTERN:            'CAN_ASSIGN_TO_INTERN',
  ORENDA_MEMBER:              'CAN_ASSIGN_TO_INTERN',
};

/**
 * Check whether the assigning user's role has permission to assign tasks
 * to the intern's associated user role.
 *
 * Uses live DB-backed permission overrides so Governance Access Matrix
 * changes take effect immediately.
 *
 * @param {string} assignerRole - Role of the person doing the assignment
 * @param {string} targetUserRole - Role of the user being assigned to
 * @returns {Promise<{ allowed: boolean; permission: string | null }>}
 */
async function canAssignToTargetRole(assignerRole, targetUserRole, assignerUserId) {
  const { roleHasPermissionAsync } = require('../constants/permissions');

  // If assignerUserId is provided, check if they are a CORE_ADMIN delegate
  // Delegates get full CORE_ADMIN assignment capabilities
  if (assignerUserId && assignerRole !== 'CORE_ADMIN') {
    try {
      const { isDelegate } = require('./delegationService');
      const delegated = await isDelegate(assignerUserId);
      if (delegated) {
        // Treat as CORE_ADMIN — can assign to anyone except CORE_ADMIN itself
        // (CORE_ADMIN target is still restricted for delegates by design)
        const effectiveRole = 'CORE_ADMIN';
        const permission = TARGET_ROLE_PERMISSION_MAP[targetUserRole] || 'CAN_ASSIGN_TO_INTERN';
        const allowed = await roleHasPermissionAsync(effectiveRole, permission);
        return { allowed, permission };
      }
    } catch { /* non-fatal */ }
  }

  const permission = TARGET_ROLE_PERMISSION_MAP[targetUserRole] || 'CAN_ASSIGN_TO_INTERN';
  const allowed = await roleHasPermissionAsync(assignerRole, permission);
  return { allowed, permission };
}

/**
 * Validates business rules for task assignment.
 *
 * Checks:
 *  1. intern exists in the database
 *  2. task exists in the database
 *  3. task is not already assigned to this intern (duplicate assignment)
 *  4. task is not already completed
 */
async function validateTaskAssignment({ internId, taskId, user }) {
  const { ROLES } = require('../constants/roles');
  
  // 1. Intern must exist
  const intern = await prisma.intern.findUnique({
    where: { id: internId },
    include: { user: { select: { role: true } } },
  });
  if (!intern) {
    return {
      ok:      false,
      status:  404,
      message: `Intern with id "${internId}" does not exist`,
    };
  }

  // 1b. Check assignment target permission (governance-configurable)
  if (user) {
    const targetUserRole = intern.user?.role;
    if (targetUserRole) {
      const { allowed, permission } = await canAssignToTargetRole(user.role, targetUserRole, user.id);
      if (!allowed) {
        return {
          ok:      false,
          status:  403,
          message: `You do not have permission to assign tasks to this role. (Required: ${permission})`,
        };
      }
    }
  }

  // 2. Task must exist
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return {
      ok:      false,
      status:  404,
      message: `Task with id "${taskId}" does not exist`,
    };
  }

  // Role-based limited check: Collaborator Lead can only assign collaborator-linked tasks
  if (user && user.role === ROLES.COLLABORATOR_LEAD) {
    if (!task.collaboratorIds.includes(user.id)) {
      return {
        ok:      false,
        status:  403,
        message: 'Collaborator Lead can only assign tasks they are linked to as a collaborator',
      };
    }
  }

  // 3. Prevent duplicate assignment — task already assigned to this intern
  if (task.internId === internId) {
    return {
      ok:      false,
      status:  409,
      message: `Task "${taskId}" is already assigned to intern "${internId}"`,
    };
  }

  // 4. Cannot assign a completed task
  if (task.status === 'completed') {
    return {
      ok:      false,
      status:  422,
      message: `Cannot assign a completed task`,
    };
  }

  return { ok: true, task, intern };
}

module.exports = {
  validateTaskCreation,
  validateReviewSubmission,
  validateAvailabilitySubmission,
  validateTaskAssignment,
  canAssignToTargetRole,
};
