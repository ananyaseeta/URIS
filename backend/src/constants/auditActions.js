/**
 * Audit action constants.
 *
 * Every loggable event in the system must have a constant here.
 * Format: VERB_NOUN in SCREAMING_SNAKE_CASE.
 *
 * Adding a new action:
 *   1. Add the constant here
 *   2. Call logAction(userId, AUDIT_ACTIONS.YOUR_ACTION, ...) in the service
 */

const AUDIT_ACTIONS = Object.freeze({
  // ── Auth ───────────────────────────────────────────────────────────────────
  LOGIN:           'LOGIN',
  REGISTER:        'REGISTER',
  LOGOUT:          'LOGOUT',

  // ── Tasks ──────────────────────────────────────────────────────────────────
  CREATE_TASK:          'CREATE_TASK',
  UPDATE_TASK:          'UPDATE_TASK',
  DELETE_TASK:          'DELETE_TASK',
  ASSIGN_TASK:          'ASSIGN_TASK',
  INTERN_UPDATE_TASK:   'INTERN_UPDATE_TASK',

  // ── Scores ─────────────────────────────────────────────────────────────────
  OVERRIDE_SCORE:  'OVERRIDE_SCORE',

  // ── Reviews ────────────────────────────────────────────────────────────────
  SUBMIT_REVIEW:   'SUBMIT_REVIEW',

  // ── Alerts ─────────────────────────────────────────────────────────────────
  RESOLVE_ALERT:   'RESOLVE_ALERT',
});

/**
 * Audit entity constants — the type of record being acted on.
 */
const AUDIT_ENTITIES = Object.freeze({
  USER:   'USER',
  TASK:   'TASK',
  SCORE:  'SCORE',
  REVIEW: 'REVIEW',
  ALERT:  'ALERT',
});

module.exports = { AUDIT_ACTIONS, AUDIT_ENTITIES };
