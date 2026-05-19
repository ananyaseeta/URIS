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

async function getTasksOverview(req, res, next) {
  try {
    await syncTasksFromPlane();
    const staleCount = await detectAndMarkStaleTasks();
    await generateBlockerAlerts();

    const filter = await getTaskFilter(req.user);
    const overview = await getTasksOverviewForAllInterns();

    // Apply role-based intern filter to the overview
    const filteredOverview = overview.filter(item => {
      if (filter.internId && item.internId !== filter.internId) return false;
      return true;
    });

    return ok(res, filteredOverview, `Tasks overview fetched. ${staleCount} stale task(s) detected.`);
  } catch (err) {
    next(err);
  }
}

async function getTaskById(req, res, next) {
  try {
    const { taskId } = req.params;

    const filter = await getTaskFilter(req.user);
    filter.id = taskId;

    const task = await prisma.task.findFirst({
      where: filter,
      include: {
        intern: {
          select: {
            user: { select: { name: true, email: true } }
          }
        }
      }
    });

    if (!task) return notFound(res, 'Task not found or access denied');

    // Role-based field masking (LIMITED visibility)
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
          status:       true,
          internId:     true,
          complexity:   true,
          progressPct:  true,
          hasBlocker:   true,
          blockerType:  true,
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

    // Mask fields for LIMITED roles in list view
    const tasksWithAssignee = tasks.map(t => {
      const task = {
        ...t,
        assignee: t.intern?.user?.name || t.intern?.user?.email || null,
        deadline: t.deadline ? t.deadline.toISOString().split('T')[0] : null,
        intern:   undefined,
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
      ...(typeof hasBlocker === 'boolean' ? { hasBlocker } : {}),
      ...(blockerType !== undefined ? { blockerType: hasBlocker ? blockerType : null } : {}),
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

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return notFound(res, 'Task not found');

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

module.exports = { getTasksOverview, getTasks, createTask, internUpdateTask, deleteTask, getTaskById };
