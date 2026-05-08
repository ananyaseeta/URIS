const { syncTasksFromPlane, detectAndMarkStaleTasks, getTasksOverviewForAllInterns } = require('../services/taskService');
const { generateBlockerAlerts } = require('../services/alertService');
const { validateTaskCreation }  = require('../services/businessRules');
const { ok, created, validationError, businessError, notFound } = require('../utils/respond');
const prisma = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');
const { validatePagination } = require('../utils/validate');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

async function getTasksOverview(req, res) {
  try {
    await syncTasksFromPlane();
    const staleCount = await detectAndMarkStaleTasks();
    await generateBlockerAlerts();

    const overview = await getTasksOverviewForAllInterns();

    res.json({
      success: true,
      message: `Tasks overview fetched. ${staleCount} stale task(s) detected.`,
      data: overview
    });
  } catch (err) {
    logger.error({ err }, 'getTasksOverview failed');
    res.status(500).json({ success: false, message: 'Failed to fetch task overview.', data: null });
  }
}

async function getTasks(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const isAdmin = req.user.role === 'ADMIN';

    const paginationErrors = validatePagination({ page, limit, status });
    if (paginationErrors.length > 0) {
      return validationError(res, paginationErrors[0]);
    }

    const filter = {};

    // Status filter — case-insensitive, stored lowercase in DB
    if (status) filter.status = status.toLowerCase();

    if (!isAdmin) {
      // Resolve the intern record for this authenticated user.
      // If no intern record exists (e.g. user registered but onboarding incomplete),
      // return an empty list — never 404, which would leak existence information.
      const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
      if (!intern) {
        return res.status(200).json({
          success: true,
          data:    [],
          meta:    { total: 0, page: parseInt(page), limit: parseInt(limit) },
        });
      }
      // Scope the query strictly to this intern's own tasks.
      // This filter is always set before the DB query runs — no path exists
      // where a non-admin can receive another intern's tasks.
      filter.internId = intern.id;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where:   filter,
        select:  {
          id:         true,
          title:      true,
          status:     true,
          internId:   true,
          complexity: true,
          progressPct: true,
          createdAt:  true,
          intern: {
            select: {
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    parseInt(limit),
      }),
      prisma.task.count({ where: filter }),
    ]);

    // Flatten intern → user → email into a top-level `assignee` field
    const tasksWithAssignee = tasks.map(t => ({
      ...t,
      assignee: t.intern?.user?.email ?? null,
      intern:   undefined,
    }));

    logger.info({ count: tasks.length }, 'Tasks fetched');

    return res.status(200).json({
      success: true,
      data:    tasksWithAssignee,
      meta:    { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    next(err);
  }
}

async function createTask(req, res, next) {
  try {
    const { title, complexity, internId, skills = [], deadline } = req.body;

    // Use the provided planeTaskId or generate a unique fallback so tasks
    // created without a Plane integration still satisfy the @unique constraint.
    const planeTaskId = req.body.planeTaskId?.trim() || `manual-${randomUUID()}`;

    // Business-level rules: integer complexity, future deadline, unique planeTaskId, intern exists
    const biz = await validateTaskCreation({ complexity, deadline, planeTaskId, internId });
    if (!biz.ok) {
      return businessError(res, biz.status, biz.message);
    }

    // Intern existence confirmed by validateTaskCreation — safe to create directly
    const task = await prisma.task.create({
      data: {
        title,
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

module.exports = { getTasksOverview, getTasks, createTask, internUpdateTask };

async function internUpdateTask(req, res, next) {
  try {
    const { taskId } = req.params;
    const { progressPct, note, hasBlocker, blockerType } = req.body;

    // Resolve the intern record for the authenticated user
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) {
      return notFound(res, 'Intern record not found');
    }

    // Fetch the task and verify ownership
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return notFound(res, 'Task not found');
    }
    if (task.internId !== intern.id) {
      const { forbidden } = require('../utils/respond');
      return forbidden(res, 'You can only update your own tasks');
    }
    if (task.status === 'completed') {
      return validationError(res, 'Cannot update a completed task');
    }

    const updateData = {
      progressPct,
      lastUpdatedAt: new Date(),
      ...(typeof hasBlocker === 'boolean' ? { hasBlocker } : {}),
      ...(blockerType !== undefined ? { blockerType: hasBlocker ? blockerType : null } : {}),
    };

    const updated = await prisma.task.update({
      where: { id: taskId },
      data:  updateData,
    });

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
