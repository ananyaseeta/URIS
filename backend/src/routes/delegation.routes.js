'use strict';

/**
 * delegation.routes.js — Core Admin Delegation endpoints
 *
 * GET  /delegation          — list all delegated users (CORE_ADMIN only)
 * POST /delegation/:userId  — grant delegation to a user (CORE_ADMIN only)
 * DELETE /delegation/:userId — revoke delegation (CORE_ADMIN only)
 */

const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { ok, notFound, validationError } = require('../utils/respond');
const { logAction } = require('../utils/auditLogger');
const { ROLES } = require('../constants/roles');
const {
  listDelegates, addDelegate, removeDelegate,
} = require('../services/delegationService');

const prisma = require('../utils/prisma');

// Only CORE_ADMIN can manage delegation
router.use(verifyToken, requireRole(ROLES.CORE_ADMIN));

// GET /delegation — list delegates with user details
router.get('/', async (req, res, next) => {
  try {
    const delegateIds = await listDelegates();

    // Fetch all non-intern, non-past-employee active users for the panel
    const allAdminUsers = await prisma.user.findMany({
      where: {
        status: 'active',
        role: {
          notIn: ['TECHNICAL_INTERN', 'OPERATIONS_INTERN', 'RESEARCH_INTERN', 'ORENDA_MEMBER', 'PAST_EMPLOYEE'],
        },
        id: { not: req.user.id }, // exclude the current CORE_ADMIN
      },
      select: { id: true, name: true, email: true, role: true, status: true },
      orderBy: { name: 'asc' },
    });

    const users = allAdminUsers.map(u => ({
      ...u,
      isDelegated: delegateIds.includes(u.id),
    }));

    return ok(res, { users, delegateIds }, 'Delegation list fetched.');
  } catch (err) {
    next(err);
  }
});

// POST /delegation/:userId — grant delegation
router.post('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    if (!user) return notFound(res, 'User not found');
    if (user.status !== 'active') return validationError(res, 'Cannot delegate to inactive user');
    if (user.role === ROLES.CORE_ADMIN) return validationError(res, 'User is already CORE_ADMIN');

    const updated = await addDelegate(userId);

    void logAction(req.user.id, 'DELEGATE_CORE_ADMIN', 'USER', userId, {
      delegatedTo: userId,
      delegatedName: user.name || user.email,
      delegatedBy: req.user.id,
      action: 'granted',
      timestamp: new Date().toISOString(),
    });

    return ok(res, { delegateIds: updated }, `Core Admin delegation granted to ${user.name || user.email}.`);
  } catch (err) {
    next(err);
  }
});

// DELETE /delegation/:userId — revoke delegation
router.delete('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) return notFound(res, 'User not found');

    const updated = await removeDelegate(userId);

    void logAction(req.user.id, 'REVOKE_CORE_ADMIN_DELEGATE', 'USER', userId, {
      delegatedTo: userId,
      delegatedName: user.name || user.email,
      delegatedBy: req.user.id,
      action: 'revoked',
      timestamp: new Date().toISOString(),
    });

    return ok(res, { delegateIds: updated }, `Core Admin delegation revoked from ${user.name || user.email}.`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
