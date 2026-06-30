/**
 * socket.service.ts — Socket.IO client singleton
 *
 * Manages a single Socket.IO connection for the lifetime of the session.
 * Authenticates via the JWT stored in localStorage (same token used by REST API).
 *
 * Usage:
 *   import { connectSocket, disconnectSocket, getSocket } from './socket.service'
 *
 *   connectSocket(token)   — call once after login
 *   disconnectSocket()     — call on logout
 *   getSocket()            — returns the active socket (or null)
 */

import { io, Socket } from 'socket.io-client'

// ── Event type constants ──────────────────────────────────────────────────────

export const SOCKET_EVENTS = {
  ALERT_UPDATE:          'intelligence:alert_update',
  WORKLOAD_UPDATE:       'intelligence:workload_update',
  BLOCKER_ESCALATION:    'intelligence:blocker_escalation',
  STALE_TASK:            'intelligence:stale_task',
  REASSIGNMENT_REC:      'intelligence:reassignment_rec',
  RESERVATION_UPDATE:    'intelligence:reservation_update',
  INTEGRATION_CHANGE:    'intelligence:integration_change',
  ENTERPRISE_HEALTH:     'intelligence:enterprise_health',
  OPERATIONAL_PULSE:     'intelligence:operational_pulse',
} as const

export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS]

// ── Payload types ─────────────────────────────────────────────────────────────

export interface SocketEventPayload {
  type:             string
  timestamp:        string
  severity:         'critical' | 'high' | 'warning' | 'info'
  affectedEntities: Array<{ internId?: string; name?: string; taskId?: string }>
  payload:          Record<string, unknown>
  operationalImpact: string
  explainability?:  Record<string, unknown>
}

export interface OperationalPulsePayload extends SocketEventPayload {
  payload: {
    unresolvedAlerts: number
    criticalAlerts:   number
    staleTasks:       number
    blockedTasks:     number
  }
}

export interface EnterpriseHealthPayload extends SocketEventPayload {
  payload: {
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
}

// ── Singleton state ───────────────────────────────────────────────────────────

let _socket: Socket | null = null

const BACKEND_URL = (import.meta.env.VITE_API_URL as string | undefined)
  ?.replace('/api', '')          // strip /api path prefix if present
  ?? 'http://localhost:5000'

/**
 * Connect to the Socket.IO server with the given JWT.
 * If already connected, returns the existing socket.
 */
export function connectSocket(token: string): Socket {
  if (_socket?.connected) return _socket

  // Disconnect stale socket if it exists but is not connected
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }

  _socket = io(BACKEND_URL, {
    auth:       { token },
    transports: ['websocket', 'polling'],
    reconnection:        true,
    reconnectionAttempts: 10,
    reconnectionDelay:   2000,
    reconnectionDelayMax: 30000,
  })

  _socket.on('connect', () => {
    console.debug('[URIS Socket] Connected:', _socket?.id)
  })

  _socket.on('connect_error', (err) => {
    // If the server rejects the token (expired or invalid), the error message
    // will be AUTH_INVALID or AUTH_REQUIRED. In that case we trigger a logout
    // so the user sees the login page instead of a silently dead connection.
    if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED' || err.message === 'USER_NOT_FOUND') {
      console.warn('[URIS Socket] Token rejected — triggering logout:', err.message)
      // Dynamic import avoids circular dependency with authStore
      import('../store/authStore')
        .then(({ useAuthStore }) => {
          useAuthStore.getState().logout()
        })
        .catch(() => {})
      return
    }
    // Non-fatal for other errors: REST API continues to work; realtime is enhancement only
    console.warn('[URIS Socket] Connection error:', err.message)
  })

  _socket.on('disconnect', (reason) => {
    console.debug('[URIS Socket] Disconnected:', reason)
    // If the server forcefully disconnected due to auth failure, trigger logout
    if (reason === 'io server disconnect') {
      console.warn('[URIS Socket] Server-initiated disconnect — possible auth failure')
    }
  })

  return _socket
}

/**
 * Disconnect and clean up the socket.
 * Call on logout.
 */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }
}

/**
 * Returns the active socket instance, or null if not connected.
 */
export function getSocket(): Socket | null {
  return _socket
}

/**
 * Subscribe to a socket event. Returns an unsubscribe function.
 *
 * @example
 *   const unsub = onSocketEvent(SOCKET_EVENTS.ALERT_UPDATE, (data) => { ... })
 *   // later:
 *   unsub()
 */
export function onSocketEvent<T = SocketEventPayload>(
  event: SocketEventName,
  handler: (data: T) => void
): () => void {
  if (!_socket) return () => {}
  _socket.on(event, handler as (...args: unknown[]) => void)
  return () => {
    _socket?.off(event, handler as (...args: unknown[]) => void)
  }
}
