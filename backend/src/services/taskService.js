const axios      = require('axios');
const axiosRetry = require('axios-retry').default;
const prisma     = require('../utils/prisma');
const logger     = require('../utils/logger');

const PLANE_BASE_URL  = process.env.PLANE_BASE_URL;
const PLANE_API_KEY   = process.env.PLANE_API_KEY;
const WORKSPACE_SLUG  = process.env.PLANE_WORKSPACE_SLUG;
const PROJECT_ID      = process.env.PLANE_PROJECT_ID;

// ── Plane.so HTTP client ──────────────────────────────────────────────────────
// Dedicated axios instance with:
//   - 10 s request timeout (Plane has no SLA; bare axios has no timeout)
//   - 3 retries with exponential backoff on network errors and 5xx responses
//   - No retry on 4xx (bad request / auth failure — retrying won't help)
const axiosPlane = axios.create({
  timeout: parseInt(process.env.PLANE_REQUEST_TIMEOUT_MS) || 10_000,
});

axiosRetry(axiosPlane, {
  retries:           3,
  retryDelay:        axiosRetry.exponentialDelay,   // 1 s, 2 s, 4 s
  retryCondition:    (err) => {
    // Retry on network errors (ECONNRESET, ETIMEDOUT, etc.) and 5xx only
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
  // Skip silently if Plane is not configured — avoids noisy errors in local dev
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

      // Clear the soft reservation now that Plane has confirmed the task —
      // the intern's capacity score will reflect the real task load on next compute.
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

/**
 * Sync a single Plane issue by its ID instead of pulling the full list.
 * Called by the webhook receiver on issue.created / issue.updated events
 * to avoid a full poll when only one issue changed.
 *
 * @param {string} issueId — Plane issue UUID
 * @returns {Promise<{ synced: number, error?: string }>}
 */
async function syncSingleIssueFromPlane(issueId) {
  // Skip silently if Plane is not configured
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

    logger.info({ issueId, assigneeId }, 'syncSingleIssueFromPlane completed');
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

  for (const task of staleTasks) {
    await prisma.task.update({ where: { id: task.id }, data: { status: 'stale' } });

    const existing = await prisma.alert.findFirst({
      where: { taskId: task.id, type: 'stale_task', resolved: false }
    });
    if (!existing) {
      await prisma.alert.create({
        data: {
          internId: task.internId,
          type:     'stale_task',
          taskId:   task.id,
          message:  `Task "${task.title}" has not been updated in 2+ days and the deadline is approaching.`
        }
      });
    }
  }

  return staleTasks.length;
}

async function getTasksOverviewForAllInterns() {
  const interns = await prisma.intern.findMany({ include: { tasks: true } });

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

module.exports = { syncTasksFromPlane, syncSingleIssueFromPlane, computeTLI, getTLIForIntern, detectAndMarkStaleTasks, getTasksOverviewForAllInterns, getTLIBand };
