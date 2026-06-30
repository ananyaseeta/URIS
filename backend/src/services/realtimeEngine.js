'use strict';

/**
 * realtimeEngine.js — Socket.IO Real-Time Operational Intelligence Layer
 *
 * Architecture:
 *   - Wraps the existing Express http.Server with Socket.IO
 *   - Authenticates connections via JWT on handshake (no new auth system)
 *   - Rooms by role: 'admin', 'lead', 'intern:{internId}'
 *   - Emits events after scheduler jobs complete (hooked via emit* functions)
 *   - Throttles heavy payloads to prevent event spam
 *   - Does NOT recompute intelligence — only reads lightweight DB signals
 *
 * RBAC rooms:
 *   admin  → CORE_ADMIN, OPERATIONS_LEAD, OPERATIONS_PROGRAM_MANAGER
 *   lead   → TECHNICAL_LEAD, RESEARCH_LEAD, OBSERVER_TEAM_LEAD, COLLABORATOR_LEAD
 *   intern → TECHNICAL_INTERN, OPERATIONS_INTERN, RESEARCH_INTERN, ORENDA_MEMBER
 *
 * Events emitted:
 *   intelligence:alert_update          — new/resolved alert
 *   intelligence:workload_update       — TLI/capacity change
 *   intelligence:blocker_escalation    — blocker escalated
 *   intelligence:stale_task            — task marked stale
 *   intelligence:reassignment_rec      — reassignment recommendation
 *   intelligence:reservation_update    — reservation created/expired
 *   intelligence:integration_change    — integration intelligence refresh
 *   intelligence:enterprise_health     — unified health scores refresh
 *   intelligence:operational_pulse     — lightweight heartbeat with live counters
 */

const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const logger     = require('../utils/logger');
const prisma     = require('../utils/prisma');

// ── Role → room mapping ───────────────────────────────────────────────────────

const ADMIN_ROLES = new Set([
  'CORE_ADMIN',
  'OPERATIONS_LEAD',
  'OPERATIONS_PROGRAM_MANAGER',
]);

const LEAD_ROLES = new Set([
  'TECHNICAL_LEAD',
  'RESEARCH_LEAD',
  'OBSERVER_TEAM_LEAD',
  'COLLABORATOR_LEAD',
]);

function getRoomsForRole(role, internId) {
  const rooms = [];
  if (ADMIN_ROLES.has(role)) rooms.push('admin', 'lead');
  else if (LEAD_ROLES.has(role)) rooms.push('lead');
  if (internId) rooms.push(`intern:${internId}`);
  return rooms;
}

// ── Throttle map ──────────────────────────────────────────────────────────────
// Prevents spamming the same event type within a short window.

const _throttleMap = new Map();

function isThrottled(key, windowMs = 5000) {
  const last = _throttleMap.get(key);
  if (last && Date.now() - last < windowMs) return true;
  _throttleMap.set(key, Date.now());
  return false;
}

// ── Per-user connection registry (LOW-4) ──────────────────────────────────────
// Tracks all active socket IDs for each userId so we can enforce a cap on
// concurrent connections. Without this a user with 10 open tabs creates 10
// socket connections with no server-side bound.
//
// Cap is tunable via SOCKET_MAX_CONNECTIONS_PER_USER (default 5).
// When the cap is exceeded the oldest connection is forcibly disconnected so
// the new one is always accepted — this matches browser tab behaviour where
// the newest tab should always work.

const _userSockets = new Map(); // userId → Set<socketId> (insertion-ordered)

function _registerSocket(userId, socketId) {
  if (!_userSockets.has(userId)) _userSockets.set(userId, new Set());
  const set = _userSockets.get(userId);
  set.add(socketId);

  const cap = parseInt(process.env.SOCKET_MAX_CONNECTIONS_PER_USER) || 5;
  if (set.size > cap && _io) {
    // Evict the oldest socket (first inserted value in the Set)
    const oldest = set.values().next().value;
    const oldSocket = _io.sockets.sockets.get(oldest);
    if (oldSocket) {
      logger.debug({ userId, evicted: oldest }, 'Socket cap exceeded — evicting oldest connection');
      oldSocket.disconnect(true);
    }
    set.delete(oldest);
  }
}

