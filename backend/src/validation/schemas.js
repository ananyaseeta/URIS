/**
 * schemas.js — Centralised Joi validation schemas for every endpoint.
 *
 * Each schema validates { body, params, query } so the validate() middleware
 * can apply a single schema per route without splitting concerns.
 *
 * Naming convention:  schemas.<controllerFunction>
 * e.g.  schemas.createTask  →  POST /tasks/create
 *       schemas.getTasks     →  GET  /tasks/
 *
 * Design document field names are used throughout.
 * All ranges match the URIS V3 design specification exactly.
 */

'use strict';

const Joi = require('joi');

// ── Reusable primitives ────────────────────────────────────────────────────────

const uuid = Joi.string().uuid({ version: 'uuidv4' }).messages({
  'string.guid':    '{{#label}} must be a valid UUID',
  'string.base':    '{{#label}} must be a string',
});

// YYYY-MM-DD  — validated as a real calendar date, not just a pattern match
const isoDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const d = new Date(value);
    if (isNaN(d.getTime())) return helpers.error('date.invalid');
    return value;
  })
  .messages({
    'string.pattern.base': '{{#label}} must be a date in YYYY-MM-DD format',
    'date.invalid':        '{{#label}} is not a valid calendar date',
  });

// HH:MM  — used for busy-block time ranges
const hhMm = Joi.string()
  .pattern(/^\d{2}:\d{2}$/)
  .messages({ 'string.pattern.base': '{{#label}} must be in HH:MM format' });

// 1–5 integer score used across reviews and performance
const score1to5 = Joi.number().integer().min(1).max(5).messages({
  'number.base':    '{{#label}} must be a number',
  'number.integer': '{{#label}} must be an integer',
  'number.min':     '{{#label}} must be between 1 and 5',
  'number.max':     '{{#label}} must be between 1 and 5',
});

// ── Domain constants (match design document exactly) ──────────────────────────

const VALID_TASK_STATUSES = [
  'backlog', 'in_progress_early', 'in_progress_mid',
  'under_review', 'completed', 'active', 'paused', 'stale',
];

// Design §7.1 — week-status toggle values + accepted synonyms
const VALID_WEEK_STATUSES = [
  'normal', 'busy', 'exam', 'free',
  'generally_free', 'light_week', 'heavy_week', 'exam_week', 'regular',
];

const VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// Design §7.1 — reason_code dropdown for busy blocks
const VALID_REASON_CODES = [
  'Exam', 'Revision', 'Academic Project', 'Personal', 'Sprint', 'Other',
];

// Design §8.1 — skill taxonomy for ASL filter
const VALID_SKILL_TAGS = [
  'Frontend', 'Backend', 'Testing', 'Documentation',
  'AI/ML', 'Research', 'Design', 'DevOps',
];

// Design §8.1 — duration categories
const VALID_DURATION_CATEGORIES = ['short', 'medium', 'long'];

// Design §8.3 — blocker types
const VALID_BLOCKER_TYPES = [
  'none', 'code_review', 'manager_approval',
  'api_access', 'dependency', 'unclear_req',
];

// ── Auth ───────────────────────────────────────────────────────────────────────

