const prisma = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');
const { validateUpdateTaskStatus, isUUID } = require('../utils/validate');
const { ok, validationError, notFound } = require('../utils/respond');
const { ROLES, normalizeRole } = require('../constants/roles');
const { getTaskFilter } = require('../services/taskService');
const { invalidateCache } = require('../middleware/ipBlock.middleware');
const configStore = require('../services/configStore');
const { getCapacityLabel } = require('../services/capacityEngine');
const { getRpiWindowStart } = require('../services/performanceEngine');
const notificationService = require('../services/notification.service');
// LOW-1: imported lazily below to avoid a circular-require at startup.
// realtimeEngine depends on prisma; importing it at the top of admin.controller
// is safe but lazy import avoids any future circular issue if the dep graph grows.


// Default deadline: Monday at 11:00 AM
const DEFAULT_DEADLINE = { day: 1, hour: 11, minute: 0 }; // day: 0=Sun,1=Mon,...6=Sat

async function overrideScore(req, res, next) {
  try {
    const { internId, overrideScore } = req.body;

    if (!internId) {
      return validationError(res, 'internId is required');
    }
    if (!isUUID(internId)) {
      return validationError(res, 'internId must be a valid UUID');
    }
    if (typeof overrideScore !== 'number' || overrideScore < 0 || overrideScore > 100) {
      return validationError(res, 'overrideScore must be a number between 0 and 100');
    }

    const intern = await prisma.intern.findUnique({ where: { id: internId }, select: { overrideScore: true } });
    const previousScore = intern?.overrideScore ?? null;

    await prisma.intern.update({
      where: { id: internId },
      data:  { overrideScore },
    });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.OVERRIDE_SCORE, AUDIT_ENTITIES.SCORE, internId, {
      internId,
      previousScore,
      newScore: overrideScore,
      reason:   req.body.reason ?? null,
    });

    return ok(res, null, 'Score overridden successfully');
  } catch (err) {
    next(err);
  }
}

async function updateTaskStatus(req, res, next) {
  try {
    const { taskId, status, progress, hasBlocker, blockerType, pauseReason } = req.body;

    const errors = validateUpdateTaskStatus({ taskId, status, progress });
    if (errors.length > 0) {
      return validationError(res, errors[0]);
    }

    const existingTask = await prisma.task.findUnique({ where: { id: taskId } });
    if (!existingTask) {
      return notFound(res, 'Task not found');
    }

    await prisma.task.update({
      where: { id: taskId },
      data:  {
        status,
        lastUpdatedAt: new Date(),
        ...(typeof progress === 'number'    ? { progressPct: progress }   : {}),
        ...(typeof hasBlocker === 'boolean' ? { hasBlocker }              : {}),
        ...(blockerType !== undefined       ? { blockerType: hasBlocker ? blockerType : null } : {}),
      },
    });

    // If admin is pausing or blocking, create an alert with the reason
    if ((status === 'paused' || hasBlocker === true) && (pauseReason || blockerType)) {
      const reason = pauseReason || (blockerType ? blockerType.replace(/_/g, ' ') : 'admin action');
      const alertType = status === 'paused' ? 'task_paused' : 'blocker_reported';
      const existing = await prisma.alert.findFirst({
        where: { taskId, type: alertType, resolved: false },
      });
      if (!existing) {
        await prisma.alert.create({
          data: {
            internId: existingTask.internId,
            taskId,
            type:     alertType,
            severity: 'warning',
            message:  status === 'paused'
              ? `Admin paused task "${existingTask.title}". Reason: ${reason}.`
              : `Admin flagged blocker on task "${existingTask.title}": ${reason}.`,
          },
        });
      }
    }

    // If admin is resuming (active) or unblocking, resolve related alerts
    if (status === 'active' || hasBlocker === false) {
      await prisma.alert.updateMany({
        where: {
          taskId,
          type:     { in: ['task_paused', 'blocker_reported'] },
          resolved: false,
        },
        data: { resolved: true },
      });
    }

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.UPDATE_TASK, AUDIT_ENTITIES.TASK, taskId, {
      taskId,
      previousStatus: existingTask.status,
      newStatus:      status,
      hasBlocker:     hasBlocker ?? null,
      blockerType:    blockerType ?? null,
      pauseReason:    pauseReason ?? null,
      ...(typeof progress === 'number' ? { progressPct: progress } : {}),
    });

    return ok(res, null, `Task status updated to ${status}`);
  } catch (err) {
    next(err);
  }
}

