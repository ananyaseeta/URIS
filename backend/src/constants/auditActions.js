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
  LOGIN:    'LOGIN',
  REGISTER: 'REGISTER',
  LOGOUT:   'LOGOUT',

  // ── Tasks ──────────────────────────────────────────────────────────────────
  CREATE_TASK:        'CREATE_TASK',
  UPDATE_TASK:        'UPDATE_TASK',
  DELETE_TASK:        'DELETE_TASK',
  ASSIGN_TASK:        'ASSIGN_TASK',
  INTERN_UPDATE_TASK: 'INTERN_UPDATE_TASK',

  // ── Scores ─────────────────────────────────────────────────────────────────
  OVERRIDE_SCORE: 'OVERRIDE_SCORE',

  // ── Reviews ────────────────────────────────────────────────────────────────
  SUBMIT_REVIEW: 'SUBMIT_REVIEW',

  // ── Alerts ─────────────────────────────────────────────────────────────────
  RESOLVE_ALERT: 'RESOLVE_ALERT',

  // ── Phase 2: Security & Governance ────────────────────────────────────────
  BLOCK_IP:         'BLOCK_IP',
  UNBLOCK_IP:       'UNBLOCK_IP',
  CHANGE_USER_ROLE: 'CHANGE_USER_ROLE',
  APPROVE_USER:     'APPROVE_USER',
  FINISH_INTERNSHIP:'FINISH_INTERNSHIP',

  // ── Phase 3: Support system ────────────────────────────────────────────────
  CREATE_SUPPORT_REQUEST:  'CREATE_SUPPORT_REQUEST',
  ASSIGN_SUPPORT_REQUEST:  'ASSIGN_SUPPORT_REQUEST',
  UPDATE_SUPPORT_REQUEST_STATUS: 'UPDATE_SUPPORT_REQUEST_STATUS',
  UPDATE_SUPPORT_NOTES:    'UPDATE_SUPPORT_NOTES',

  // ── Phase 3: Archive / Lifecycle ──────────────────────────────────────────
  DEACTIVATE_USER:   'DEACTIVATE_USER',
  ARCHIVE_USER:      'ARCHIVE_USER',
  RESTORE_USER:      'RESTORE_USER',
  MARK_USER_REMOVED: 'MARK_USER_REMOVED',

  // ── Phase 6: Lifecycle (extended) ─────────────────────────────────────────
  // (same constants as Phase 3 — no new ones needed)

  // ── Phase 8: Governance & Approvals ───────────────────────────────────────
  PERMISSION_DENIED:        'PERMISSION_DENIED',
  REQUEST_APPROVAL:         'REQUEST_APPROVAL',
  APPROVE_ACTION:           'APPROVE_ACTION',
  REJECT_ACTION:            'REJECT_ACTION',
  CANCEL_APPROVAL:          'CANCEL_APPROVAL',
  EXECUTE_APPROVED_ACTION:  'EXECUTE_APPROVED_ACTION',
  UPDATE_ACCESS_MATRIX:     'UPDATE_ACCESS_MATRIX',
  APPROVE_USER:             'APPROVE_USER',
  REJECT_USER:              'REJECT_USER',
  DELETE_INTERN:            'DELETE_INTERN',
  UPDATE_INTERN:            'UPDATE_INTERN',
  SET_AVAILABILITY_DEADLINE:'SET_AVAILABILITY_DEADLINE',

  // ── Phase 9: Workflow & Collaboration ─────────────────────────────────────
  ADD_TASK_NOTE:            'ADD_TASK_NOTE',
  UPDATE_TASK_NOTE:         'UPDATE_TASK_NOTE',
  DELETE_TASK_NOTE:         'DELETE_TASK_NOTE',
  RAISE_ESCALATION:         'RAISE_ESCALATION',
  ACKNOWLEDGE_ESCALATION:   'ACKNOWLEDGE_ESCALATION',
  RESOLVE_ESCALATION:       'RESOLVE_ESCALATION',

  // ── Profile, Password & Email ──────────────────────────────────────────────
  PROFILE_UPDATE:   'PROFILE_UPDATE',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET:   'PASSWORD_RESET',
  UPLOAD_REJECTED:  'UPLOAD_REJECTED',

  // ── Task Collaboration & Observers ─────────────────────────────────────────
  ADD_TASK_COLLABORATOR:    'ADD_TASK_COLLABORATOR',
  REMOVE_TASK_COLLABORATOR: 'REMOVE_TASK_COLLABORATOR',
  ADD_TASK_OBSERVER:        'ADD_TASK_OBSERVER',
  REMOVE_TASK_OBSERVER:     'REMOVE_TASK_OBSERVER',

  // ── Virtual Presence ───────────────────────────────────────────────────────
  CHECK_IN:       'CHECK_IN',
  CHECK_OUT:      'CHECK_OUT',
  DECLARE_WINDOW: 'DECLARE_WINDOW',

  // ── Core Admin Delegation ──────────────────────────────────────────────────
  DELEGATE_CORE_ADMIN:        'DELEGATE_CORE_ADMIN',
  REVOKE_CORE_ADMIN_DELEGATE: 'REVOKE_CORE_ADMIN_DELEGATE',
});

/**
 * Audit entity constants — the type of record being acted on.
 */
const AUDIT_ENTITIES = Object.freeze({
  USER:     'USER',
  TASK:     'TASK',
  SCORE:    'SCORE',
  REVIEW:   'REVIEW',
  ALERT:    'ALERT',
  SYSTEM:   'SYSTEM',
  SUPPORT:  'SUPPORT',
  CONFIG:   'CONFIG',
  INTERN:   'INTERN',
  APPROVAL: 'APPROVAL',
  PRESENCE: 'PRESENCE',
});

module.exports = { AUDIT_ACTIONS, AUDIT_ENTITIES };
