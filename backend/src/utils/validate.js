const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM    = /^\d{2}:\d{2}$/;

// RFC-5322 simplified — catches the vast majority of invalid emails without
// being so strict it rejects valid ones.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_MIN_LENGTH = 6;

// ── Single source of truth for task statuses ──────────────────────────────────
// Imported from schemas.js constants to avoid duplication.
// Any change to valid statuses must be made in schemas.js only.
const { constants: schemaConstants } = require('../validation/schemas');
const VALID_TASK_STATUSES = schemaConstants.VALID_TASK_STATUSES;

/**
 * Validates auth input fields (register + login).
 *
 * @param {{ email?: unknown, password?: unknown }} fields
 * @returns {string[]} Array of human-readable error messages (empty = valid)
 */
function validateAuth({ email, password } = {}) {
  const errors = [];

  // ── Email ──────────────────────────────────────────────────────────────────
  if (!email || typeof email !== 'string' || email.trim() === '') {
    errors.push('Email is required.');
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.push('Email must be a valid email address.');
  }

  // ── Password ───────────────────────────────────────────────────────────────
  if (!password || typeof password !== 'string' || password.trim() === '') {
    errors.push('Password is required.');
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  return errors;
}

function validateAvailability(data) {
  const errors = [];
  const { internId, weekStart, weekEnd, busyBlocks, maxFreeBlockHours } = data || {};

  // Required fields
  if (!internId)              errors.push('internId is required');
  if (!weekStart)             errors.push('weekStart is required');
  if (!weekEnd)               errors.push('weekEnd is required');
  if (busyBlocks == null)     errors.push('busyBlocks is required');
  if (maxFreeBlockHours == null) errors.push('maxFreeBlockHours is required');

  // Date format
  if (weekStart && !ISO_DATE.test(weekStart)) errors.push('weekStart must be a valid date (YYYY-MM-DD)');
  if (weekEnd   && !ISO_DATE.test(weekEnd))   errors.push('weekEnd must be a valid date (YYYY-MM-DD)');

  // Date range — exactly 7 days
  if (weekStart && weekEnd && ISO_DATE.test(weekStart) && ISO_DATE.test(weekEnd)) {
    const diff = (new Date(weekEnd) - new Date(weekStart)) / (1000 * 60 * 60 * 24);
    if (diff !== 7) errors.push('weekEnd must be exactly 7 days after weekStart');
  }

  // maxFreeBlockHours
  if (maxFreeBlockHours != null && (maxFreeBlockHours < 1 || maxFreeBlockHours > 3))
    errors.push('maxFreeBlockHours must be between 1 and 3');

  // busyBlocks structure
  if (busyBlocks != null) {
    if (!Array.isArray(busyBlocks)) {
      errors.push('busyBlocks must be an array');
    } else {
      const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

      busyBlocks.forEach((block, i) => {
        const prefix = `busyBlocks[${i}]`;

        if (!block.day)   errors.push(`${prefix}.day is required`);
        else if (!DAYS.includes(block.day)) errors.push(`${prefix}.day must be one of ${DAYS.join(', ')}`);

        if (!block.start) errors.push(`${prefix}.start is required`);
        else if (!HH_MM.test(block.start)) errors.push(`${prefix}.start must be in HH:MM format`);

        if (!block.end)   errors.push(`${prefix}.end is required`);
        else if (!HH_MM.test(block.end)) errors.push(`${prefix}.end must be in HH:MM format`);

        if (block.start && block.end && HH_MM.test(block.start) && HH_MM.test(block.end)) {
          if (block.start >= block.end)
            errors.push(`${prefix}: start must be before end`);
        }
      });

      // Overlap check per day
      const byDay = {};
      busyBlocks.forEach(b => {
        if (b.day) (byDay[b.day] = byDay[b.day] || []).push(b);
      });
      for (const [day, blocks] of Object.entries(byDay)) {
        const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].start < sorted[i - 1].end)
            errors.push(`busyBlocks on ${day} have overlapping time ranges`);
        }
      }
    }
  }

  return errors;
}

// ── UUID ───────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// ── ISO date (YYYY-MM-DD) ──────────────────────────────────────────────────────
function isISODate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !isNaN(Date.parse(value));
}

// ── Task creation ──────────────────────────────────────────────────────────────
const VALID_TASK_SKILLS = [
  'Frontend', 'Backend', 'Testing', 'Documentation',
  'AI/ML', 'Research', 'Design', 'DevOps',
];

function validateCreateTask(data) {
  const errors = [];
  const { title, complexity, internId, planeTaskId, skills, deadline } = data || {};

  if (!title || typeof title !== 'string' || title.trim() === '')
    errors.push('title is required and must be a non-empty string');
  else if (title.trim().length > 255)
    errors.push('title must not exceed 255 characters');

  if (!internId)
    errors.push('internId is required');
  else if (!isUUID(internId))
    errors.push('internId must be a valid UUID');

  if (!planeTaskId || typeof planeTaskId !== 'string' || planeTaskId.trim() === '')
    errors.push('planeTaskId is required and must be a non-empty string');

  if (typeof complexity !== 'number' || complexity < 1 || complexity > 5)
    errors.push('complexity must be a number between 1 and 5');

  if (skills !== undefined) {
    if (!Array.isArray(skills))
      errors.push('skills must be an array');
    else {
      skills.forEach((s, i) => {
        if (typeof s !== 'string')
          errors.push(`skills[${i}] must be a string`);
      });
    }
  }

  if (deadline !== undefined && deadline !== null) {
    if (!isISODate(deadline))
      errors.push('deadline must be a valid date in YYYY-MM-DD format');
  }

  return errors;
}

