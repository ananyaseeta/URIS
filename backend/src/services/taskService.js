const axios      = require('axios');
const axiosRetry = require('axios-retry').default;
const prisma     = require('../utils/prisma');
const logger     = require('../utils/logger');

const PLANE_BASE_URL  = process.env.PLANE_BASE_URL;
const PLANE_API_KEY   = process.env.PLANE_API_KEY;
const WORKSPACE_SLUG  = process.env.PLANE_WORKSPACE_SLUG;
const PROJECT_ID      = process.env.PLANE_PROJECT_ID;

// ── Plane.so HTTP client ──────────────────────────────────────────────────────
const axiosPlane = axios.create({
  timeout: parseInt(process.env.PLANE_REQUEST_TIMEOUT_MS) || 10_000,
});

axiosRetry(axiosPlane, {
  retries:           3,
  retryDelay:        axiosRetry.exponentialDelay,
  retryCondition:    (err) => {
    return axiosRetry.isNetworkError(err) || axiosRetry.isRetryableError(err);
  },
  onRetry: (retryCount, err) => {
    logger.warn({ retryCount, status: err.response?.status, message: err.message }, 'Plane API retry');
  },
});

function mapPriorityToComplexity(priority) {
  const map = { urgent: 3, high: 2.5, medium: 2, low: 1, none: 1 };
  return map[priority?.toLowerCase()] ?? 1;
}

function mapStateToProgress(stateGroup) {
  const map = { backlog: 0, unstarted: 0, started: 50, completed: 100, cancelled: 100 };
  return map[stateGroup?.toLowerCase()] ?? 0;
}

async function syncTasksFromPlane() {
  if (!PLANE_BASE_URL || !PLANE_API_KEY || !WORKSPACE_SLUG || !PROJECT_ID) {
    logger.debug('Plane not configured — skipping syncTasksFromPlane');
    return { synced: 0 };
  }

  try {
    const response = await axiosPlane.get(
      `${PLANE_BASE_URL}/workspaces/${WORKSPACE_SLUG}/projects/${PROJECT_ID}/issues/`,
      { headers: { 'x-api-key': PLANE_API_KEY }, params: { per_page: 100 } }
    );

    const issues = response.data?.results ?? [];

    for (const issue of issues) {
      const assigneeId = issue.assignees?.[0] ?? null;
      if (!assigneeId) continue;

      await prisma.intern.upsert({ where: { id: assigneeId }, update: {}, create: { id: assigneeId } });

      await prisma.task.upsert({
        where: { planeTaskId: issue.id },
        update: {
          progressPct:   mapStateToProgress(issue.state?.group),
          status:        issue.state?.group === 'completed' ? 'completed' : 'active',
          hasBlocker:    !!(issue.label_ids?.length && issue.description?.toLowerCase().includes('blocked')),
          lastUpdatedAt: new Date(issue.updated_at),
          deadline:      issue.due_date ? new Date(issue.due_date) : null,
        },
        create: {
          planeTaskId:   issue.id,
          internId:      assigneeId,
          title:         issue.name,
          complexity:    mapPriorityToComplexity(issue.priority),
          progressPct:   mapStateToProgress(issue.state?.group),
          status:        'active',
          hasBlocker:    false,
          skills:        issue.label_ids ?? [],
          lastUpdatedAt: new Date(issue.updated_at),
          deadline:      issue.due_date ? new Date(issue.due_date) : null,
        }
      });

      await prisma.intern.updateMany({
        where: { id: assigneeId, reservedUntil: { not: null } },
        data:  { reservedUntil: null },
      });
    }

    return { synced: issues.length };
  } catch (err) {
    logger.error({ err }, 'syncTasksFromPlane failed');
    return { synced: 0, error: err.message };
  }
}