async function getAdminOverview(req, res, next) {
  try {
    const filter = await getTaskFilter(req.user);
    
    let internFilter = {};
    // Operational alert types only — intern-personal types (task_assigned,
    // deadline_approaching, form_reminder, review_submitted, task_reminder)
    // are excluded from the admin/lead feed.
    const ADMIN_ALERT_TYPES = [
      'stale_task', 'blocker_reported', 'overload', 'low_performance',
      'low_capacity', 'spike', 'availability_reminder', 'task_paused',
      'credibility_risk', 'reassignment_recommendation',
    ];
    let alertFilter = { resolved: false, type: { in: ADMIN_ALERT_TYPES } };
    
    // Role-based filtering for leads — scoped to their own team members only.
    // Previously filtered by intern role type (e.g. all TECHNICAL_INTERNs) which
    // returned interns across all teams. Now we look up which teams the lead belongs
    // to and only return interns who are members of those same teams.
    if (
      req.user.role === ROLES.TECHNICAL_LEAD ||
      req.user.role === ROLES.RESEARCH_LEAD  ||
      req.user.role === ROLES.OPERATIONS_LEAD
    ) {
      // 1. Find the teams this lead is a member of (as 'lead' role in UserTeam)
      const leadTeams = await prisma.userTeam.findMany({
        where: { userId: req.user.id, leftAt: null },
        select: { teamId: true },
      });
      const teamIds = leadTeams.map(t => t.teamId);

      if (teamIds.length === 0) {
        // Lead has no team assignments — show nothing rather than everything
        internFilter = { id: { in: [] } };
      } else {
        // 2. Find all user IDs in those teams
        const teamMembers = await prisma.userTeam.findMany({
          where: { teamId: { in: teamIds }, leftAt: null, userId: { not: req.user.id } },
          select: { userId: true },
        });
        const memberUserIds = [...new Set(teamMembers.map(m => m.userId))];

        // 3. Map to intern records (only users who have an Intern record)
        const teamInterns = await prisma.intern.findMany({
          where: { userId: { in: memberUserIds } },
          select: { id: true },
        });
        const teamInternIds = teamInterns.map(i => i.id);

        internFilter = { id: { in: teamInternIds } };
      }

      // Scope alerts to interns in this lead's teams only
      const teamInternIdsForAlerts = internFilter.id?.in ?? [];
      alertFilter = {
        resolved: false,
        type: { in: ADMIN_ALERT_TYPES },
        internId: { in: teamInternIdsForAlerts },
      };
    } else if (req.user.role !== ROLES.CORE_ADMIN && req.user.role !== ROLES.OPERATIONS_PROGRAM_MANAGER) {
      // Other leads/admins: filter by their assigned tasks
      const allowedTasks = await prisma.task.findMany({ where: filter, select: { id: true, internId: true } });
      const allowedTaskIds = allowedTasks.map(t => t.id);
      const allowedInternIds = [...new Set(allowedTasks.map(t => t.internId))];
      
      internFilter = { id: { in: allowedInternIds } };
      // Combine the type filter with the scope filter using AND
      alertFilter = {
        resolved: false,
        type: { in: ADMIN_ALERT_TYPES },
        OR: [
          { taskId: { in: allowedTaskIds } },
          { internId: { in: allowedInternIds } },
        ],
      };
    }

    const [totalInterns, activeTasks, openAlerts, completedLast30, allInterns, alerts] = await Promise.all([
      prisma.intern.count({ where: internFilter }),
      prisma.task.count({ where: { status: 'active', ...filter } }),
      prisma.alert.count({ where: alertFilter }),
      prisma.task.count({ where: { status: 'completed', lastUpdatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, ...filter } }),
      prisma.intern.findMany({
        where: internFilter,
        take:    100,
        include: {
          user:        { select: { email: true, name: true } },
          credibility: true,
          // Rolling window — only reviews within RPI_WINDOW_DAYS contribute to RPI
          reviews: {
            where:  { createdAt: { gte: getRpiWindowStart() } },
            select: { quality: true, timeliness: true, initiative: true },
          },
          tasks: {
            where: filter,
            select: { status: true, complexity: true, progressPct: true },
          },
          // Fetch the most recent capacity score written by the new pipeline
          scoreHistory: {
            where:   { type: 'capacity' },
            orderBy: { createdAt: 'desc' },
            take:    1,
          },
        },
      }),
      prisma.alert.findMany({
        where:   alertFilter,
        orderBy: { createdAt: 'desc' },
        take:    50,
      }),
    ]);

    // Fetch today's presence data for all interns (non-fatal if unavailable)
    const { getAllInternPresence } = require('../services/presenceService');
    const { activeSet, windowMap, checkInMap } = await getAllInternPresence().catch(() => ({
      activeSet:  new Set(),
      windowMap:  new Map(),
      checkInMap: new Map(),
    }));

    const interns = allInterns.map(i => {
      const activeTasksList = i.tasks.filter(t => t.status === 'active');
      const completedTasks  = i.tasks.filter(t => t.status === 'completed');
      const totalTasks      = i.tasks.length;

      // Task Load Index — sum of (complexity × remaining work) for active tasks
      const tli = activeTasksList.reduce(
        (sum, t) => sum + t.complexity * (1 - t.progressPct / 100),
        0
      );

      // Review Performance Index — average of (quality + timeliness + initiative) / 3
      // Scaled to 0–100 from a 0–5 rating scale
      const rpi = i.reviews.length > 0
        ? parseFloat(
            (
              i.reviews.reduce((sum, r) => sum + (r.quality + r.timeliness + r.initiative) / 3, 0)
              / i.reviews.length
              * 20  // convert 0–5 → 0–100
            ).toFixed(1)
          )
        : 0;

      // Task completion percentage
      const completionPct = totalTasks > 0
        ? Math.round((completedTasks.length / totalTasks) * 100)
        : 0;

      // Capacity score — read from ScoreHistory (integer 0–100) written by the
      // new capacityEngine pipeline via saveScoreHistory.
      // Falls back to 0 if no capacity score has been computed yet.
      const latestCapacity = i.scoreHistory[0];
      const capacityScore  = latestCapacity ? Math.round(latestCapacity.score) : 0;

      // Derive the human-readable availability label from the single authoritative
      // source in capacityEngine.js — thresholds stay in sync automatically.
      const availability = latestCapacity
        ? getCapacityLabel(capacityScore)
        : 'No data';

      // Credibility score — CredibilityScore.score is a 0–1 float; multiply by
      // 100 to get the 0–100 integer the frontend expects.
      const credibilityScore = i.credibility
        ? Math.round(i.credibility.score * 100)
        : 0;

      return {
        id:            i.id,
        name:          i.user?.name || i.user?.email?.split('@')[0] || i.id,
        capacityScore,
        tli:           parseFloat(tli.toFixed(2)),
        rpi,
        credibilityScore,
        availability,
        taskCount:     totalTasks,
        activeTasks:   activeTasksList.length,
        completedTasks: completedTasks.length,
        completionPct,
        presenceStatus: activeSet.has(i.id) ? 'ONLINE' : windowMap.has(i.id) ? 'IN_SESSION' : 'OFFLINE',
        lastCheckIn:   checkInMap.get(i.id) || null,
        todayWindow:   windowMap.get(i.id)  || null,
      };
    });

    // Fetch all active UserTeams to map user -> teams
    const allUserTeams = await prisma.userTeam.findMany({
      where: { leftAt: null },
      include: { team: true }
    });

    // Map of userId -> list of team names/ids
    const userToTeams = {};
    for (const ut of allUserTeams) {
      if (!userToTeams[ut.userId]) {
        userToTeams[ut.userId] = [];
      }
      userToTeams[ut.userId].push({ id: ut.teamId, name: ut.team.name });
    }

    // Now group the mapped interns by team
    const teamStatsMap = {};
    
    for (const intern of interns) {
      const origIntern = allInterns.find(ai => ai.id === intern.id);
      const userId = origIntern?.userId;
      const teams = (userId && userToTeams[userId]) || [{ id: 'unassigned', name: 'Unassigned' }];
      
      for (const t of teams) {
        if (!teamStatsMap[t.id]) {
          teamStatsMap[t.id] = {
            id: t.id,
            name: t.name,
            totalCapacity: 0,
            totalRpi: 0,
            count: 0
          };
        }
        teamStatsMap[t.id].totalCapacity += intern.capacityScore;
        teamStatsMap[t.id].totalRpi += intern.rpi;
        teamStatsMap[t.id].count += 1;
      }
    }

    const teamList = Object.values(teamStatsMap).map(t => {
      const avgCapacity = t.count > 0 ? Math.round(t.totalCapacity / t.count) : 0;
      const avgRpi = t.count > 0 ? parseFloat((t.totalRpi / t.count).toFixed(1)) : 0;
      return {
        id: t.id,
        name: t.name,
        capacityScore: avgCapacity,
        rpi: avgRpi,
        internCount: t.count
      };
    });

    // Determine best performing team based on average RPI
    let bestTeamId = null;
    let maxRpi = -1;
    for (const t of teamList) {
      if (t.id !== 'unassigned' && t.rpi > maxRpi) {
        maxRpi = t.rpi;
        bestTeamId = t.id;
      }
    }

    const teams = teamList.map(t => ({
      ...t,
      isBestPerforming: t.id === bestTeamId
    })).sort((a, b) => b.rpi - a.rpi);

    return ok(res, { totalInterns, activeTasks, openAlerts, completedLast30, interns, alerts, teams });
  } catch (err) {
    next(err);
  }
}

