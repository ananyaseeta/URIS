const { getAssignmentShortlist } = require('../services/assignmentEngine');
const { validateTaskAssignment }  = require('../services/businessRules');
const { ok, validationError, businessError } = require('../utils/respond');
const prisma = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');
const logger = require('../utils/logger');

const MIN_CAPACITY_THRESHOLD = parseInt(process.env.MIN_CAPACITY_THRESHOLD) || 40;

// Soft reservation window — how long after assignment the capacity engine
// applies a −20 penalty before Plane sync confirms the task is active.
// Configurable via RESERVATION_HOURS (default: 48 hours).
const RESERVATION_HOURS = parseInt(process.env.RESERVATION_HOURS) || 48;

async function getShortlist(req, res, next) {
  try {
    const { task } = req.body;

    if (!task || !Array.isArray(task.requiredSkills)) {
      return validationError(res, 'Missing required field: task.requiredSkills');
    }

    const dbInterns = await prisma.intern.findMany({
      include: {
        credibility: true,
        tasks:       { where: { status: 'active' } },
        scoreHistory: {
          where:   { type: 'capacity' },
          orderBy: { createdAt: 'desc' },
          take:    1,
        },
      },
    });

    const now = new Date();

    const interns = dbInterns.map(i => {
      const capacityScore = i.scoreHistory[0]
        ? Math.round(i.scoreHistory[0].score)
        : 0;

      const credibilityScore = i.credibility
        ? Math.round(i.credibility.score * 100)
        : 0;

      const TLI = i.tasks.reduce(
        (sum, t) => sum + t.complexity * (1 - t.progressPct / 100),
        0
      );

      // Surface active reservation so the frontend can show "recently assigned"
      const isReserved = i.reservedUntil ? new Date(i.reservedUntil) > now : false;

      return {
        id:                 i.id,
        capacityScore,
        credibilityScore,
        TLI:                parseFloat(TLI.toFixed(2)),
        availabilityStatus: capacityScore >= 30 ? 'available' : 'unavailable',
        skillTags:          i.tasks.flatMap(t => t.skills ?? []),
        isReserved,
        reservedUntil:      isReserved ? i.reservedUntil : null,
      };
    });

    const rankedInterns = getAssignmentShortlist(task, interns);

    return ok(res, rankedInterns, 'Shortlist generated');
  } catch (err) {
    next(err);
  }
}

async function assignTask(req, res, next) {
  try {
    const { internId, taskId } = req.body;

    // Business-level rules: intern exists, task exists, no duplicate assignment, task not completed
    const biz = await validateTaskAssignment({ internId, taskId, user: req.user });
    if (!biz.ok) {
      return businessError(res, biz.status, biz.message);
    }

    const { task } = biz;   // reuse the task fetched during validation

    // Capacity check — read from ScoreHistory (integer 0–100, written by new pipeline).
    // If no capacity history exists the intern has not yet submitted availability —
    // block assignment with a specific message rather than silently treating score as 0.
    const latestCapacity = await prisma.scoreHistory.findFirst({
      where:   { internId, type: 'capacity' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestCapacity) {
      return validationError(res, 'Intern has not submitted availability yet. Capacity score is unavailable.');
    }

    const capacityScore = Math.round(latestCapacity.score);

    if (capacityScore < MIN_CAPACITY_THRESHOLD) {
      logger.info({ internId, capacityScore, threshold: MIN_CAPACITY_THRESHOLD }, 'Assignment blocked — low capacity');
      return businessError(res, 400, `Intern not eligible for assignment — capacity score ${capacityScore} is below threshold ${MIN_CAPACITY_THRESHOLD}.`);
    }

    await prisma.$transaction([
      // Update the task's assigned intern
      prisma.task.update({
        where: { id: taskId },
        data:  { internId },
      }),
      // Set a soft reservation on the intern so the capacity engine applies
      // a −20 penalty for RESERVATION_HOURS, preventing a second admin from
      // assigning another task before Plane syncs the first one.
      prisma.intern.update({
        where: { id: internId },
        data:  { reservedUntil: new Date(Date.now() + RESERVATION_HOURS * 60 * 60 * 1000) },
      }),
    ]);

    // Notify the intern that a new task has been assigned to them
    await prisma.alert.create({
      data: {
        internId,
        taskId,
        type:     'task_assigned',
        severity: 'warning',
        message:  `You have been assigned a new task: "${task.title}". Check your task list and update your progress regularly.`,
      },
    });

    logger.info({ taskId, internId, reservationHours: RESERVATION_HOURS }, 'Task assigned with soft reservation');

    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.ASSIGN_TASK, AUDIT_ENTITIES.TASK, taskId, {
      taskId,
      internId,
      previousInternId: task.internId ?? null,
    });

    return ok(res, null, 'Task assigned successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = { getShortlist, assignTask };