// ── Task status update ─────────────────────────────────────────────────────────
// VALID_TASK_STATUSES is imported from schemas.js at the top of this file.

function validateUpdateTaskStatus(data) {
  const errors = [];
  const { taskId, status, progress } = data || {};

  if (!taskId)
    errors.push('taskId is required');
  else if (!isUUID(taskId))
    errors.push('taskId must be a valid UUID');

  if (!status || !VALID_TASK_STATUSES.includes(status))
    errors.push(`status must be one of: ${VALID_TASK_STATUSES.join(', ')}`);

  if (progress !== undefined) {
    if (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress > 100)
      errors.push('progress must be an integer between 0 and 100');
  }

  return errors;
}

// ── Review submission ──────────────────────────────────────────────────────────
function validateSubmitReview(data) {
  const errors = [];
  const { internId, quality, timeliness, initiative, complexity } = data || {};

  if (!internId)
    errors.push('internId is required');
  else if (!isUUID(internId))
    errors.push('internId must be a valid UUID');

  const inRange = (val, min, max) => typeof val === 'number' && val >= min && val <= max;

  if (!inRange(quality, 1, 5))     errors.push('quality must be a number between 1 and 5');
  if (!inRange(timeliness, 1, 5))  errors.push('timeliness must be a number between 1 and 5');
  if (!inRange(initiative, 1, 5))  errors.push('initiative must be a number between 1 and 5');
  if (!inRange(complexity, 1, 3))  errors.push('complexity must be a number between 1 and 3');

  return errors;
}

// ── Assignment ─────────────────────────────────────────────────────────────────
function validateAssignTask(data) {
  const errors = [];
  const { internId, taskId } = data || {};

  if (!internId)
    errors.push('internId is required');
  else if (!isUUID(internId))
    errors.push('internId must be a valid UUID');

  if (!taskId)
    errors.push('taskId is required');
  else if (!isUUID(taskId))
    errors.push('taskId must be a valid UUID');

  return errors;
}

function validateGetShortlist(data) {
  const errors = [];
  const { task } = data || {};

  if (!task || typeof task !== 'object')
    errors.push('task object is required');
  else {
    if (!Array.isArray(task.requiredSkills))
      errors.push('task.requiredSkills must be an array');
    else {
      if (task.requiredSkills.length > 20)
        errors.push('task.requiredSkills must not exceed 20 items');
      task.requiredSkills.forEach((s, i) => {
        if (typeof s !== 'string')
          errors.push(`task.requiredSkills[${i}] must be a string`);
      });
    }
    if (task.topN !== undefined) {
      if (typeof task.topN !== 'number' || task.topN < 1 || task.topN > 50)
        errors.push('task.topN must be a number between 1 and 50');
    }
  }

  return errors;
}

// ── Demo pipeline ──────────────────────────────────────────────────────────────
const VALID_WEEK_STATUSES_DEMO = [
  'normal', 'busy', 'exam', 'free',
  'generally_free', 'light_week', 'heavy_week', 'exam_week', 'regular',
];

function validateRunDemo(data) {
  const errors = [];
  const { busyBlocks, maxFreeBlockHours, weekStatusToggle, task } = data || {};

  if (!Array.isArray(busyBlocks))
    errors.push('busyBlocks must be an array');

  if (typeof maxFreeBlockHours !== 'number' || maxFreeBlockHours < 1 || maxFreeBlockHours > 6)
    errors.push('maxFreeBlockHours must be a number between 1 and 6');

  if (!weekStatusToggle || !VALID_WEEK_STATUSES_DEMO.includes(weekStatusToggle))
    errors.push(`weekStatusToggle must be one of: ${VALID_WEEK_STATUSES_DEMO.join(', ')}`);

  if (!task || typeof task !== 'object')
    errors.push('task object is required');
  else if (!Array.isArray(task.requiredSkills))
    errors.push('task.requiredSkills must be an array');

  return errors;
}

// ── Pagination ─────────────────────────────────────────────────────────────────
// Status filter uses the same set as VALID_TASK_STATUSES (imported above).

function validatePagination({ page, limit, status } = {}) {
  const errors = [];

  const p = parseInt(page);
  const l = parseInt(limit);

  if (page !== undefined && (isNaN(p) || p < 1))
    errors.push('page must be a positive integer');

  if (limit !== undefined && (isNaN(l) || l < 1 || l > 100))
    errors.push('limit must be an integer between 1 and 100');

  if (status !== undefined && !VALID_TASK_STATUSES.includes(status.toLowerCase()))
    errors.push(`status must be one of: ${VALID_TASK_STATUSES.join(', ')}`);

  return errors;
}

module.exports = {
  validateAvailability,
  validateAuth,
  validateCreateTask,
  validateUpdateTaskStatus,
  validateSubmitReview,
  validateAssignTask,
  validateGetShortlist,
  validateRunDemo,
  validatePagination,
  isUUID,
  isISODate,
};