const register = Joi.object({
  body: Joi.object({
    email:    Joi.string().email().required().messages({
      'string.email': 'email must be a valid email address',
      'any.required': 'email is required',
    }),
    password: Joi.string().min(6).required().messages({
      'string.min':   'password must be at least 6 characters',
      'any.required': 'password is required',
    }),
    role: Joi.string().valid('intern', 'admin').default('intern').messages({
      'any.only': 'role must be one of: intern, admin',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

const login = Joi.object({
  body: Joi.object({
    email:    Joi.string().email().required().messages({
      'string.email': 'email must be a valid email address',
      'any.required': 'email is required',
    }),
    password: Joi.string().min(1).required().messages({
      'any.required': 'password is required',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

const recordActivity = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('TASK_WORK', 'IDLE').required().messages({
      'any.only':     'type must be one of: TASK_WORK, IDLE',
      'any.required': 'type is required',
    }),
    // Max 24 hours per single activity record
    duration: Joi.number().min(0).max(86400).required().messages({
      'number.min':   'duration must be a non-negative number',
      'number.max':   'duration must not exceed 86400 seconds (24 hours)',
      'any.required': 'duration is required',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// ── Availability ───────────────────────────────────────────────────────────────
//
// Design §7.1 — busy block structure:
//   { day, reason_code, severity }
//   Optional start/end times for granular blocking
//
// Design §12.2 — availability_slots fields:
//   week_status_toggle: ENUM('generally_free','heavy_week')
//   busy_blocks: JSONB array of { day, reason_code, severity }
//   max_free_block_hrs: SMALLINT CHECK(1..3)
//   is_exam_week: BOOLEAN
//   notes: VARCHAR(140)

const busyBlock = Joi.object({
  day: Joi.string()
    .valid(...VALID_DAYS)
    .required()
    .messages({
      'any.only':     `day must be one of: ${VALID_DAYS.join(', ')}`,
      'any.required': 'day is required in each busy block',
    }),
  reason_code: Joi.string()
    .valid(...VALID_REASON_CODES)
    .required()
    .messages({
      'any.only':     `reason_code must be one of: ${VALID_REASON_CODES.join(', ')}`,
      'any.required': 'reason_code is required in each busy block',
    }),
  severity: Joi.string()
    .valid('low', 'medium', 'high')
    .default('medium')
    .messages({ 'any.only': 'severity must be one of: low, medium, high' }),
  // Optional granular time range within the day
  start: hhMm.optional(),
  end:   hhMm.optional(),
}).and('start', 'end');  // if one time field is present, both must be

const submitAvailability = Joi.object({
  body: Joi.object({
    // Design §12.2 — week_start is a DATE (Monday of the reported week)
    weekStart: isoDate.required().messages({
      'any.required': 'weekStart is required',
    }),
    // Design §12.2 — week_end is exactly 7 days after week_start
    weekEnd: isoDate.required().messages({
      'any.required': 'weekEnd is required',
    }),
    // Design §7.1 — week-status toggle
    weekStatusToggle: Joi.string()
      .valid(...VALID_WEEK_STATUSES)
      .required()
      .messages({
        'any.only':     `weekStatusToggle must be one of: ${VALID_WEEK_STATUSES.join(', ')}`,
        'any.required': 'weekStatusToggle is required',
      }),
    // Design §12.2 — max_free_block_hrs CHECK(1..3)
    maxFreeBlockHours: Joi.number()
      .integer()
      .min(1)
      .max(3)
      .required()
      .messages({
        'number.min':   'maxFreeBlockHours must be between 1 and 3',
        'number.max':   'maxFreeBlockHours must be between 1 and 3',
        'any.required': 'maxFreeBlockHours is required',
      }),
    busyBlocks: Joi.array()
      .items(busyBlock)
      .max(14)   // at most 2 blocks per day × 7 days
      .required()
      .messages({
        'any.required': 'busyBlocks is required',
        'array.base':   'busyBlocks must be an array',
        'array.max':    'busyBlocks must not exceed 14 entries',
      }),
    // Design §12.2 — is_exam_week BOOLEAN
    isExamWeek: Joi.boolean().default(false),
    // Design §12.2 — notes VARCHAR(140)
    notes: Joi.string().max(140).optional().allow('', null).messages({
      'string.max': 'notes must not exceed 140 characters',
    }),
  })
  .required()
  // weekEnd must be exactly 7 days after weekStart
  .custom((value, helpers) => {
    if (value.weekStart && value.weekEnd) {
      const start = new Date(value.weekStart);
      const end   = new Date(value.weekEnd);
      const diffDays = (end - start) / (1000 * 60 * 60 * 24);
      if (diffDays !== 7) {
        return helpers.error('any.invalid', {
          message: 'weekEnd must be exactly 7 days after weekStart',
        });
      }
    }
    return value;
  })
  .messages({ 'any.invalid': 'weekEnd must be exactly 7 days after weekStart' }),
  params: Joi.object(),
  query:  Joi.object(),
});

const getAvailability = Joi.object({
  body:   Joi.object(),
  params: Joi.object({
    internId:  uuid.required().messages({ 'any.required': 'internId param is required' }),
    weekStart: isoDate.required().messages({ 'any.required': 'weekStart param is required' }),
  }).required(),
  query: Joi.object(),
});

// ── Tasks ──────────────────────────────────────────────────────────────────────
//
// Design §8.1 — task definition fields:
//   title, description, deadline, priority
//   required_skill_tags: TEXT[] from 8-category taxonomy
//   task_complexity: INTEGER CHECK(1..5)
//   duration_category: ENUM('short','medium','long')
//   primary_manager_id, secondary_manager_id: UUID
//   plane_issue_id: VARCHAR(100)

const createTask = Joi.object({
  body: Joi.object({
    title: Joi.string().trim().min(1).max(255).required().messages({
      'string.min':   'title must not be empty',
      'string.max':   'title must not exceed 255 characters',
      'any.required': 'title is required',
    }),
    description: Joi.string().max(2000).optional().allow('', null).messages({
      'string.max': 'description must not exceed 2000 characters',
    }),
    internId: uuid.required().messages({
      'any.required': 'internId is required',
    }),
    planeTaskId: Joi.string().trim().min(1).max(100).optional().allow('', null).messages({
      'string.max': 'planeTaskId must not exceed 100 characters',
    }),
    // Design §8.1 — task_complexity INTEGER CHECK(1..5)
    complexity: Joi.number().integer().min(1).max(5).required().messages({
      'number.base':    'complexity must be a number',
      'number.integer': 'complexity must be an integer',
      'number.min':     'complexity must be between 1 and 5',
      'number.max':     'complexity must be between 1 and 5',
      'any.required':   'complexity is required',
    }),
    // Design §8.1 — duration_category ENUM('short','medium','long')
    durationCategory: Joi.string()
      .valid(...VALID_DURATION_CATEGORIES)
      .required()
      .messages({
        'any.only':     `durationCategory must be one of: ${VALID_DURATION_CATEGORIES.join(', ')}`,
        'any.required': 'durationCategory is required',
      }),
    // Design §8.1 — required_skill_tags from 8-category taxonomy
    requiredSkillTags: Joi.array()
      .items(Joi.string().valid(...VALID_SKILL_TAGS).messages({
        'any.only': `each skill tag must be one of: ${VALID_SKILL_TAGS.join(', ')}`,
      }))
      .min(1)
      .max(8)
      .required()
      .messages({
        'array.min':    'at least one skill tag is required',
        'array.max':    'requiredSkillTags must not exceed 8 items',
        'any.required': 'requiredSkillTags is required',
      }),
    // Design §8.1 — primary_manager_id (required), secondary_manager_id (optional)
    primaryManagerId: uuid.required().messages({
      'any.required': 'primaryManagerId is required',
    }),
    secondaryManagerId: uuid.optional(),
    // Design §12.3 — deadline DATE NOT NULL
    deadline: isoDate.required().messages({
      'any.required': 'deadline is required',
    }),
    priority: Joi.string()
      .valid('low', 'medium', 'high', 'critical')
      .default('medium')
      .messages({ 'any.only': 'priority must be one of: low, medium, high, critical' }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

const getTasks = Joi.object({
  body:   Joi.object(),
  params: Joi.object(),
  query:  Joi.object({
    status: Joi.string().valid(...VALID_TASK_STATUSES).optional().messages({
      'any.only': `status must be one of: ${VALID_TASK_STATUSES.join(', ')}`,
    }),
    page:  Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      'number.max': 'limit must not exceed 100',
    }),
  }),
});

// ── Reviews ────────────────────────────────────────────────────────────────────
//
// Design §9.1 — three review dimensions, each 1–5:
//   quality_score      (weight 0.40)
//   timeliness_score   (weight 0.35)
//   independence_score (weight 0.25)
//
// Design §9.2 — PPS = (Quality×0.40) + (Timeliness×0.35) + (Independence×0.25)
// taskId is required — review must be linked to a completed task

const submitReview = Joi.object({
  body: Joi.object({
    // taskId links the review to the completed task (design §9.1)
    taskId: uuid.required().messages({
      'any.required': 'taskId is required',
    }),
    internId: uuid.required().messages({
      'any.required': 'internId is required',
    }),
    // Design §9.1 — quality_score 1–5 (weight 0.40)
    qualityScore: score1to5.required().messages({
      'any.required': 'qualityScore is required',
    }),
    // Design §9.1 — timeliness_score 1–5 (weight 0.35)
    timelinessScore: score1to5.required().messages({
      'any.required': 'timelinessScore is required',
    }),
    // Design §9.1 — independence_score 1–5 (weight 0.25)
    independenceScore: score1to5.required().messages({
      'any.required': 'independenceScore is required',
    }),
    // Optional qualitative notes (design §12.4)
    reviewNotes: Joi.string().max(2000).optional().allow('', null).messages({
      'string.max': 'reviewNotes must not exceed 2000 characters',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// ── Admin ──────────────────────────────────────────────────────────────────────

const overrideScore = Joi.object({
  body: Joi.object({
    internId: uuid.required().messages({ 'any.required': 'internId is required' }),
    overrideScore: Joi.number().min(0).max(100).required().messages({
      'number.min':   'overrideScore must be between 0 and 100',
      'number.max':   'overrideScore must be between 0 and 100',
      'any.required': 'overrideScore is required',
    }),
    reason: Joi.string().max(500).optional().allow('', null).messages({
      'string.max': 'reason must not exceed 500 characters',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

const updateTaskStatus = Joi.object({
  body: Joi.object({
    taskId: uuid.required().messages({ 'any.required': 'taskId is required' }),
    status: Joi.string()
      .valid(...VALID_TASK_STATUSES)
      .required()
      .messages({
        'any.only':     `status must be one of: ${VALID_TASK_STATUSES.join(', ')}`,
        'any.required': 'status is required',
      }),
    // Design §8.2 — progress maps to micro-status: 0/25/50/75/100
    progress: Joi.number()
      .integer()
      .valid(0, 25, 50, 75, 100)
      .optional()
      .messages({
        'any.only': 'progress must be one of the micro-status values: 0, 25, 50, 75, 100',
      }),
    // Design §8.2 — mandatory progress note (min 20 chars) on every status change
    progressNote: Joi.string().min(20).max(500).optional().messages({
      'string.min': 'progressNote must be at least 20 characters',
      'string.max': 'progressNote must not exceed 500 characters',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// Intern self-update — progress percentage + optional note only
// Interns cannot change status to 'completed' (admin-only action)
const internUpdateTask = Joi.object({
  body: Joi.object({
    progressPct: Joi.number()
      .integer()
      .min(0)
      .max(99)
      .required()
      .messages({
        'number.base':    'progressPct must be a number',
        'number.integer': 'progressPct must be an integer',
        'number.min':     'progressPct must be between 0 and 99',
        'number.max':     'progressPct must be between 0 and 99 — only admins can mark tasks complete',
        'any.required':   'progressPct is required',
      }),
    note: Joi.string().max(280).optional().allow('', null).messages({
      'string.max': 'note must not exceed 280 characters',
    }),
    hasBlocker: Joi.boolean().optional(),
    blockerType: Joi.string()
      .valid(...VALID_BLOCKER_TYPES)
      .optional()
      .messages({ 'any.only': `blockerType must be one of: ${VALID_BLOCKER_TYPES.join(', ')}` }),
  }).required(),
  params: Joi.object({
    taskId: uuid.required().messages({ 'any.required': 'taskId param is required' }),
  }).required(),
  query: Joi.object(),
});

// ── Assignment ─────────────────────────────────────────────────────────────────
//
// Design §11.3 — ASL Triad: Availability → Skill → Load
// getShortlist accepts the task definition to filter and rank interns

const getShortlist = Joi.object({
  body: Joi.object({
    task: Joi.object({
      // Design §8.1 — required_skill_tags from taxonomy
      requiredSkills: Joi.array()
        .items(Joi.string().valid(...VALID_SKILL_TAGS).messages({
          'any.only': `each skill must be one of: ${VALID_SKILL_TAGS.join(', ')}`,
        }))
        .min(1)
        .max(8)
        .required()
        .messages({
          'array.min':    'at least one required skill must be specified',
          'array.max':    'requiredSkills must not exceed 8 items',
          'any.required': 'task.requiredSkills is required',
        }),
      // Design §8.1 — task_complexity INTEGER CHECK(1..5)
      complexity: Joi.number().integer().min(1).max(5).optional().messages({
        'number.min': 'task complexity must be between 1 and 5',
        'number.max': 'task complexity must be between 1 and 5',
      }),
      // Design §8.1 — duration_category
      durationCategory: Joi.string()
        .valid(...VALID_DURATION_CATEGORIES)
        .optional()
        .messages({ 'any.only': `durationCategory must be one of: ${VALID_DURATION_CATEGORIES.join(', ')}` }),
      topN: Joi.number().integer().min(1).max(50).default(5),
    }).required().messages({ 'any.required': 'task object is required' }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// Design §11.4 — assignTask: internId + taskId, both UUIDs
const assignTask = Joi.object({
  body: Joi.object({
    internId: uuid.required().messages({ 'any.required': 'internId is required' }),
    taskId:   uuid.required().messages({ 'any.required': 'taskId is required' }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// ── Credibility ────────────────────────────────────────────────────────────────

const getCredibility = Joi.object({
  body:   Joi.object(),
  params: Joi.object(),
  query:  Joi.object({
    internId: uuid.required().messages({ 'any.required': 'internId query param is required' }),
  }).required(),
});

// ── Performance ────────────────────────────────────────────────────────────────

const getPerformance = Joi.object({
  body:   Joi.object(),
  params: Joi.object({
    internId: uuid.required().messages({ 'any.required': 'internId param is required' }),
  }).required(),
  query: Joi.object(),
});

// ── Score history ──────────────────────────────────────────────────────────────

const getScoreHistory = Joi.object({
  body:   Joi.object(),
  params: Joi.object({
    internId: uuid.required().messages({ 'any.required': 'internId param is required' }),
  }).required(),
  query: Joi.object(),
});

// ── Alerts ─────────────────────────────────────────────────────────────────────

const resolveAlert = Joi.object({
  body:   Joi.object(),
  params: Joi.object({
    id: uuid.required().messages({ 'any.required': 'alert id param is required' }),
  }).required(),
  query: Joi.object(),
});

const getAlerts = Joi.object({
  body:   Joi.object(),
  params: Joi.object(),
  query:  Joi.object({
    type:     Joi.string().max(50).optional(),
    severity: Joi.string().valid('warning', 'critical').optional().messages({
      'any.only': 'severity must be one of: warning, critical',
    }),
  }),
});

// ── Activity ───────────────────────────────────────────────────────────────────

const getActivitySummary = Joi.object({
  body:   Joi.object(),
  params: Joi.object(),
  query:  Joi.object({
    userId: uuid.optional(),
  }),
});

// ── Teams ──────────────────────────────────────────────────────────────────────

const createTeam = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().min(1).max(100).required().messages({
      'string.min':   'name must not be empty',
      'string.max':   'name must not exceed 100 characters',
      'any.required': 'name is required',
    }),
    description: Joi.string().max(500).optional().allow('', null).messages({
      'string.max': 'description must not exceed 500 characters',
    }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

const teamIdParam = Joi.object({
  body:   Joi.object(),
  params: Joi.object({
    teamId: uuid.required().messages({ 'any.required': 'teamId param is required' }),
  }).required(),
  query: Joi.object(),
});

const joinTeam = Joi.object({
  body: Joi.object({
    role: Joi.string().valid('member', 'lead').default('member').messages({
      'any.only': 'role must be one of: member, lead',
    }),
  }),
  params: Joi.object({
    teamId: uuid.required().messages({ 'any.required': 'teamId param is required' }),
  }).required(),
  query: Joi.object(),
});

// ── Audit logs ─────────────────────────────────────────────────────────────────

const getAuditLogs = Joi.object({
  body:   Joi.object(),
  params: Joi.object(),
  query:  Joi.object({
    action: Joi.string().max(50).optional(),
    entity: Joi.string().max(50).optional(),
    userId: uuid.optional(),
    from:   isoDate.optional(),
    to:     isoDate.optional(),
    page:   Joi.number().integer().min(1).default(1),
    limit:  Joi.number().integer().min(1).max(100).default(25).messages({
      'number.max': 'limit must not exceed 100',
    }),
  }),
});

// ── Demo ───────────────────────────────────────────────────────────────────────

const runDemo = Joi.object({
  body: Joi.object({
    busyBlocks: Joi.array().items(busyBlock).required().messages({
      'any.required': 'busyBlocks is required',
      'array.base':   'busyBlocks must be an array',
    }),
    maxFreeBlockHours: Joi.number().integer().min(1).max(3).required().messages({
      'number.min':   'maxFreeBlockHours must be between 1 and 3',
      'number.max':   'maxFreeBlockHours must be between 1 and 3',
      'any.required': 'maxFreeBlockHours is required',
    }),
    weekStatusToggle: Joi.string().valid(...VALID_WEEK_STATUSES).required().messages({
      'any.only':     `weekStatusToggle must be one of: ${VALID_WEEK_STATUSES.join(', ')}`,
      'any.required': 'weekStatusToggle is required',
    }),
    task: Joi.object({
      requiredSkills: Joi.array().items(Joi.string()).max(20).required(),
      topN:           Joi.number().integer().min(1).max(50).default(5),
    }).required().messages({ 'any.required': 'task object is required' }),
  }).required(),
  params: Joi.object(),
  query:  Joi.object(),
});

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  schemas: {
    // auth
    register,
    login,
    recordActivity,
    // availability
    submitAvailability,
    getAvailability,
    // tasks
    createTask,
    getTasks,
    // reviews
    submitReview,
    // admin
    overrideScore,
    updateTaskStatus,
    internUpdateTask,
    // assignment
    getShortlist,
    assignTask,
    // credibility
    getCredibility,
    // performance
    getPerformance,
    // score
    getScoreHistory,
    // alerts
    resolveAlert,
    getAlerts,
    // activity
    getActivitySummary,
    // teams
    createTeam,
    teamIdParam,
    joinTeam,
    // audit logs
    getAuditLogs,
    // demo
    runDemo,
  },
  // Export domain constants so routes/controllers can import them without
  // duplicating the source-of-truth lists
  constants: {
    VALID_SKILL_TAGS,
    VALID_DURATION_CATEGORIES,
    VALID_BLOCKER_TYPES,
    VALID_WEEK_STATUSES,
    VALID_REASON_CODES,
    VALID_TASK_STATUSES,
    VALID_DAYS,
  },
};
