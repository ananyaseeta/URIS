/**
 * realtimeStore.ts — Zustand store for live Socket.IO operational intelligence
 *
 * Manages:
 *   - Live operational pulse counters (alerts, stale tasks, blockers)
 *   - Enterprise health scores (EnterpriseHealth, OperationalRisk, TeamStability)
 *   - Live event feed (last N events across all event types)
 *   - Connection status indicator
 *
 * Integrates with socket.service.ts — does NOT manage the socket connection itself.
 * The socket connection is started by the auth flow (authStore / App.tsx).
 */

import { create } from 'zustand'
import {
  connectSocket,
  disconnectSocket,
  onSocketEvent,
  SOCKET_EVENTS,
  type SocketEventPayload,
  type SocketEventName,
  type OperationalPulsePayload,
  type EnterpriseHealthPayload,
} from '../services/socket.service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveCounters {
  unresolvedAlerts: number
  criticalAlerts:   number
  staleTasks:       number
  blockedTasks:     number
}

export interface EnterpriseScores {
  enterpriseHealth: { score: number; label: string }
  operationalRisk:  { score: number; label: string }
  teamStability:    { score: number; label: string }
  liveSignals: {
    unresolvedEscalations:   number
    overloadWarnings:        number
    staleTaskWarnings:       number
    reassignmentInstability: number
    integrationRiskCount:    number
    totalUnresolvedAlerts:   number
  }
}

export interface LiveFeedEvent {
  id:               string   // timestamp-based unique id
  type:             string
  timestamp:        string
  severity:         'critical' | 'high' | 'warning' | 'info'
  operationalImpact: string
  affectedEntities: Array<{ internId?: string; name?: string }>
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'auth_expired'

interface RealtimeState {
  status:           ConnectionStatus
  counters:         LiveCounters
  scores:           EnterpriseScores | null
  feed:             LiveFeedEvent[]   // last 50 events
  lastPulseAt:      string | null
  lastHealthAt:     string | null

  // Actions
  connect:    (token: string) => void
  disconnect: () => void
  _handlePulse:  (data: OperationalPulsePayload) => void
  _handleHealth: (data: EnterpriseHealthPayload) => void
  _pushFeedEvent:(data: SocketEventPayload) => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

const MAX_FEED_EVENTS = 50

// Cleanup refs for event subscriptions
let _unsubs: Array<() => void> = []

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  status:       'disconnected',
  counters: {
    unresolvedAlerts: 0,
    criticalAlerts:   0,
    staleTasks:       0,
    blockedTasks:     0,
  },
  scores:       null,
  feed:         [],
  lastPulseAt:  null,
  lastHealthAt: null,

  connect: (token: string) => {
    set({ status: 'connecting' })

    const socket = connectSocket(token)

    // Remove any previously registered lifecycle listeners before re-adding
    // so that calling connect() more than once (e.g. token refresh) doesn't
    // stack duplicate handlers on the same socket instance.
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')

    socket.on('connect',       () => set({ status: 'connected' }))
    socket.on('disconnect',    () => set({ status: 'disconnected' }))
    socket.on('connect_error', (err) => {
      // AUTH_INVALID / AUTH_REQUIRED means the JWT was rejected (expired or revoked).
      // Set a distinct status so the UI can show a session-expired banner (SEC-7).
      if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED' || err.message === 'USER_NOT_FOUND') {
        set({ status: 'auth_expired' })
      } else {
        set({ status: 'error' })
      }
    })

    // Clean up any previous subscriptions
    _unsubs.forEach(fn => fn())
    _unsubs = []

    // Subscribe to all intelligence events
    _unsubs.push(
      onSocketEvent<OperationalPulsePayload>(
        SOCKET_EVENTS.OPERATIONAL_PULSE,
        (data) => get()._handlePulse(data)
      ),
      onSocketEvent<EnterpriseHealthPayload>(
        SOCKET_EVENTS.ENTERPRISE_HEALTH,
        (data) => get()._handleHealth(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.ALERT_UPDATE,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.BLOCKER_ESCALATION,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.STALE_TASK,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.REASSIGNMENT_REC,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.WORKLOAD_UPDATE,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.INTEGRATION_CHANGE,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        SOCKET_EVENTS.RESERVATION_UPDATE,
        (data) => get()._pushFeedEvent(data)
      ),
      onSocketEvent<SocketEventPayload>(
        'intelligence:presence_update' as SocketEventName,
        (data) => get()._pushFeedEvent(data)
      ),
    )
  },

  disconnect: () => {
    _unsubs.forEach(fn => fn())
    _unsubs = []
    disconnectSocket()
    set({
      status:      'disconnected',
      counters:    { unresolvedAlerts: 0, criticalAlerts: 0, staleTasks: 0, blockedTasks: 0 },
      scores:      null,
      feed:        [],
      lastPulseAt: null,
    })
  },

  _handlePulse: (data: OperationalPulsePayload) => {
    set({
      counters:    data.payload,
      lastPulseAt: data.timestamp,
    })
    // Also push to feed if severity is warning+
    if (data.severity === 'critical' || data.severity === 'warning') {
      get()._pushFeedEvent(data as unknown as SocketEventPayload)
    }
  },

  _handleHealth: (data: EnterpriseHealthPayload) => {
    set({
      scores:       data.payload,
      lastHealthAt: data.timestamp,
    })
  },

  _pushFeedEvent: (data: SocketEventPayload) => {
    const event: LiveFeedEvent = {
      id:               `${data.type}-${data.timestamp}`,
      type:             data.type,
      timestamp:        data.timestamp,
      severity:         data.severity,
      operationalImpact: data.operationalImpact,
      affectedEntities: data.affectedEntities ?? [],
    }
    set(s => ({
      feed: [event, ...s.feed].slice(0, MAX_FEED_EVENTS),
    }))
  },
}))
