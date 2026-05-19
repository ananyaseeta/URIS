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
    let alertFilter = { resolved: false };
    
    if (req.user.role !== ROLES.CORE_ADMIN && req.user.role !== ROLES.OPERATIONS_LEAD) {
      const allowedTasks = await prisma.task.findMany({ where: filter, select: { id: true, internId: true } });
      const allowedTaskIds = allowedTasks.map(t => t.id);
      const allowedInternIds = [...new Set(allowedTasks.map(t => t.internId))];
      
      internFilter = { id: { in: allowedInternIds } };
      alertFilter.OR = [
        { taskId: { in: allowedTaskIds } },
        { internId: { in: allowedInternIds } }
      ];
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
      select:  { id: true, email: true, role: true, createdAt: true },
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

    void logAction(req.user?.id ?? null, 'APPROVE_USER', 'USER', userId, {
      approvedEmail: user.email,
      approvedRole:  user.role,
    });

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

    void logAction(req.user?.id ?? null, 'SET_AVAILABILITY_DEADLINE', 'CONFIG', null, { day, hour, minute });

    return ok(res, { day, hour, minute }, 'Availability deadline updated');
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

    // Update user status and role
    await prisma.user.update({
      where: { id: intern.userId },
      data: {
        status: 'alumni',
        role: 'PAST_EMPLOYEE'
      }
    });

    void logAction(req.user?.id ?? null, 'FINISH_INTERNSHIP', 'INTERN', internId, {
      internEmail: intern.user.email,
      internName: intern.user.name,
    });

    return ok(res, null, `Internship finished for ${intern.user.name}. Access removed.`);
  } catch (err) {
    next(err);
  }
}

module.exports = { overrideScore, updateTaskStatus, getAdminOverview, getPendingUsers, approveUser, getAvailabilityDeadline, setAvailabilityDeadline, finishInternship, blockIP, unblockIP, listBlockedIPs, getLoginLogs, changeUserRole };

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

    const user = await prisma.user.findUnique({ where: { id: userId } });
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

    void logAction(req.user?.id ?? null, 'CHANGE_USER_ROLE', 'USER', userId, {
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
