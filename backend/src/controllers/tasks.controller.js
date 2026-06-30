const { syncTasksFromPlane, detectAndMarkStaleTasks, getTasksOverviewForAllInterns, getTaskFilter, removeTask } = require('../services/taskService');
const { generateBlockerAlerts } = require('../services/alertService');
const { validateTaskCreation }  = require('../services/businessRules');
const { ok, created, validationError, businessError, notFound, forbidden } = require('../utils/respond');
const { ROLES } = require('../constants/roles');
const prisma = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');
const { validatePagination } = require('../utils/validate');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

// ── FIX 13: Throttle cache — prevents sync/stale-detection on every page load ─
// Heavy operations (Plane sync, stale detection, blocker generation) run at most
// once per 5 minutes across all requests. Page loads just read from DB.
const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
let _lastSyncAt = 0;

async function _runBackgroundOpsIfDue() {
  const now = Date.now();
  if (now - _lastSyncAt < SYNC_THROTTLE_MS) return;
  _lastSyncAt = now; // mark immediately to prevent concurrent triggers
  try {
    await syncTasksFromPlane();
    await detectAndMarkStaleTasks();
    await generateBlockerAlerts();
    logger.info('Background task ops (sync/stale/blocker) completed');
  } catch (err) {
    _lastSyncAt = 0; // reset so next request retries
    logger.warn({ err: err.message }, 'Background task ops failed');
  }
}

async function getTasksOverview(req, res, next) {
  try {
    // FIX 13: Fire-and-forget background ops — never block the response
    _runBackgroundOpsIfDue().catch(() => {});

    const filter = await getTaskFilter(req.user);
    const overview = await getTasksOverviewForAllInterns();

    // Apply role-based intern filter to the overview
    const filteredOverview = overview.filter(item => {
      if (filter.internId && item.internId !== filter.internId) return false;
      return true;
    });

    return ok(res, filteredOverview, 'Tasks overview fetched.');
  } catch (err) {
    next(err);
  }
}

async function getTaskById(req, res, next) {
  try {
    const { taskId } = req.params;
    const { hasCollaborativeAccess } = require('../services/collaborationService');

    const filter = await getTaskFilter(req.user);
    filter.id = taskId;

    let task = await prisma.task.findFirst({
      where: filter,
      include: {
        intern: {
          select: { user: { select: { name: true, email: true } } }
        },
        collaborators: {
          include: {
            team: {
              select: {
                id: true, name: true,
                members: {
                  where: { leftAt: null },
                  include: { user: { select: { id: true, name: true, email: true, role: true } } },
                },
              },
            },
          },
        },
        observers: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
      },
    });

    // If not found via primary filter, check collaborative access
    if (!task) {
      const hasAccess = await hasCollaborativeAccess(taskId, req.user.id);
      if (!hasAccess) return notFound(res, 'Task not found or access denied');

      task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          intern: {
            select: { user: { select: { name: true, email: true } } }
          },
          collaborators: {
            include: {
              team: {
                select: {
                  id: true, name: true,
                  members: {
                    where: { leftAt: null },
                    include: { user: { select: { id: true, name: true, email: true, role: true } } },
                  },
                },
              },
            },
          },
          observers: {
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      });
      if (!task) return notFound(res, 'Task not found');
    }

    // Role-based field masking
    if (req.user.role === ROLES.OPERATIONS_LEAD || req.user.role === ROLES.OPERATIONS_PROGRAM_MANAGER) {
      delete task.complexity;
      delete task.skills;
    }

    return ok(res, task);
  } catch (err) {
    next(err);
  }
}

