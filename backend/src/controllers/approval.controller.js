'use strict';

/**
 * approval.controller.js — Phase 8 Enterprise Governance Layer
 *
 * Handles the approval workflow HTTP layer.
 * All business logic lives in approvalService.js.
 */

const {
  APPROVAL_ACTIONS,
  requestApproval,
  approveRequest,
  rejectRequest,
  cancelRequest,
  listRequests,
} = require('../services/approvalService');
const { getPermissionsForRole } = require('../constants/permissions');
const { ok, created, validationError, notFound } = require('../utils/respond');
const { isUUID } = require('../utils/validate');

// ── GET /governance/approvals ─────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { status, action } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const data  = await listRequests({ status, action, page, limit });
    return ok(res, data, 'Approval requests fetched.');
  } catch (err) {
    next(err);
  }
}

// ── POST /governance/approvals ────────────────────────────────────────────────

async function request(req, res, next) {
  try {
    const { action, targetId, targetType, payload } = req.body;

    if (!action || !APPROVAL_ACTIONS[action]) {
      return validationError(res, `action must be one of: ${Object.keys(APPROVAL_ACTIONS).join(', ')}`);
    }
    if (!targetId || !isUUID(targetId)) {
      return validationError(res, 'targetId must be a valid UUID');
    }
    if (!targetType || !['USER', 'INTERN', 'TASK'].includes(targetType)) {
      return validationError(res, 'targetType must be one of: USER, INTERN, TASK');
    }
    if (!payload || typeof payload !== 'object') {
      return validationError(res, 'payload is required and must be an object');
    }

    const data = await requestApproval({
      action,
      targetId,
      targetType,
      requestedById: req.user.id,
      payload,
    });
    return created(res, data, 'Approval request submitted.');
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, data: null });
    next(err);
  }
}

// ── POST /governance/approvals/:id/approve ────────────────────────────────────

async function approve(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return validationError(res, 'Invalid request ID');

    const { reviewNote } = req.body;
    const data = await approveRequest(id, req.user.id, reviewNote ?? null);
    return ok(res, data, 'Request approved and action executed.');
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, data: null });
    next(err);
  }
}

// ── POST /governance/approvals/:id/reject ─────────────────────────────────────

async function reject(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return validationError(res, 'Invalid request ID');

    const { reviewNote } = req.body;
    const data = await rejectRequest(id, req.user.id, reviewNote ?? null);
    return ok(res, data, 'Request rejected.');
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, data: null });
    next(err);
  }
}

// ── POST /governance/approvals/:id/cancel ─────────────────────────────────────

async function cancel(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return validationError(res, 'Invalid request ID');

    const data = await cancelRequest(id, req.user.id);
    return ok(res, data, 'Request cancelled.');
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, data: null });
    next(err);
  }
}

// ── GET /governance/permissions/me ───────────────────────────────────────────

async function getMyPermissions(req, res) {
  const permissions = getPermissionsForRole(req.user.role);
  return ok(res, { role: req.user.role, permissions }, 'Permissions fetched.');
}

// ── GET /governance/permissions/:role ────────────────────────────────────────

async function getPermissionsForRoleEndpoint(req, res) {
  const { role } = req.params;
  const { VALID_ROLES } = require('../constants/roles');
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ success: false, message: `Unknown role: ${role}`, data: null });
  }
  const permissions = getPermissionsForRole(role);
  return ok(res, { role, permissions }, 'Role permissions fetched.');
}

module.exports = { list, request, approve, reject, cancel, getMyPermissions, getPermissionsForRoleEndpoint, getAllUsers, getRoleHistory, getAccessMatrix, updateAccessMatrix, getSecurityOverview, getGovernanceIntelligenceOverview };

// ── GET /governance/users ─────────────────────────────────────────────────────

async function getAllUsers(req, res, next) {
  try {
    const { status } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 100));
    const { listAllUsersForLifecycle } = require('../services/archiveService');
    const result = await listAllUsersForLifecycle({ statusFilter: status || null, page, limit });
    return ok(res, result, 'Users fetched.');
  } catch (err) { next(err); }
}

// ── GET /governance/role-history ──────────────────────────────────────────────