async function syncSingleIssueFromPlane(issueId) {
  if (!PLANE_BASE_URL || !PLANE_API_KEY || !WORKSPACE_SLUG || !PROJECT_ID) {
    logger.debug('Plane not configured — skipping syncSingleIssueFromPlane');
    return { synced: 0 };
  }

  try {
    const response = await axiosPlane.get(
      `${PLANE_BASE_URL}/workspaces/${WORKSPACE_SLUG}/projects/${PROJECT_ID}/issues/${issueId}/`,
      { headers: { 'x-api-key': PLANE_API_KEY } }
    );

    const issue = response.data;
    if (!issue?.id) {
      return { synced: 0, error: 'Issue not found in Plane response' };
    }

    const assigneeId = issue.assignees?.[0] ?? null;
    if (!assigneeId) {
      logger.warn({ issueId }, 'syncSingleIssueFromPlane — issue has no assignee, skipping upsert');
      return { synced: 0 };
    }

    await prisma.intern.upsert({ where: { id: assigneeId }, update: {}, create: { id: assigneeId } });

    await prisma.task.upsert({
      where: { planeTaskId: issue.id },
      update: {
        progressPct:   mapStateToProgress(issue.state?.group),
        status:        issue.state?.group === 'completed' ? 'completed' : 'active',
        hasBlocker:    !!(issue.label_ids?.length && issue.description?.toLowerCase().includes('blocked')),
        lastUpdatedAt: new Date(issue.updated_at),
        deadline:      issue.due_date ? new Date(issue.due_date) : null,
      },
      create: {
        planeTaskId:   issue.id,
        internId:      assigneeId,
        title:         issue.name,
        complexity:    mapPriorityToComplexity(issue.priority),
        progressPct:   mapStateToProgress(issue.state?.group),
        status:        'active',
        hasBlocker:    false,
        skills:        issue.label_ids ?? [],
        lastUpdatedAt: new Date(issue.updated_at),
        deadline:      issue.due_date ? new Date(issue.due_date) : null,
      },
    });

    return { synced: 1 };
  } catch (err) {
    logger.error({ err, issueId }, 'syncSingleIssueFromPlane failed');
    return { synced: 0, error: err.message };
  }
}

function computeTLI(tasks = []) {
  return tasks.reduce((sum, task) => {
    const remaining = 1 - (task.progressPct / 100);
    return sum + (task.complexity * remaining);
  }, 0);
}

async function getTLIForIntern(internId) {
  const activeTasks = await prisma.task.findMany({
    where: { internId, status: 'active' }
  });
  return computeTLI(activeTasks);
}

async function removeTask(taskId) {
  // Hard delete — Task model has no deletedAt field in the current schema.
  // Tasks are removed by deleting the record directly.
  return prisma.task.delete({ where: { id: taskId } });
}

async function detectAndMarkStaleTasks() {
  const now           = new Date();
  const twoDaysAgo    = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const fiveDaysAhead = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const staleTasks = await prisma.task.findMany({
    where: {
      status:        { not: 'completed' },
      lastUpdatedAt: { lt: twoDaysAgo },
      deadline:      { lte: fiveDaysAhead, not: null }
    }
  });

  // Credibility nudge ("slightly"): reduce by up to 2 points (0..100 scale)
  const CREDIBILITY_DECREMENT_POINTS = parseFloat(process.env.STALE_CREDIBILITY_DECREMENT_POINTS) || 2;

  // Escalation: if deadline is within 24h of now, severity becomes critical.
  const ESCALATE_WITHIN_HOURS = parseInt(process.env.STALE_ESCALATE_WITHIN_HOURS) || 24;

  const nowMs = Date.now();

  for (const task of staleTasks) {
    await prisma.task.update({ where: { id: task.id }, data: { status: 'stale' } });

    const hoursSinceUpdate = (nowMs - new Date(task.lastUpdatedAt).getTime()) / (1000 * 60 * 60);
    const hoursUntilDeadline = task.deadline ? (new Date(task.deadline).getTime() - nowMs) / (1000 * 60 * 60) : null;

    const isEscalationWindow = hoursUntilDeadline != null && hoursUntilDeadline <= ESCALATE_WITHIN_HOURS;
    const severity = isEscalationWindow ? 'critical' : 'warning';

    // Create (or keep) stale alert; re-create only if none exists unresolved.
    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'stale_task', resolved: false }
    });

    if (!existing) {
      // Resolve intern name for a human-readable message that works for both
      // the intern's own feed and the admin operational feed.
      let internLabel = 'An intern';
      try {
        const internUser = await prisma.intern.findUnique({
          where:  { id: task.internId },
          select: { user: { select: { name: true, email: true } } },
        });
        internLabel = internUser?.user?.name
          || internUser?.user?.email?.split('@')[0]
          || 'An intern';
      } catch { /* non-fatal — fall back to generic label */ }

      await prisma.alert.create({
        data: {
          internId: task.internId,
          type:     'stale_task',
          taskId:   task.id,
          severity,
          message: isEscalationWindow
            ? `ESCALATION: ${internLabel}'s task "${task.title}" is stale and due within ${Math.max(0, Math.round(hoursUntilDeadline))}h.`
            : `${internLabel}'s task "${task.title}" has not been updated for ${Math.round(hoursSinceUpdate)}h and the deadline is approaching.`,
        }
      });
    }

    // Credibility decrement (small): adjust CredibilityScore.score (0..1)
    try {
      const existingCred = await prisma.credibilityScore.findUnique({ where: { internId: task.internId } });
      if (existingCred?.score != null) {
        // existingCred.score is 0..1; decrement points/100
        const dec = CREDIBILITY_DECREMENT_POINTS / 100;
        const nextScore = Math.max(0, existingCred.score - dec);
        await prisma.credibilityScore.update({
          where: { internId: task.internId },
          data:  { score: parseFloat(nextScore.toFixed(3)), computedAt: new Date() },
        });
      }
    } catch (e) {
      logger.warn({ taskId: task.id, internId: task.internId, err: e?.message }, 'Failed to decrement credibility for stale task');
    }
  }
  return staleTasks.length;
}