async function getPendingUsers(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      where:   { status: 'pending' },
      select:  { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, users, 'Pending users fetched');
  } catch (err) {
    next(err);
  }
}

async function approveUser(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId) return validationError(res, 'userId is required');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)                    return notFound(res, 'User not found');
    if (user.status !== 'pending') return validationError(res, 'User is not pending approval');

    await prisma.user.update({ where: { id: userId }, data: { status: 'active' } });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.APPROVE_USER, AUDIT_ENTITIES.USER, userId, {
      approvedEmail: user.email,
      approvedRole:  user.role,
    });

    // Fire-and-forget — email failure must not block the approval response
    void notificationService.notifyAccountApproved(user.email, user.name || user.email.split('@')[0]);

    return ok(res, null, `User ${user.email} approved successfully`);
  } catch (err) {
    next(err);
  }
}

async function getAvailabilityDeadline(req, res, next) {
  try {
    const deadline = await configStore.get('availabilityDeadline', DEFAULT_DEADLINE);
    return ok(res, deadline, 'Availability deadline fetched');
  } catch (err) {
    next(err);
  }
}

async function setAvailabilityDeadline(req, res, next) {
  const { day, hour, minute } = req.body;

  if (typeof day !== 'number' || day < 0 || day > 6) {
    return validationError(res, 'day must be an integer 0 (Sun) – 6 (Sat)');
  }
  if (typeof hour !== 'number' || hour < 0 || hour > 23) {
    return validationError(res, 'hour must be an integer 0–23');
  }
  if (typeof minute !== 'number' || minute < 0 || minute > 59) {
    return validationError(res, 'minute must be an integer 0–59');
  }

  try {
    await configStore.set('availabilityDeadline', { day, hour, minute });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.SET_AVAILABILITY_DEADLINE, AUDIT_ENTITIES.CONFIG, null, { day, hour, minute });

    return ok(res, { day, hour, minute }, 'Availability deadline updated');
  } catch (err) {
    next(err);
  }
}