async function getTasks(req, res, next) {
  try {
    const filter = await getTaskFilter(req.user);
    const { status, page = 1, limit = 20 } = req.query;

    const paginationErrors = validatePagination({ page, limit, status });
    if (paginationErrors.length > 0) {
      return validationError(res, paginationErrors[0]);
    }

    // Combine role-based filter with request-based status filter
    if (status) filter.status = status.toLowerCase();

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where:   filter,
        select:  {
          id:           true,
          title:        true,
          description:  true,
          note:         true,
          status:       true,
          internId:     true,
          complexity:   true,
          progressPct:  true,
          hasBlocker:   true,
          blockerType:  true,
          skills:       true,
          deadline:     true,
          lastUpdatedAt: true,
          createdAt:    true,
          intern: {
            select: {
              user: { select: { email: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    parseInt(limit),
      }),
      prisma.task.count({ where: filter }),
    ]);

    const now        = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    // Mask fields for LIMITED roles in list view
    const tasksWithAssignee = tasks.map(t => {
      const task = {
        ...t,
        assignee:  t.intern?.user?.name || t.intern?.user?.email || null,
        deadline:  t.deadline ? t.deadline.toISOString().split('T')[0] : null,
        // isStale: not updated in DB by scheduler in all cases — compute on read
        isStale:   t.status !== 'completed' && t.lastUpdatedAt < twoDaysAgo,
        intern:    undefined,
      };

      if (req.user.role === ROLES.OPERATIONS_LEAD || req.user.role === ROLES.OPERATIONS_PROGRAM_MANAGER) {
        delete task.complexity;
      }

      return task;
    });

    logger.info({ count: tasks.length }, 'Tasks fetched');

    return ok(res, {
      tasks:      tasksWithAssignee,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    }, 'Tasks fetched');
  } catch (err) {
    next(err);
  }
}

async function createTask(req, res, next) {
  try {
    const { title, description, complexity, internId, skills = [], deadline } = req.body;

    const planeTaskId = req.body.planeTaskId?.trim() || `manual-${randomUUID()}`;

    const biz = await validateTaskCreation({ complexity, deadline, planeTaskId, internId });
    if (!biz.ok) {
      return businessError(res, biz.status, biz.message);
    }

    const task = await prisma.task.create({
      data: {
        title,
        description: description?.trim() || null,
        complexity,
        internId,
        planeTaskId,
        skills,
        status:        'active',
        progressPct:   0,
        lastUpdatedAt: new Date(),
        ...(deadline ? { deadline: new Date(deadline) } : {}),
      },
    });

    logger.info({ taskId: task.id }, 'Task created');

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.CREATE_TASK, AUDIT_ENTITIES.TASK, task.id, {
      title, internId, complexity, planeTaskId,
    });

    return created(res, task, 'Task created');
  } catch (err) {
    next(err);
  }
}