async function generateDeadlineAlerts() {
  const now          = new Date();
  const in48Hours    = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const in24Hours    = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const urgentTasks = await prisma.task.findMany({
    where: {
      status:   { notIn: ['completed', 'stale'] },
      deadline: { lte: in48Hours, gte: now },
    },
  });

  let created = 0;
  for (const task of urgentTasks) {
    const isVeryUrgent = task.deadline <= in24Hours;
    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'deadline_approaching', resolved: false },
    });
    if (existing) continue;

    await prisma.alert.create({
      data: {
        internId: task.internId,
        taskId:   task.id,
        type:     'deadline_approaching',
        severity: isVeryUrgent ? 'critical' : 'warning',
        message:  isVeryUrgent
          ? `URGENT: Task "${task.title}" is due in less than 24 hours.`
          : `Task "${task.title}" is due within 48 hours.`,
      },
    });
    created++;
  }
  return created;
}

async function generateAvailabilityReminders() {
  const monday = new Date();
  const day = monday.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setUTCDate(monday.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);

  const allInterns = await prisma.intern.findMany({
    select: { id: true, user: { select: { name: true, email: true } } },
  });

  const submittedThisWeek = await prisma.availabilitySlot.findMany({
    where: { weekStart: monday },
    select: { internId: true },
  });

  const submittedIds = new Set(submittedThisWeek.map(s => s.internId));
  const missing = allInterns.filter(i => !submittedIds.has(i.id));

  let created = 0;
  for (const intern of missing) {
    const existing = await prisma.alert.findFirst({
      where: {
        internId: intern.id,
        type:     'availability_reminder',
        resolved: false,
        createdAt: { gte: monday },
      },
    });
    if (existing) continue;

    const internName = intern.user?.name || intern.user?.email?.split('@')[0] || 'An intern';
    await prisma.alert.create({
      data: {
        internId: intern.id,
        type:     'availability_reminder',
        severity: 'warning',
        message:  `${internName} has not submitted availability for this week.`,
      },
    });
    created++;
  }
  return created;
}

async function generateTaskReminders() {
  const activeTasks = await prisma.task.findMany({
    where: { status: 'active' },
  });

  let created = 0;
  for (const task of activeTasks) {
    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'task_reminder', resolved: false },
    });
    if (existing) continue;

    await prisma.alert.create({
      data: {
        internId: task.internId,
        taskId:   task.id,
        type:     'task_reminder',
        severity: 'warning',
        message:  `Reminder: Please review and update your progress for task "${task.title}".`,
      },
    });
    created++;
  }
  return created;
}

async function getTasksOverviewForAllInterns() {
  const interns = await prisma.intern.findMany({ 
    include: { 
      tasks: true
    } 
  });

  return interns.map(intern => {
    const activeTasks    = intern.tasks.filter(t => t.status === 'active');
    const staleTasks     = intern.tasks.filter(t => t.status === 'stale');
    const pausedTasks    = intern.tasks.filter(t => t.status === 'paused');
    const blockedTasks   = intern.tasks.filter(t => t.hasBlocker);
    const completedCount = intern.tasks.filter(t => t.status === 'completed').length;

    return {
      internId:       intern.id,
      tli:            parseFloat(computeTLI(activeTasks).toFixed(3)),
      tliBand:        getTLIBand(computeTLI(activeTasks)),
      activeTasks:    activeTasks.length,
      staleTasks:     staleTasks.length,
      pausedTasks:    pausedTasks.length,
      blockedTasks:   blockedTasks.length,
      completedTotal: completedCount,
      hasStale:       staleTasks.length > 0,
      hasBlocker:     blockedTasks.length > 0,
      tasks:          intern.tasks
    };
  });
}

function getTLIBand(tli) {
  if (tli <= 2) return 'Low';
  if (tli <= 5) return 'Moderate';
  return 'High';
}

