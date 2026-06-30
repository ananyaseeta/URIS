/**
 * archiveService.js — Phase 6
 *
 * Enterprise-safe user lifecycle management.
 * NEVER permanently deletes users — all operations are additive/reversible.
 *
 * Lifecycle:
 *   ACTIVE → INACTIVE → ARCHIVED → REMOVED
 *   INACTIVE → ACTIVE  (restore)
 *   ARCHIVED → ACTIVE  (restore)
 *
 * All operations:
 *   - Preserve the original User row (never deleted)
 *   - Write an ArchivedUser snapshot at archive time
 *   - Log every transition to AuditLog with reason
 *   - Preserve task history, score history, reviews, audit history
 *   - Prevent self-removal (admin cannot archive/remove themselves)
 *   - Prevent removing the last CORE_ADMIN
 */

'use strict';

const prisma = require('../utils/prisma');
const { logAction } = require('../utils/auditLogger');
const { AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../constants/auditActions');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a rich snapshot of a user for archival.
 * Excludes password hash — never stored in snapshots.
 */
async function buildSnapshot(user) {
  const teams = await prisma.userTeam.findMany({
    where:   { userId: user.id, leftAt: null },
    select:  {
      teamId: true,
      role: true,
      joinedAt: true,
      team: { select: { id: true, name: true } }
    },
  });

  const intern = await prisma.intern.findUnique({
    where:  { userId: user.id },
    select: { id: true, overrideScore: true },
  });

  return {
    id:        user.id,
    email:     user.email,
    name:      user.name,
    role:      user.role,
    status:    user.status,
    createdAt: user.createdAt,
    internId:  intern?.id ?? null,
    intern:    intern ?? null,
    teams:     teams.map(t => ({
      teamId:   t.teamId,
      teamName: t.team?.name ?? null,
      role:     t.role,
      joinedAt: t.joinedAt,
    })),
    snapshotAt: new Date().toISOString(),
  };
}

function preventSelfAction(userId, adminId, action) {
  if (adminId && userId === adminId) {
    throw Object.assign(
      new Error(`You cannot ${action} your own account.`),
      { status: 400 }
    );
  }
}

async function preventLastAdminRemoval(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'CORE_ADMIN') return;

  const activeAdminCount = await prisma.user.count({
    where: { role: 'CORE_ADMIN', status: 'active', id: { not: userId } },
  });
  if (activeAdminCount === 0) {
    throw Object.assign(
      new Error('Cannot deactivate or archive the last active Core Admin.'),
      { status: 400 }
    );
  }
}

// ── Deactivate ────────────────────────────────────────────────────────────────

async function deactivateUser(userId, adminId = null, reason = null) {
  preventSelfAction(userId, adminId, 'deactivate');
  await preventLastAdminRemoval(userId);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.status === 'inactive') throw Object.assign(new Error('User is already inactive'), { status: 400 });
  if (user.status === 'removed')  throw Object.assign(new Error('Cannot deactivate a removed user'), { status: 400 });

  await prisma.user.update({ where: { id: userId }, data: { status: 'inactive' } });

  void logAction(adminId, AUDIT_ACTIONS.DEACTIVATE_USER, AUDIT_ENTITIES.USER, userId, {
    previousStatus: user.status,
    newStatus:      'inactive',
    email:          user.email,
    reason:         reason ?? null,
  });

  return { userId, status: 'inactive' };
}

// ── Archive ───────────────────────────────────────────────────────────────────