function _unregisterSocket(userId, socketId) {
  const set = _userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) _userSockets.delete(userId);
}

// ── Singleton IO instance ─────────────────────────────────────────────────────

let _io = null;

/**
 * Initialise Socket.IO on the given http.Server.
 * Must be called once from app.js after server.listen().
 *
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins
 */
function init(httpServer, allowedOrigins) {
  if (_io) {
    logger.warn('realtimeEngine.init() called more than once — ignoring');
    return _io;
  }

  _io = new Server(httpServer, {
    cors: {
      origin:      allowedOrigins,
      credentials: true,
    },
    // Prefer WebSocket; fall back to polling for environments that block WS
    transports: ['websocket', 'polling'],
    // Ping every 25s, disconnect after 60s of silence
    pingInterval: 25000,
    pingTimeout:  60000,
  });

  // ── JWT authentication middleware ─────────────────────────────────────────
  _io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Validate user still exists
      const user = await prisma.user.findUnique({
        where:  { id: decoded.id },
        select: { id: true, role: true },
      });
      if (!user) return next(new Error('USER_NOT_FOUND'));

      // Attach to socket
      socket.data.userId   = decoded.id;
      socket.data.role     = decoded.role;
      socket.data.internId = decoded.internId ?? null;
      socket.data.userName = decoded.name    ?? null;

      next();
    } catch (err) {
      logger.warn({ err: err.message }, 'Socket auth failed');
      next(new Error('AUTH_INVALID'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  _io.on('connection', (socket) => {
    const { userId, role, internId } = socket.data;
    const rooms = getRoomsForRole(role, internId);

    // Join all applicable role rooms
    for (const room of rooms) socket.join(room);

    // LOW-4: register this socket; evicts the oldest if the per-user cap is exceeded
    _registerSocket(userId, socket.id);

    logger.debug({ userId, role, rooms }, 'Socket connected');

    // Send initial operational pulse on connect so UI is immediately populated
    _emitOperationalPulse(socket).catch(() => {});

    socket.on('disconnect', (reason) => {
      logger.debug({ userId, reason }, 'Socket disconnected');
      // LOW-4: clean up connection registry on disconnect
      _unregisterSocket(userId, socket.id);
    });

    // Client can request a fresh pulse manually (e.g. after tab focus)
    socket.on('request:pulse', () => {
      _emitOperationalPulse(socket).catch(() => {});
    });

    // ── Chat room join/leave ──────────────────────────────────────────────
    // Client emits 'chat:join' with { chatId } when opening a conversation.
    // We verify the user is actually a participant before joining the room
    // so that io.to(chatId).emit(...) delivers to the right people only.
    socket.on('chat:join', async ({ chatId } = {}) => {
      if (!chatId || typeof chatId !== 'string') return;
      try {
        const participant = await prisma.chatParticipant.findUnique({
          where: { chatId_userId: { chatId, userId } },
          select: { id: true },
        });
        if (participant) {
          socket.join(`chat:${chatId}`);
          logger.debug({ userId, chatId }, 'Socket joined chat room');
        }
      } catch (err) {
        logger.warn({ err: err.message, chatId }, 'chat:join failed');
      }
    });

    socket.on('chat:leave', ({ chatId } = {}) => {
      if (chatId) {
        socket.leave(`chat:${chatId}`);
        logger.debug({ userId, chatId }, 'Socket left chat room');
      }
    });
  });

  logger.info('Socket.IO realtime engine initialised');
  return _io;
}

// ── Operational pulse (lightweight heartbeat) ─────────────────────────────────

/**
 * Emits a lightweight live-counter payload to a single socket.
 * Reads only counts — no heavy aggregation.
 */
async function _emitOperationalPulse(socket) {
  try {
    const [unresolvedAlerts, criticalAlerts, staleTasks, blockedTasks] = await Promise.all([
      prisma.alert.count({ where: { resolved: false } }).catch(() => 0),
      prisma.alert.count({ where: { resolved: false, severity: 'critical' } }).catch(() => 0),
      prisma.task.count({
        where: {
          status:        { in: ['active', 'stale'] },
          lastUpdatedAt: { lt: new Date(Date.now() - (parseInt(process.env.SLA_STALE_DAYS) || 3) * 86400000) },
        },
      }).catch(() => 0),
      prisma.task.count({
        where: { hasBlocker: true, status: { notIn: ['completed', 'cancelled'] } },
      }).catch(() => 0),
    ]);

    socket.emit('intelligence:operational_pulse', {
      type:      'operational_pulse',
      timestamp: new Date().toISOString(),
      severity:  criticalAlerts > 0 ? 'critical' : unresolvedAlerts > 0 ? 'warning' : 'info',
      payload: {
        unresolvedAlerts,
        criticalAlerts,
        staleTasks,
        blockedTasks,
      },
      operationalImpact: 'Live operational counters',
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to emit operational pulse');
  }
}

// ── Public emit functions (called by scheduler hooks) ────────────────────────

/**
 * Broadcast an alert event to the admin room.
 * Called by alertService after creating/resolving an alert.
 *
 * @param {{ alertId, internId, type, severity, message, resolved }} alertData
 */
function emitAlertUpdate(alertData) {
  if (!_io) return;
  if (isThrottled(`alert:${alertData.alertId}`, 2000)) return;

  const payload = {
    type:      'alert_update',
    timestamp: new Date().toISOString(),
    severity:  alertData.severity || 'warning',
    affectedEntities: [{ internId: alertData.internId }],
    payload:   alertData,
    operationalImpact: alertData.resolved
      ? 'Alert resolved — operational signal cleared'
      : `New ${alertData.severity} alert: ${alertData.type}`,
    explainability: {
      source:  'AlertService',
      trigger: alertData.type,
    },
  };

  _io.to('admin').emit('intelligence:alert_update', payload);

  // Also notify the specific intern
  if (alertData.internId) {
    _io.to(`intern:${alertData.internId}`).emit('intelligence:alert_update', payload);
  }
}

/**
 * Broadcast a workload/TLI update to admin and lead rooms.
 * Called after TLI recomputation in scheduler.
 *
 * @param {{ internId, internName, tli, capacityScore, loadBand }} workloadData
 */
function emitWorkloadUpdate(workloadData) {
  if (!_io) return;
  if (isThrottled(`workload:${workloadData.internId}`, 10000)) return;

  _io.to('admin').to('lead').emit('intelligence:workload_update', {
    type:      'workload_update',
    timestamp: new Date().toISOString(),
    severity:  workloadData.loadBand === 'RED' ? 'critical' : workloadData.loadBand === 'AMBER' ? 'warning' : 'info',
    affectedEntities: [{ internId: workloadData.internId, name: workloadData.internName }],
    payload:   workloadData,
    operationalImpact: `TLI updated for ${workloadData.internName}: ${workloadData.loadBand} load band`,
    explainability: {
      source:  'TLI Engine',
      trigger: 'scheduler_sync',
    },
  });
}

/**
 * Broadcast a blocker escalation event.
 * Called by alertService when a blocker alert is created.
 *
 * @param {{ internId, internName, taskId, taskTitle, blockerType, escalationHours }} data
 */
function emitBlockerEscalation(data) {
  if (!_io) return;
  if (isThrottled(`blocker:${data.taskId}`, 30000)) return;

  _io.to('admin').to('lead').emit('intelligence:blocker_escalation', {
    type:      'blocker_escalation',
    timestamp: new Date().toISOString(),
    severity:  data.escalationHours >= 96 ? 'critical' : 'high',
    affectedEntities: [{ internId: data.internId, name: data.internName, taskId: data.taskId }],
    payload:   data,
    operationalImpact: `Blocker escalated on "${data.taskTitle}" (${data.escalationHours}h unresolved)`,
    explainability: {
      source:  'BlockerEscalation',
      trigger: 'blocker_alert_generated',
    },
  });
}

/**
 * Broadcast a stale task detection event.
 * Called after detectAndMarkStaleTasks() in scheduler.
 *
 * @param {{ count, staleTasks: Array<{id, title, internId, internName, daysSinceUpdate}> }} data
 */
function emitStaleTaskUpdate(data) {
  if (!_io) return;
  if (isThrottled('stale_tasks', 60000)) return;  // max once per minute

  _io.to('admin').to('lead').emit('intelligence:stale_task', {
    type:      'stale_task',
    timestamp: new Date().toISOString(),
    severity:  data.count > 5 ? 'critical' : data.count > 0 ? 'warning' : 'info',
    affectedEntities: (data.staleTasks || []).slice(0, 10).map(t => ({
      taskId: t.id, internId: t.internId, name: t.internName,
    })),
    payload: { count: data.count, sample: (data.staleTasks || []).slice(0, 5) },
    operationalImpact: `${data.count} task(s) marked stale`,
    explainability: {
      source:  'StaleAutomation',
      trigger: 'scheduler_stale_job',
    },
  });
}

/**
 * Broadcast a reassignment recommendation event.
 * Called after reassignment intelligence job in scheduler.
 *
 * @param {{ count, recommendations: Array }} data
 */
function emitReassignmentRecommendation(data) {
  if (!_io) return;
  if (isThrottled('reassignment', 120000)) return;  // max once per 2 minutes

  _io.to('admin').emit('intelligence:reassignment_rec', {
    type:      'reassignment_rec',
    timestamp: new Date().toISOString(),
    severity:  data.count > 0 ? 'warning' : 'info',
    affectedEntities: (data.recommendations || []).slice(0, 5).map(r => ({
      internId: r.ownerInternId, name: r.ownerName,
    })),
    payload: { count: data.count, topRecommendations: (data.recommendations || []).slice(0, 3) },
    operationalImpact: `${data.count} reassignment recommendation(s) generated`,
    explainability: {
      source:  'ReassignmentEngine',
      trigger: 'scheduler_reassignment_job',
    },
  });
}

/**
 * Broadcast a reservation update event.
 * Called when a soft reservation is created or expires.
 *
 * @param {{ internId, internName, action, reservedUntil }} data
 */
function emitReservationUpdate(data) {
  if (!_io) return;

  _io.to('admin').to('lead').emit('intelligence:reservation_update', {
    type:      'reservation_update',
    timestamp: new Date().toISOString(),
    severity:  'info',
    affectedEntities: [{ internId: data.internId, name: data.internName }],
    payload:   data,
    operationalImpact: data.action === 'created'
      ? `Soft reservation created for ${data.internName} until ${data.reservedUntil}`
      : `Reservation expired for ${data.internName}`,
    explainability: {
      source:  'ReservationWorkflow',
      trigger: data.action,
    },
  });
}

/**
 * Broadcast an integration intelligence refresh event.
 * Called after integrationIntelligenceRefresh() in scheduler.
 *
 * @param {{ createdAlertsCount, highRiskCount }} data
 */
function emitIntegrationChange(data) {
  if (!_io) return;
  if (isThrottled('integration', 300000)) return;  // max once per 5 minutes

  _io.to('admin').emit('intelligence:integration_change', {
    type:      'integration_change',
    timestamp: new Date().toISOString(),
    severity:  data.highRiskCount > 0 ? 'warning' : 'info',
    affectedEntities: [],
    payload:   data,
    operationalImpact: `Integration intelligence refreshed: ${data.createdAlertsCount} new alert(s), ${data.highRiskCount} high-risk intern(s)`,
    explainability: {
      source:  'IntegrationIntelligenceEngine',
      trigger: 'scheduler_integration_job',
    },
  });
}

/**
 * Broadcast a unified enterprise health update.
 * Called after aggregateUnifiedIntelligence() completes.
 *
 * @param {object} unifiedPayload - result of aggregateUnifiedIntelligence()
 */
function emitEnterpriseHealthUpdate(unifiedPayload) {
  if (!_io) return;
  if (isThrottled('enterprise_health', 60000)) return;  // max once per minute

  const { enterpriseHealth, operationalRisk, teamStability, liveSignals } = unifiedPayload;

  _io.to('admin').to('lead').emit('intelligence:enterprise_health', {
    type:      'enterprise_health',
    timestamp: new Date().toISOString(),
    severity:
      enterpriseHealth.score < 30 ? 'critical'
      : enterpriseHealth.score < 50 ? 'warning'
      : 'info',
    affectedEntities: [],
    payload: {
      enterpriseHealth:  { score: enterpriseHealth.score, label: enterpriseHealth.label },
      operationalRisk:   { score: operationalRisk.score,  label: operationalRisk.label  },
      teamStability:     { score: teamStability.score,    label: teamStability.label    },
      liveSignals,
    },
    operationalImpact: unifiedPayload.executiveSummary?.headline || 'Enterprise health updated',
    explainability: {
      source:  'UnifiedIntelligenceEngine',
      trigger: 'scheduled_aggregation',
    },
  });
}

/**
 * Broadcast a global operational pulse to all admin/lead connections.
 * Called periodically by the scheduler (every 15 min sync job).
 */
async function broadcastOperationalPulse() {
  if (!_io) return;
  if (isThrottled('global_pulse', 60000)) return;

  try {
    const [unresolvedAlerts, criticalAlerts, staleTasks, blockedTasks] = await Promise.all([
      prisma.alert.count({ where: { resolved: false } }).catch(() => 0),
      prisma.alert.count({ where: { resolved: false, severity: 'critical' } }).catch(() => 0),
      prisma.task.count({
        where: {
          status:        { in: ['active', 'stale'] },
          lastUpdatedAt: { lt: new Date(Date.now() - (parseInt(process.env.SLA_STALE_DAYS) || 3) * 86400000) },
        },
      }).catch(() => 0),
      prisma.task.count({
        where: { hasBlocker: true, status: { notIn: ['completed', 'cancelled'] } },
      }).catch(() => 0),
    ]);

    const pulse = {
      type:      'operational_pulse',
      timestamp: new Date().toISOString(),
      severity:  criticalAlerts > 0 ? 'critical' : unresolvedAlerts > 0 ? 'warning' : 'info',
      payload: { unresolvedAlerts, criticalAlerts, staleTasks, blockedTasks },
      operationalImpact: 'Live operational counters refreshed',
    };

    _io.to('admin').to('lead').emit('intelligence:operational_pulse', pulse);
  } catch (err) {
    logger.warn({ err: err.message }, 'broadcastOperationalPulse failed');
  }
}

/**
 * Returns the current Socket.IO instance (may be null before init).
 */
function getIO() {
  return _io;
}

/**
 * Given a chatId, returns the set of userIds from the provided participant list
 * who currently have NO socket in the chat room — i.e. they are offline for
 * this conversation and will not receive the real-time newMessage event.
 *
 * Used by sendMessage to decide who needs an email notification.
 *
 * @param {string}   chatId         — the chat room key (without 'chat:' prefix)
 * @param {string[]} participantIds — all participant userIds for this chat
 * @param {string}   excludeUserId  — the sender; always excluded
 * @returns {string[]} userIds who are offline in this chat
 */
function getOfflineParticipants(chatId, participantIds, excludeUserId) {
  if (!_io) return participantIds.filter(id => id !== excludeUserId);

  const roomKey = `chat:${chatId}`;
  const roomSockets = _io.sockets.adapter.rooms.get(roomKey);

  if (!roomSockets || roomSockets.size === 0) {
    // Nobody is in the room — everyone except the sender is offline
    return participantIds.filter(id => id !== excludeUserId);
  }

  // Build the set of userIds that have at least one socket in the room
  const onlineUserIds = new Set();
  for (const socketId of roomSockets) {
    const sock = _io.sockets.sockets.get(socketId);
    if (sock?.data?.userId) onlineUserIds.add(sock.data.userId);
  }

  return participantIds.filter(id => id !== excludeUserId && !onlineUserIds.has(id));
}

// ── Presence update (added for Virtual Presence feature) ──────────────────────
/**
 * Broadcast a presence update event.
 * Called when an intern checks in, checks out, or declares an availability window.
 *
 * @param {{ internId, userId, status, checkInAt?, checkOutAt?, durationMinutes?, availableFrom?, availableTo? }} data
 */
function emitPresenceUpdate(data) {
  if (!_io) return;

  const payload = {
    type:      'presence_update',
    timestamp: new Date().toISOString(),
    severity:  'info',
    affectedEntities: [{ internId: data.internId }],
    payload:   data,
    operationalImpact: data.status === 'ONLINE'
      ? 'Intern checked in'
      : data.status === 'OFFLINE'
        ? `Intern checked out (${data.durationMinutes ?? 0} min session)`
        : 'Intern declared availability window',
    explainability: {
      source:  'PresenceService',
      trigger: data.status,
    },
  };

  // Broadcast to admin and lead rooms
  _io.to('admin').to('lead').emit('intelligence:presence_update', payload);

  // Also notify the specific intern
  if (data.internId) {
    _io.to(`intern:${data.internId}`).emit('intelligence:presence_update', payload);
  }
}

// ── LOW-1: Role re-room ───────────────────────────────────────────────────────
/**
 * Re-assign all active sockets for a user to the rooms that match their new
 * role. Called by the admin controller immediately after persisting a role
 * change so the effect takes place on live connections without requiring a
 * reconnect.
 *
 * The function:
 *   1. Looks up every active socket for the given userId.
 *   2. Leaves ALL current role rooms (admin, lead, and any intern:* room).
 *   3. Joins the rooms appropriate for newRole.
 *   4. Updates socket.data.role so future room-based logic is consistent.
 *
 * Chat rooms (chat:*) are intentionally left untouched — those are authorised
 * per ChatParticipant and are unaffected by role changes.
 *
 * @param {string} userId    — the user whose role changed
 * @param {string} newRole   — the new role value (from ROLES constants)
 * @param {string|null} internId — intern record id if applicable, else null
 */
function reroomSocket(userId, newRole, internId = null) {
  if (!_io) return;

  const socketIds = _userSockets.get(userId);
  if (!socketIds || socketIds.size === 0) return;

  // All possible role rooms — we leave all of them before rejoining the correct set
  const ALL_ROLE_ROOMS = ['admin', 'lead'];

  const newRooms = getRoomsForRole(newRole, internId);

  for (const socketId of socketIds) {
    const sock = _io.sockets.sockets.get(socketId);
    if (!sock) continue;

    // Leave every role room the socket might currently be in
    for (const room of ALL_ROLE_ROOMS) sock.leave(room);
    // Also leave any intern:* room (pattern match against current rooms)
    for (const room of sock.rooms) {
      if (room.startsWith('intern:')) sock.leave(room);
    }

    // Join the rooms for the new role
    for (const room of newRooms) sock.join(room);

    // Update the cached role on the socket so subsequent logic is consistent
    sock.data.role = newRole;

    logger.info({ userId, socketId, newRole, newRooms }, 'Socket re-roomed after role change');
  }
}

/**
 * Returns an array of userIds (from the provided list) that currently
 * have at least one active socket connection (i.e. they are online).
 * Used by getChats to attach presence dots to the chat list.
 */
function getOnlineUserIds(userIds) {
  return userIds.filter(id => {
    const sockets = _userSockets.get(id);
    return sockets && sockets.size > 0;
  });
}

module.exports = {
  init,
  getIO,
  reroomSocket,
  getOnlineUserIds,
  getOfflineParticipants,
  emitAlertUpdate,
  emitWorkloadUpdate,
  emitBlockerEscalation,
  emitStaleTaskUpdate,
  emitReassignmentRecommendation,
  emitReservationUpdate,
  emitIntegrationChange,
  emitEnterpriseHealthUpdate,
  broadcastOperationalPulse,
  emitPresenceUpdate,
};
