const prisma = require('../utils/prisma');
const { validateReviewSubmission } = require('../services/businessRules');
const { ok, created, businessError, notFound, forbidden } = require('../utils/respond');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');

/**
 * GET /review/mine
 * Intern fetches all reviews for their own completed tasks.
 * Returns reviews with task title and computed PPS score.
 */
async function getMyReviews(req, res, next) {
  try {
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const reviews = await prisma.review.findMany({
      where:   { internId: intern.id },
      orderBy: { createdAt: 'desc' },
      include: {
        task: { select: { id: true, title: true, complexity: true, status: true } },
      },
    });

    const data = reviews.map(r => ({
      id:         r.id,
      taskId:     r.taskId,
      taskTitle:  r.task?.title ?? '—',
      quality:    r.quality,
      timeliness: r.timeliness,
      initiative: r.initiative,
      complexity: r.complexity,
      notes:      r.notes ?? null,
      // PPS = Quality×0.40 + Timeliness×0.35 + Independence×0.25
      pps:        parseFloat((r.quality * 0.40 + r.timeliness * 0.35 + r.initiative * 0.25).toFixed(2)),
      createdAt:  r.createdAt,
    }));

    return ok(res, data, `${data.length} review(s) found`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /review/task/:taskId
 * Fetch the review for a specific task.
 * - Interns: can only view reviews for their own tasks.
 * - Leads/admins (CAN_REVIEW): can view the review for any task by taskId.
 */
async function getReviewForTask(req, res, next) {
  try {
    const { taskId } = req.params;
    const { ROLES } = require('../constants/roles');

    const CAN_REVIEW_ROLES = new Set([
      ROLES.CORE_ADMIN, ROLES.TECHNICAL_LEAD, ROLES.RESEARCH_LEAD,
      ROLES.COLLABORATOR_LEAD, ROLES.OPERATIONS_PROGRAM_MANAGER,
      ROLES.OPERATIONS_LEAD,
    ]);

    // For admins/leads — just look up the review by taskId, no ownership check
    if (CAN_REVIEW_ROLES.has(req.user.role)) {
      const review = await prisma.review.findFirst({ where: { taskId } });
      if (!review) return ok(res, null, 'No review submitted for this task yet');
      return ok(res, {
        id:         review.id,
        taskId:     review.taskId,
        quality:    review.quality,
        timeliness: review.timeliness,
        initiative: review.initiative,
        complexity: review.complexity,
        notes:      review.notes ?? null,  // FIX 9 — include persisted notes
        pps:        parseFloat((review.quality * 0.40 + review.timeliness * 0.35 + review.initiative * 0.25).toFixed(2)),
        createdAt:  review.createdAt,
      });
    }

    // For interns — must own the task
    const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
    if (!intern) return notFound(res, 'Intern record not found');

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return notFound(res, 'Task not found');
    if (task.internId !== intern.id) {
      return forbidden(res, 'You can only view reviews for your own tasks');
    }

    const review = await prisma.review.findFirst({
      where: { taskId, internId: intern.id },
    });

    if (!review) return ok(res, null, 'No review submitted for this task yet');

    return ok(res, {
      id:         review.id,
      taskId:     review.taskId,
      quality:    review.quality,
      timeliness: review.timeliness,
      initiative: review.initiative,
      complexity: review.complexity,
      notes:      review.notes ?? null,
      pps:        parseFloat((review.quality * 0.40 + review.timeliness * 0.35 + review.initiative * 0.25).toFixed(2)),
      createdAt:  review.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /review/all-task-ids
 * Admin — returns the list of taskIds that already have a review.
 * Used by the Review page to filter out already-reviewed tasks from the dropdown.
 */
async function getReviewedTaskIds(req, res, next) {
  try {
    const reviews = await prisma.review.findMany({
      where:  { taskId: { not: null } },
      select: { taskId: true },
    });
    return ok(res, reviews.map(r => ({ taskId: r.taskId })));
  } catch (err) {
    next(err);
  }
}

async function submitReview(req, res, next) {
  try {
    const { taskId, internId, qualityScore, timelinessScore, independenceScore, reviewNotes } = req.body;

    // Business-level rules: integer scores, task exists, task completed, intern matches, no duplicate
    const biz = await validateReviewSubmission({ taskId, internId, qualityScore, timelinessScore, independenceScore, user: req.user });
    if (!biz.ok) {
      return businessError(res, biz.status, biz.message);
    }

    // Design §9.2 — PPS = (Quality×0.40) + (Timeliness×0.35) + (Independence×0.25)
    const perTaskPps = parseFloat(
      (qualityScore * 0.40 + timelinessScore * 0.35 + independenceScore * 0.25).toFixed(2)
    );

    // Fetch the task's actual complexity so the performance index weighting is correct.
    // validateReviewSubmission already confirmed the task exists and is completed.
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { complexity: true } });
    const taskComplexity = task?.complexity ?? 1;

    const review = await prisma.review.create({
      data: {
        internId,
        taskId,
        quality:    qualityScore,
        timeliness: timelinessScore,
        initiative: independenceScore,   // DB column kept as 'initiative' for backward compat
        complexity: taskComplexity,      // use actual task complexity for weighted performance index
        notes:      reviewNotes || null, // persist reviewer notes permanently
      },
    });

    // Audit log — review submission is a write operation and must be traceable
    void logAction(req.user?.id ?? null, AUDIT_ACTIONS.SUBMIT_REVIEW, AUDIT_ENTITIES.REVIEW, review.id, {
      internId,
      taskId,
      perTaskPps,
    });

    // Notify the intern that their work has been reviewed — include task title
    const scoreLabel = perTaskPps >= 4 ? 'Excellent' : perTaskPps >= 3 ? 'Good' : 'Needs improvement';
    const reviewedTask = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    const taskTitle = reviewedTask?.title ?? 'your task';
    await prisma.alert.create({
      data: {
        internId,
        taskId,
        type:     'review_submitted',
        severity: 'warning',
        message:  `Your work on "${taskTitle}" has been reviewed. Score: ${perTaskPps}/5 (${scoreLabel}).${reviewNotes ? ` Note: "${reviewNotes}"` : ''}`,
      },
    });

    return created(res, { ...review, perTaskPps }, 'Review submitted');
  } catch (err) {
    next(err);
  }
}

module.exports = { submitReview, getMyReviews, getReviewForTask, getReviewedTaskIds };