async function getFormReminderUrl(req, res, next) {
  try {
    const url = await configStore.get('formReminderUrl', '');
    return ok(res, { url }, 'Form reminder URL fetched');
  } catch (err) {
    next(err);
  }
}

async function setFormReminderUrl(req, res, next) {
  try {
    const { url } = req.body;
    if (typeof url !== 'string') {
      return validationError(res, 'url must be a string');
    }
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\/.+/.test(trimmed)) {
      return validationError(res, 'url must be a valid http/https URL');
    }
    await configStore.set('formReminderUrl', trimmed);
    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.SET_AVAILABILITY_DEADLINE, AUDIT_ENTITIES.CONFIG, null, { formReminderUrl: trimmed });
    return ok(res, { url: trimmed }, 'Form reminder URL updated');
  } catch (err) {
    next(err);
  }
}

async function finishInternship(req, res, next) {
  try {
    const { internId } = req.body;
    if (!internId) return validationError(res, 'internId is required');

    const intern = await prisma.intern.findUnique({ 
      where: { id: internId },
      include: { user: true }
    });

    if (!intern) return notFound(res, 'Intern not found');

    // Guard: intern must have a linked user account
    if (!intern.userId) return notFound(res, 'Intern has no linked user account');

    // Update user status and role
    await prisma.user.update({
      where: { id: intern.userId },
      data: {
        status: 'alumni',
        role: 'PAST_EMPLOYEE'
      }
    });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.FINISH_INTERNSHIP, AUDIT_ENTITIES.INTERN, internId, {
      internEmail: intern.user.email,
      internName: intern.user.name,
    });

    return ok(res, null, `Internship finished for ${intern.user.name}. Access removed.`);
  } catch (err) {
    next(err);
  }
}