async function internUpdateTask(req, res, next) {
  try {
    const { taskId } = req.params;
    const { progressPct, note, hasBlocker, blockerType } = req.body;

    // Resolve the intern record for the authenticated user
    const intern = await prisma.intern.findUnique({
      where:   { userId: req.user.id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!intern) {
      return notFound(res, 'Intern record not found');
    }

    // Fetch the task and verify ownership
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return notFound(res, 'Task not found');
    }
    if (task.internId !== intern.id) {
      return forbidden(res, 'You can only update your own tasks');
    }
    if (task.status === 'completed') {
      return validationError(res, 'Cannot update a completed task');
    }

    const updateData = {
      progressPct,
      lastUpdatedAt: new Date(),
      ...(typeof note === 'string'         ? { note: note.trim() || null }          : {}),
      ...(typeof hasBlocker === 'boolean'  ? { hasBlocker }                         : {}),
      ...(blockerType !== undefined        ? { blockerType: hasBlocker ? blockerType : null } : {}),
    };

    const updated = await prisma.task.update({
      where: { id: taskId },
      data:  updateData,
    });

    // If intern just set a blocker, create alerts:
    // - One for the intern (first-person, reassuring)
    // - One for the admin (third-person, actionable) — stored without internId so it shows in admin feed
    if (hasBlocker && !task.hasBlocker) {
      const blockerLabel = blockerType && blockerType !== 'none'
        ? blockerType.replace(/_/g, ' ')
        : 'general blocker';

      const existingIntern = await prisma.alert.findFirst({
        where: { taskId, internId: intern.id, type: 'blocker_reported', resolved: false },
      });
      if (!existingIntern) {
        // Intern-facing alert
        await prisma.alert.create({
          data: {
            internId: intern.id,
            taskId,
            type:     'blocker_reported',
            severity: 'warning',
            message:  `You flagged a blocker on "${task.title}" (${blockerLabel}). An admin has been notified.`,
          },
        });
      }

      // Admin-facing alert — uses a different type so it shows in admin feed
      const existingAdmin = await prisma.alert.findFirst({
        where: { taskId, type: 'blocker_escalation', resolved: false },
      });
      if (!existingAdmin) {
        await prisma.alert.create({
          data: {
            internId: intern.id,   // still scoped to intern so admin can see who
            taskId,
            type:     'blocker_escalation',
            severity: 'warning',
            message:  `${intern.user?.name || intern.user?.email || 'An intern'} reported a blocker on task "${task.title}": ${blockerLabel}. Progress: ${progressPct}%.`,
          },
        });
      }
    }

    // If intern cleared a blocker, resolve any open blocker alerts for this task
    if (hasBlocker === false && task.hasBlocker) {
      await prisma.alert.updateMany({
        where: { taskId, type: 'blocker_reported', resolved: false },
        data:  { resolved: true },
      });
    }

    void logAction(req.user.id, AUDIT_ACTIONS.INTERN_UPDATE_TASK, AUDIT_ENTITIES.TASK, taskId, {
      taskId,
      internId:       intern.id,
      progressPct,
      note:           note ?? null,
      hasBlocker:     hasBlocker ?? task.hasBlocker,
      blockerType:    blockerType ?? null,
    });

    logger.info({ taskId, internId: intern.id, progressPct }, 'Intern updated task progress');

    return ok(res, {
      id:           updated.id,
      progressPct:  updated.progressPct,
      hasBlocker:   updated.hasBlocker,
      blockerType:  updated.blockerType,
      lastUpdatedAt: updated.lastUpdatedAt,
    }, 'Task progress updated');
  } catch (err) {
    next(err);
  }
}

async function deleteTask(req, res, next) {
  try {
    const { taskId } = req.params;
    const { ROLES } = require('../constants/roles');

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return notFound(res, 'Task not found');

    // CORE_ADMIN and OPERATIONS_LEAD can delete any task.
    // All other leads may only delete tasks belonging to interns on their team.
    const canDeleteAll = new Set([
      ROLES.CORE_ADMIN,
      ROLES.OPERATIONS_LEAD,
      ROLES.OPERATIONS_PROGRAM_MANAGER,
    ]);

    if (!canDeleteAll.has(req.user.role)) {
      // Resolve the requesting lead's team intern IDs (same logic as getTaskFilter)
      const leadTeams = await prisma.userTeam.findMany({
        where: { userId: req.user.id, leftAt: null },
        select: { teamId: true },
      });
      const teamIds = leadTeams.map(t => t.teamId);

      let isAuthorised = false;
      if (teamIds.length > 0) {
        const teamMembers = await prisma.userTeam.findMany({
          where: { teamId: { in: teamIds }, leftAt: null },
          select: { userId: true },
        });
        const memberUserIds = teamMembers.map(m => m.userId);

        const teamInterns = await prisma.intern.findMany({
          where: { userId: { in: memberUserIds } },
          select: { id: true },
        });
        const teamInternIds = new Set(teamInterns.map(i => i.id));
        isAuthorised = teamInternIds.has(task.internId);
      }

      if (!isAuthorised) {
        return forbidden(res, 'You can only delete tasks assigned to interns on your team');
      }
    }

    await removeTask(taskId);

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.DELETE_TASK, AUDIT_ENTITIES.TASK, taskId, {
      taskId,
      title:    task.title,
      internId: task.internId,
    });

    return ok(res, null, 'Task removed successfully');
  } catch (err) {
    next(err);
  }
}

async function updateTaskDescription(req, res, next) {
  try {
    const { taskId } = req.params;
    const { description } = req.body;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return notFound(res, 'Task not found');

    const updated = await prisma.task.update({
      where: { id: taskId },
      data:  { description: typeof description === 'string' ? description.trim() || null : null },
    });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.UPDATE_TASK, AUDIT_ENTITIES.TASK, taskId, {
      field: 'description',
    });

    return ok(res, { id: updated.id, description: updated.description }, 'Description updated.');
  } catch (err) {
    next(err);
  }
}

module.exports = { getTasksOverview, getTasks, createTask, internUpdateTask, deleteTask, getTaskById, updateTaskDescription };
