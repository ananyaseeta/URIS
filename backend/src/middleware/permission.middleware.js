'use strict';

/**
 * permission.middleware.js — Phase 8 Enterprise Governance Layer
 *
 * requirePermission(permission) — Express middleware factory.
 *
 * Replaces scattered requireRole(ROLES.X, ROLES.Y, ...) calls with a single
 * named capability check. The role → permission mapping lives in
 * constants/permissions.js — routes never need to know which roles hold a
 * permission.
 *
 * Must be used after verifyToken.
 *
 * @example
 *   router.post('/assign', verifyToken, requirePermission(PERMISSIONS.CAN_ASSIGN_TASKS), handler)
 *
 * Audit logging:
 *   Every denied request is logged to AuditLog (same as requireRole).
 *   Approved requests are NOT logged here — controllers log their own actions.
 */

const { roleHasPermission, PERMISSIONS } = require('../constants/permissions');
const { forbidden } = require('../utils/respond');
const logger = require('../utils/logger');

/**
 * Validates that a permission name is known at startup.
 * Throws if the permission string is not in PERMISSIONS — catches typos early.
 *
 * @param {string} permission
 */
function assertValidPermission(permission) {
  if (!PERMISSIONS[permission]) {
    throw new Error(
      `requirePermission: "${permission}" is not a valid permission. ` +
      `Valid permissions: ${Object.keys(PERMISSIONS).join(', ')}`
    );
  }
}

/**
 * Express middleware factory — enforces a named permission.
 * Checks the live DB-backed permission overrides so changes in the
 * Governance Access Matrix take effect immediately without a server restart.
 *
 * @param {string} permission - A key from PERMISSIONS
 * @returns {import('express').RequestHandler}
 */
function requirePermission(permission) {
  // Validate at module load time — fail fast on typos
  assertValidPermission(permission);

  return async (req, res, next) => {
    // Use effectiveRole (set by delegation) if available, else use JWT role
    const role = req.user?.effectiveRole || req.user?.role;

    // Load live overrides from configStore (DB-backed, in-process cache)
    let overrides = {};
    try {
      const configStore = require('../services/configStore');
      overrides = (await configStore.get('permission_overrides', {})) || {};
    } catch { /* non-fatal — fall back to static defaults */ }

    if (!role || !roleHasPermission(role, permission, overrides)) {
      // Fire-and-forget audit log — same pattern as requireRole
      if (req.user) {
        const { logAction } = require('../utils/auditLogger');
        void logAction(req.user.id, 'PERMISSION_DENIED', 'SYSTEM', null, {
          permission,
          role,
          path:   req.originalUrl,
          method: req.method,
        });
      }

      logger.warn({ permission, role, path: req.originalUrl }, 'Permission denied');
      return forbidden(res, `Access denied. Missing permission: ${permission}`);
    }

    next();
  };
}

module.exports = { requirePermission };