module.exports = { overrideScore, updateTaskStatus, getAdminOverview, getPendingUsers, approveUser, getAvailabilityDeadline, setAvailabilityDeadline, getFormReminderUrl, setFormReminderUrl, finishInternship, blockIP, unblockIP, listBlockedIPs, getLoginLogs, changeUserRole, getAllUsers, deleteIntern, updateIntern, rejectUser };

// ── Get all users (for role management UI) ────────────────────────────────────

async function getAllUsers(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        status:    true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, users, 'Users fetched');
  } catch (err) {
    next(err);
  }
}

// ── Phase 2: IP Block Management ──────────────────────────────────────────────

async function blockIP(req, res, next) {
  try {
    const { ipAddress, reason, expiresAt } = req.body;
    if (!ipAddress || typeof ipAddress !== 'string') {
      return validationError(res, 'ipAddress is required');
    }

    const existing = await prisma.blockedIP.findUnique({ where: { ipAddress } });
    if (existing) {
      const updated = await prisma.blockedIP.update({
        where: { ipAddress },
        data: {
          reason:      reason ?? existing.reason,
          expiresAt:   expiresAt ? new Date(expiresAt) : null,
          blockedById: req.user?.id ?? null,
          blockedAt:   new Date(),
        },
      });
      invalidateCache(ipAddress);
      void logAction(req.user?.id ?? null, 'BLOCK_IP', 'SYSTEM', null, { ipAddress, reason });
      return ok(res, updated, `IP ${ipAddress} block updated.`);
    }

    const block = await prisma.blockedIP.create({
      data: {
        ipAddress,
        reason:      reason ?? null,
        expiresAt:   expiresAt ? new Date(expiresAt) : null,
        blockedById: req.user?.id ?? null,
      },
    });
    invalidateCache(ipAddress);
    void logAction(req.user?.id ?? null, 'BLOCK_IP', 'SYSTEM', null, { ipAddress, reason });
    return ok(res, block, `IP ${ipAddress} blocked.`);
  } catch (err) {
    next(err);
  }
}

async function unblockIP(req, res, next) {
  try {
    const { ipAddress } = req.body;
    if (!ipAddress) return validationError(res, 'ipAddress is required');

    const existing = await prisma.blockedIP.findUnique({ where: { ipAddress } });
    if (!existing) return notFound(res, 'IP block not found');

    await prisma.blockedIP.delete({ where: { ipAddress } });
    invalidateCache(ipAddress);
    void logAction(req.user?.id ?? null, 'UNBLOCK_IP', 'SYSTEM', null, { ipAddress });
    return ok(res, null, `IP ${ipAddress} unblocked.`);
  } catch (err) {
    next(err);
  }
}

async function listBlockedIPs(req, res, next) {
  try {
    const blocks = await prisma.blockedIP.findMany({
      orderBy: { blockedAt: 'desc' },
    });
    return ok(res, blocks, 'Blocked IPs fetched');
  } catch (err) {
    next(err);
  }
}

async function getLoginLogs(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip  = (page - 1) * limit;

    const where = {};
    if (req.query.success !== undefined) {
      where.success = req.query.success === 'true';
    }
    if (req.query.ipAddress) {
      where.ipAddress = req.query.ipAddress;
    }
    if (req.query.email) {
      where.email = { contains: req.query.email, mode: 'insensitive' };
    }

    const [total, logs] = await Promise.all([
      prisma.loginLog.count({ where }),
      prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip,
      }),
    ]);

    return ok(res, { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, 'Login logs fetched');
  } catch (err) {
    next(err);
  }
}

// ── Phase 2: Role Change (Promotion-safe) ─────────────────────────────────────