async function getTaskFilter(user) {
  const { ROLES } = require('../constants/roles');
  const filter = {};
  
  switch (user.role) {
    case ROLES.CORE_ADMIN:
    case ROLES.OPERATIONS_LEAD:
      // Can see all tasks
      break;
      
    case ROLES.TECHNICAL_LEAD:
    case ROLES.RESEARCH_LEAD: {
      // ONLY own team — resolve intern IDs via UserTeam → User → Intern
      const leadTeams = await prisma.userTeam.findMany({
        where: { userId: user.id, role: 'lead', leftAt: null },
        select: { teamId: true }
      });
      const teamIds = leadTeams.map(t => t.teamId);

      if (teamIds.length === 0) {
        filter.id = 'none'; // no teams → no tasks
        break;
      }

      // Get all user IDs in those teams
      const teamMembers = await prisma.userTeam.findMany({
        where: { teamId: { in: teamIds }, leftAt: null },
        select: { userId: true }
      });
      const memberUserIds = teamMembers.map(m => m.userId);

      // Resolve to intern IDs
      const interns = await prisma.intern.findMany({
        where: { userId: { in: memberUserIds } },
        select: { id: true }
      });
      const internIds = interns.map(i => i.id);

      filter.internId = internIds.length > 0 ? { in: internIds } : 'none';
      break;
    }
      
    case ROLES.OPERATIONS_PROGRAM_MANAGER:
      // operational tasks only — Task has no isOperational field, show all tasks
      // (scoped by team membership like leads)
      break;
      
    case ROLES.TECHNICAL_INTERN:
    case ROLES.RESEARCH_INTERN:
    case ROLES.OPERATIONS_INTERN: {
      const intern = await prisma.intern.findUnique({ where: { userId: user.id } });
      filter.internId = intern?.id || 'none';
      break;
    }
      
    case ROLES.OBSERVER_TEAM_LEAD:
      // Observer sees all tasks (read-only — enforced at route level, not filter)
      break;
      
    case ROLES.COLLABORATOR_LEAD:
      // Collaborator sees all tasks (scoped access enforced at route level)
      break;
      
    default:
      filter.id = 'none';
  }
  
  return filter;
}

async function generateFormReminders() {
  const configStore = require('./configStore');

  // Roles that should fill the form: all interns, leads, Orenda members, OPM
  const FORM_REMINDER_ROLES = [
    'TECHNICAL_INTERN',
    'OPERATIONS_INTERN',
    'RESEARCH_INTERN',
    'TECHNICAL_LEAD',
    'OPERATIONS_LEAD',
    'RESEARCH_LEAD',
    'OPERATIONS_PROGRAM_MANAGER',
    'OBSERVER_TEAM_LEAD',
    'COLLABORATOR_LEAD',
    'ORENDA_MEMBER',
  ];

  // Fetch the admin-configured form URL; skip sending if not yet set
  const baseFormUrl = await configStore.get('formReminderUrl', '');
  if (!baseFormUrl) {
    logger.info('generateFormReminders: no form URL configured — skipping');
    return 0;
  }

  const users = await prisma.user.findMany({
    where: {
      status: 'active',
      role:   { in: FORM_REMINDER_ROLES },
    },
    include: {
      intern: { select: { id: true } },
    },
  });

  let created = 0;
  for (const user of users) {
    // Build a personalised URL with name + email pre-fill params
    const encodedName  = encodeURIComponent(user.name || user.email?.split('@')[0] || 'Member');
    const encodedEmail = encodeURIComponent(user.email || '');
    const separator = baseFormUrl.includes('?') ? '&' : '?';
    const formLink = `${baseFormUrl}${separator}name=${encodedName}&email=${encodedEmail}`;

    // Use the intern record id if available, otherwise fall back to the user id
    const recipientInternId = user.intern?.id ?? null;

    // Only create the alert if there's a linked intern record (for non-intern
    // roles there won't be one — skip to avoid FK violations)
    if (!recipientInternId) continue;

    await prisma.alert.create({
      data: {
        internId: recipientInternId,
        type:     'form_reminder',
        severity: 'info',
        message:  `Please fill out your 3-day update form (Tasks, Availability, and Report Attachment): ${formLink}`,
      },
    });
    created++;
  }
  return created;
}

module.exports = { 
  syncTasksFromPlane, 
  syncSingleIssueFromPlane, 
  computeTLI, 
  getTLIForIntern, 
  removeTask, 
  detectAndMarkStaleTasks, 
  getTasksOverviewForAllInterns, 
  getTLIBand, 
  generateDeadlineAlerts, 
  generateAvailabilityReminders,
  generateTaskReminders,
  getTaskFilter,
  generateFormReminders
};