async function archiveUser(userId, adminId = null, reason = null) {
  preventSelfAction(userId, adminId, 'archive');
  await preventLastAdminRemoval(userId);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.status === 'archived') throw Object.assign(new Error('User is already archived'), { status: 400 });
  if (user.status === 'removed')  throw Object.assign(new Error('Cannot archive a removed user'), { status: 400 });

  const snapshot = await buildSnapshot(user);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: 'archived' } }),
    prisma.archivedUser.upsert({
      where:  { originalId: userId },
      update: { snapshot, status: 'ARCHIVED', archivedAt: new Date(), archivedById: adminId },
      create: { originalId: userId, snapshot, status: 'ARCHIVED', archivedById: adminId },
    }),
  ]);

  void logAction(adminId, AUDIT_ACTIONS.ARCHIVE_USER, AUDIT_ENTITIES.USER, userId, {
    email:          user.email,
    previousStatus: user.status,
    newStatus:      'archived',
    reason:         reason ?? null,
  });

  return { userId, status: 'archived' };
}

// ── Restore ───────────────────────────────────────────────────────────────────

async function restoreUser(userId, adminId = null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.status === 'active')  throw Object.assign(new Error('User is already active'), { status: 400 });
  if (user.status === 'removed') throw Object.assign(new Error('Removed users cannot be restored directly. Contact a Core Admin.'), { status: 403 });

  await prisma.user.update({ where: { id: userId }, data: { status: 'active' } });

  await prisma.archivedUser.updateMany({
    where: { originalId: userId },
    data:  { status: 'ACTIVE' },
  });

  void logAction(adminId, AUDIT_ACTIONS.RESTORE_USER, AUDIT_ENTITIES.USER, userId, {
    email:          user.email,
    previousStatus: user.status,
    newStatus:      'active',
  });

  return { userId, status: 'active' };
}

// ── Mark Removed ──────────────────────────────────────────────────────────────

async function markRemoved(userId, adminId = null, reason = null) {
  preventSelfAction(userId, adminId, 'remove');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.status === 'removed') throw Object.assign(new Error('User is already marked as removed'), { status: 400 });

  const snapshot = await buildSnapshot(user);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: 'removed' } }),
    prisma.archivedUser.upsert({
      where:  { originalId: userId },
      update: { snapshot, status: 'REMOVED', archivedById: adminId },
      create: { originalId: userId, snapshot, status: 'REMOVED', archivedById: adminId },
    }),
  ]);

  void logAction(adminId, AUDIT_ACTIONS.MARK_USER_REMOVED, AUDIT_ENTITIES.USER, userId, {
    email:  user.email,
    reason: reason ?? null,
  });

  return { userId, status: 'removed' };
}

// ── List archived users ───────────────────────────────────────────────────────

async function listArchivedUsers({ status = null, page = 1, limit = 50 } = {}) {
  const where = {};
  if (status) where.status = status;

  const skip = (page - 1) * limit;

  const [total, records] = await Promise.all([
    prisma.archivedUser.count({ where }),
    prisma.archivedUser.findMany({
      where,
      orderBy: { archivedAt: 'desc' },
      take:    limit,
      skip,
    }),
  ]);

  return { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

// ── List ALL users for lifecycle management ───────────────────────────────────

async function listAllUsersForLifecycle({ statusFilter = null, page = 1, limit = 50 } = {}) {
  const where = {};
  if (statusFilter) where.status = statusFilter;

  const skip = (page - 1) * limit;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take:    limit,
      skip,
      select: {
        id:        true,
        email:     true,
        name:      true,
        role:      true,
        status:    true,
        createdAt: true,
        intern:    { select: { id: true } },
        teams:     {
          where:  { leftAt: null },
          select: { team: { select: { name: true } } },
          take:   3,
        },
      },
    }),
  ]);

  return {
    users: users.map(u => ({
      id:        u.id,
      email:     u.email,
      name:      u.name,
      role:      u.role,
      status:    u.status,
      createdAt: u.createdAt,
      internId:  u.intern?.id ?? null,
      teams:     u.teams.map(t => t.team?.name).filter(Boolean),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

module.exports = {
  deactivateUser,
  archiveUser,
  restoreUser,
  markRemoved,
  listArchivedUsers,
  listAllUsersForLifecycle,
};