async function changeUserRole(req, res, next) {
  try {
    const { userId, newRole, reason } = req.body;
    if (!userId)  return validationError(res, 'userId is required');
    if (!newRole) return validationError(res, 'newRole is required');

    const normalizedRole = normalizeRole(newRole);
    if (!normalizedRole) return validationError(res, `Invalid role "${newRole}"`);

    // Expand select to include the linked Intern record so we can pass internId
    // to reroomSocket — the intern room is keyed by Intern.id, not User.id.
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { role: true, intern: { select: { id: true } } },
    });
    if (!user) return notFound(res, 'User not found');

    if (user.role === normalizedRole) {
      return validationError(res, `User already has role ${normalizedRole}`);
    }

    const previousRole = user.role;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data:  { role: normalizedRole },
      }),
      prisma.userRoleHistory.create({
        data: {
          userId,
          previousRole,
          newRole:     normalizedRole,
          changedById: req.user?.id ?? null,
          reason:      reason ?? null,
        },
      }),
    ]);

    // LOW-1: update RBAC rooms on any active socket connections for this user
    // so the change takes effect immediately without requiring a reconnect.
    const { reroomSocket } = require('../services/realtimeEngine');
    reroomSocket(userId, normalizedRole, user.intern?.id ?? null);

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.CHANGE_USER_ROLE, AUDIT_ENTITIES.USER, userId, {
      userId,
      previousRole,
      newRole: normalizedRole,
      reason:  reason ?? null,
    });

    return ok(res, { userId, previousRole, newRole: normalizedRole }, `Role updated to ${normalizedRole}`);
  } catch (err) {
    next(err);
  }
}

// ── Delete Intern ─────────────────────────────────────────────────────────────

async function deleteIntern(req, res, next) {
  try {
    const { internId } = req.params;
    if (!internId) return validationError(res, 'internId is required');

    const intern = await prisma.intern.findUnique({
      where: { id: internId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!intern) return notFound(res, 'Intern not found');

    // Guard: intern must have a linked user account to cascade-delete
    if (!intern.userId) return notFound(res, 'Intern has no linked user account');

    // Delete user (cascades to intern, tasks, alerts, etc. via DB relations)
    await prisma.user.delete({ where: { id: intern.userId } });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.DELETE_INTERN, AUDIT_ENTITIES.USER, internId, {
      deletedEmail: intern.user?.email,
      deletedName:  intern.user?.name,
    });

    return ok(res, null, `Intern ${intern.user?.name || intern.user?.email} deleted successfully`);
  } catch (err) {
    next(err);
  }
}

// ── Update Intern (name, gdocUrl, joiningDate) ────────────────────────────────

async function updateIntern(req, res, next) {
  try {
    const { internId } = req.params;
    if (!internId) return validationError(res, 'internId is required');

    const intern = await prisma.intern.findUnique({
      where: { id: internId },
      include: { user: true },
    });
    if (!intern) return notFound(res, 'Intern not found');

    const { name, gdocUrl, joiningDate, dateOfBirth } = req.body;

    // Update User fields — only possible when intern has a linked user account
    const userUpdate = {};
    if (typeof name === 'string' && name.trim()) userUpdate.name = name.trim();
    if (joiningDate) userUpdate.joiningDate = new Date(joiningDate);
    if (dateOfBirth)  userUpdate.dateOfBirth  = new Date(dateOfBirth);

    if (Object.keys(userUpdate).length > 0) {
      if (!intern.userId) return notFound(res, 'Intern has no linked user account');
      await prisma.user.update({ where: { id: intern.userId }, data: userUpdate });
    }

    // Update Intern fields
    const internUpdate = {};
    if (gdocUrl !== undefined) internUpdate.gdocUrl = gdocUrl || null;

    if (Object.keys(internUpdate).length > 0) {
      await prisma.intern.update({ where: { id: internId }, data: internUpdate });
    }

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.UPDATE_INTERN, AUDIT_ENTITIES.USER, internId, {
      internId, changes: { ...userUpdate, ...internUpdate },
    });

    return ok(res, null, 'Intern updated successfully');
  } catch (err) {
    next(err);
  }
}

// ── Reject (delete) a pending user ───────────────────────────────────────────

async function rejectUser(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId) return validationError(res, 'userId is required');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return notFound(res, 'User not found');
    if (user.status !== 'pending') return validationError(res, 'User is not pending approval');

    // Hard-delete the pending user record entirely
    await prisma.user.delete({ where: { id: userId } });

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.REJECT_USER, AUDIT_ENTITIES.USER, userId, {
      rejectedEmail: user.email,
      rejectedRole:  user.role,
    });

    return ok(res, null, `User ${user.email} rejected and removed.`);
  } catch (err) {
    next(err);
  }
}
