'use strict';

/**
 * permissions.js — Phase 8 Enterprise Governance Layer
 *
 * Named capability constants that replace scattered role arrays in routes.
 *
 * Design:
 *   - Each PERMISSION maps to a set of ROLES that hold it.
 *   - requirePermission(PERMISSIONS.CAN_ASSIGN_TASKS) replaces
 *     requireRole(ROLES.CORE_ADMIN, ROLES.TECHNICAL_LEAD, ...) everywhere.
 *   - Adding a new role only requires updating the sets here — no route changes.
 *   - PERMISSIONS are the single source of truth for capability → role mapping.
 *
 * Usage (backend):
 *   const { requirePermission, PERMISSIONS } = require('../middleware/permission.middleware');
 *   router.post('/assign', verifyToken, requirePermission(PERMISSIONS.CAN_ASSIGN_TASKS), handler);
 *
 * Usage (frontend):
 *   const can = usePermission();
 *   if (can(PERMISSIONS.CAN_ASSIGN_TASKS)) { ... }
 */

const { ROLES } = require('./roles');

// ── Permission → Role mapping ─────────────────────────────────────────────────

/**
 * Each permission maps to the Set of roles that hold it.
 * Roles not listed for a permission are implicitly denied.
 */
const PERMISSION_ROLES = Object.freeze({

  // ── Task management ────────────────────────────────────────────────────────
  CAN_ASSIGN_TASKS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_CREATE_TASKS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_DELETE_TASKS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_UPDATE_TASK_STATUS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.OBSERVER_TEAM_LEAD,
    ROLES.COLLABORATOR_LEAD,
  ]),

  // ── Score management ───────────────────────────────────────────────────────
  CAN_OVERRIDE_SCORE: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.OBSERVER_TEAM_LEAD,
    ROLES.COLLABORATOR_LEAD,
  ]),

  // ── Review management ──────────────────────────────────────────────────────
  CAN_SUBMIT_REVIEW: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  // ── User lifecycle (sensitive — may require approval) ─────────────────────
  CAN_ARCHIVE_USERS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_RESTORE_USERS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_FINISH_INTERNSHIP: new Set([
    ROLES.CORE_ADMIN,
    ROLES.OPERATIONS_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
  ]),

  // ── Role management (sensitive — requires approval) ────────────────────────
  CAN_CHANGE_USER_ROLE: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_APPROVE_USERS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.OBSERVER_TEAM_LEAD,
    ROLES.COLLABORATOR_LEAD,
  ]),

  // ── Security management ────────────────────────────────────────────────────
  CAN_MANAGE_IP_BLOCKS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_VIEW_LOGIN_LOGS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  // ── Analytics & intelligence ───────────────────────────────────────────────
  CAN_VIEW_ANALYTICS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.OPERATIONS_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.TECHNICAL_LEAD,
    ROLES.RESEARCH_LEAD,
  ]),

  // ── Governance & approvals ─────────────────────────────────────────────────
  CAN_MANAGE_APPROVALS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_VIEW_AUDIT_LOGS: new Set([
    ROLES.CORE_ADMIN,
  ]),

  // ── Support management ─────────────────────────────────────────────────────
  CAN_MANAGE_SUPPORT: new Set([
    ROLES.CORE_ADMIN,
    ROLES.OPERATIONS_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
  ]),

  // ── Visibility ────────────────────────────────────────────────────────────
  CAN_VIEW_NOTES: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OBSERVER_TEAM_LEAD,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_VIEW_ALL_INTERNS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.OPERATIONS_LEAD,
  ]),

  CAN_VIEW_TEAM_INTERNS: new Set([
    ROLES.CORE_ADMIN,
    ROLES.OPERATIONS_LEAD,
    ROLES.TECHNICAL_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.OBSERVER_TEAM_LEAD,
    ROLES.COLLABORATOR_LEAD,
  ]),

  // ── Assignment target permissions ──────────────────────────────────────────
  // Controls which roles can assign tasks TO which target role category.
  // These are configurable via the Governance Access Matrix.
  //
  // Default policy (mirrors historical hardcoded behaviour):
  //   CORE_ADMIN can assign to everyone
  //   Leads/Managers can assign to leads and interns but NOT to core_admin
  //   Interns cannot assign at all (they lack CAN_ASSIGN_TASKS entirely)

  CAN_ASSIGN_TO_CORE_ADMIN: new Set([
    ROLES.CORE_ADMIN,
  ]),

  CAN_ASSIGN_TO_ADMIN: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_ASSIGN_TO_LEAD: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),

  CAN_ASSIGN_TO_INTERN: new Set([
    ROLES.CORE_ADMIN,
    ROLES.TECHNICAL_LEAD,
    ROLES.OPERATIONS_LEAD,
    ROLES.RESEARCH_LEAD,
    ROLES.OPERATIONS_PROGRAM_MANAGER,
    ROLES.COLLABORATOR_LEAD,
  ]),
});

/**
 * Permission name constants — use these instead of raw strings.
 * @type {Object.<string, string>}
 */
const PERMISSIONS = Object.freeze(
  Object.fromEntries(Object.keys(PERMISSION_ROLES).map(k => [k, k]))
);

/**
 * Check whether a role holds a given permission.
 * Checks configStore overrides first (live, database-backed).
 * Falls back to the static PERMISSION_ROLES defaults when no override exists.
 *
 * This is the SYNCHRONOUS form used by permission.middleware — it checks
 * an in-process override cache that is populated on first access.
 * Use roleHasPermissionAsync() for guaranteed-fresh DB reads.
 *
 * @param {string} role       - A value from ROLES
 * @param {string} permission - A key from PERMISSIONS
 * @param {Object} [runtimeOverrides] - Optional pre-fetched overrides (passed by async middleware)
 * @returns {boolean}
 */
function roleHasPermission(role, permission, runtimeOverrides) {
  // If runtime overrides are passed (from async middleware), use them
  if (runtimeOverrides && runtimeOverrides[role] !== undefined) {
    return runtimeOverrides[role].includes(permission);
  }
  // Fall back to static defaults
  const roleSet = PERMISSION_ROLES[permission];
  if (!roleSet) return false;
  return roleSet.has(role);
}

/**
 * Async version — always reads the latest overrides from the DB-backed
 * configStore before checking. Used by assignment validation.
 *
 * @param {string} role
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
async function roleHasPermissionAsync(role, permission) {
  try {
    const configStore = require('../services/configStore');
    const overrides = (await configStore.get('permission_overrides', {})) || {};
    if (overrides[role] !== undefined) {
      return overrides[role].includes(permission);
    }
  } catch { /* fall through to static defaults */ }
  const roleSet = PERMISSION_ROLES[permission];
  if (!roleSet) return false;
  return roleSet.has(role);
}

/**
 * Returns all permissions held by a given role.
 *
 * @param {string} role
 * @returns {string[]}
 */
function getPermissionsForRole(role) {
  return Object.entries(PERMISSION_ROLES)
    .filter(([, roleSet]) => roleSet.has(role))
    .map(([permission]) => permission);
}

module.exports = { PERMISSIONS, PERMISSION_ROLES, roleHasPermission, roleHasPermissionAsync, getPermissionsForRole };