async function getRoleHistory(req, res, next) {
  try {
    const prisma = require('../utils/prisma');
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip  = (page - 1) * limit;

    const [total, records] = await Promise.all([
      prisma.userRoleHistory.count(),
      prisma.userRoleHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
    ]);

    // Enrich with user names
    const userIds = [...new Set([
      ...records.map(r => r.userId),
      ...records.map(r => r.changedById).filter(Boolean),
    ])];
    const users = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    return ok(res, {
      records: records.map(r => ({
        ...r,
        user:      userMap[r.userId]      ?? null,
        changedBy: r.changedById ? (userMap[r.changedById] ?? null) : null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, 'Role history fetched.');
  } catch (err) { next(err); }
}

// ── GET /governance/access-matrix ────────────────────────────────────────────

async function getAccessMatrix(req, res) {
  const { ROLES } = require('../constants/roles');
  const { getPermissionsForRole, PERMISSION_ROLES } = require('../constants/permissions');
  const configStore = require('../services/configStore');

  const allRoles = Object.values(ROLES);
  const allPermissions = Object.keys(PERMISSION_ROLES);

  // Load any saved overrides from the Config table
  const overrides = (await configStore.get('permission_overrides', {})) || {};

  const matrix = allRoles.map(role => {
    const base = getPermissionsForRole(role);
    // If this role has overrides, use them; otherwise use the hardcoded defaults
    const permissions = overrides[role] !== undefined ? overrides[role] : base;
    return { role, permissions };
  });

  return ok(res, { matrix, allPermissions }, 'Access matrix fetched.');
}

// ── GET /governance/security ──────────────────────────────────────────────────

async function getSecurityOverview(req, res, next) {
  try {
    const prisma = require('../utils/prisma');
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);

    const [
      recentFailed,
      recentSuccess,
      blockedIPs,
      inactiveUsers,
      pendingUsers,
      recentFailedLogs,
    ] = await Promise.all([
      prisma.loginLog.count({ where: { success: false, createdAt: { gte: since24h } } }),
      prisma.loginLog.count({ where: { success: true,  createdAt: { gte: since24h } } }),
      prisma.blockedIP.findMany({ orderBy: { blockedAt: 'desc' }, take: 20 }),
      prisma.user.count({ where: { status: { in: ['inactive', 'archived'] } } }),
      prisma.user.count({ where: { status: 'pending' } }),
      prisma.loginLog.findMany({
        where:   { success: false, createdAt: { gte: since7d } },
        orderBy: { createdAt: 'desc' },
        take:    50,
        select:  { id: true, email: true, ipAddress: true, createdAt: true },
      }),
    ]);

    // Group failed logins by IP to detect suspicious activity
    const ipFailCounts = {};
    for (const log of recentFailedLogs) {
      ipFailCounts[log.ipAddress] = (ipFailCounts[log.ipAddress] || 0) + 1;
    }
    const suspiciousIPs = Object.entries(ipFailCounts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, failCount: count }));

    return ok(res, {
      summary: {
        failedLogins24h:  recentFailed,
        successLogins24h: recentSuccess,
        blockedIPCount:   blockedIPs.length,
        inactiveUsers,
        pendingUsers,
        suspiciousIPCount: suspiciousIPs.length,
      },
      blockedIPs: blockedIPs.map(b => ({
        id:         b.id,
        ipAddress:  b.ipAddress,
        reason:     b.reason,
        expiresAt:  b.expiresAt,
        blockedAt:  b.blockedAt,
        isExpired:  b.expiresAt ? new Date(b.expiresAt) < new Date() : false,
      })),
      suspiciousIPs,
      recentFailedLogins: recentFailedLogs.slice(0, 20),
    }, 'Security overview fetched.');
  } catch (err) { next(err); }
}


// ── PUT /governance/access-matrix ────────────────────────────────────────────

async function updateAccessMatrix(req, res, next) {
  try {
    const { overrides } = req.body;
    // overrides: { [role]: string[] } — maps each role to its new permission list

    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return validationError(res, 'overrides must be an object mapping role -> permissions[]');
    }

    const { ROLES } = require('../constants/roles');
    const { PERMISSION_ROLES } = require('../constants/permissions');
    const configStore = require('../services/configStore');
    const { logAction } = require('../utils/auditLogger');

    const validRoles = new Set(Object.values(ROLES));
    const validPerms = new Set(Object.keys(PERMISSION_ROLES));

    // Validate all roles and permissions in the payload
    for (const [role, perms] of Object.entries(overrides)) {
      if (!validRoles.has(role)) {
        return validationError(res, `Invalid role: "${role}"`);
      }
      if (!Array.isArray(perms)) {
        return validationError(res, `Permissions for role "${role}" must be an array`);
      }
      for (const p of perms) {
        if (!validPerms.has(p)) {
          return validationError(res, `Invalid permission: "${p}"`);
        }
      }
    }

    // Merge with existing overrides (don't wipe roles not included in this request)
    const existing = (await configStore.get('permission_overrides', {})) || {};
    const merged = { ...existing, ...overrides };
    await configStore.set('permission_overrides', merged);

    void logAction(req.user?.id ?? null, 'UPDATE_ACCESS_MATRIX', 'SYSTEM', null, {
      updatedRoles:       Object.keys(overrides),
      permissionChanges:  Object.entries(overrides).map(([role, perms]) => ({
        role,
        permissionCount: perms.length,
        permissions:     perms,
      })),
      changedBy: req.user?.id ?? 'system',
      timestamp: new Date().toISOString(),
    });

    return ok(res, { overrides: merged }, 'Access matrix updated successfully.');
  } catch (err) {
    next(err);
  }
}

// ── GET /governance/intelligence-overview ─────────────────────────────────────

/**
 * Returns the unified enterprise intelligence overview for the Governance page.
 * Aggregates EnterpriseHealth, OperationalRisk, TeamStability, and executive summary.
 * Admin-only. Degrades gracefully if the unified engine fails.
 */
async function getGovernanceIntelligenceOverview(req, res, next) {
  try {
    const { aggregateUnifiedIntelligence } = require('../services/unifiedIntelligenceEngine');
    const data = await aggregateUnifiedIntelligence();
    return ok(res, data, 'Governance intelligence overview fetched.');
  } catch (err) {
    next(err);
  }
}
