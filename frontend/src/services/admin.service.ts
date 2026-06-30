/**
 * Admin service — score overrides, task assignment, task status updates.
 */
import api from './api'

export interface OverrideScorePayload {
  internId: string
  score: number
  reason?: string
}

export interface AssignTaskPayload {
  internId: string
  taskId: string
}

export async function overrideScore(payload: OverrideScorePayload): Promise<void> {
  // Backend field is `overrideScore`, not `score`
  await api.post('/admin/override-score', {
    internId: payload.internId,
    overrideScore: payload.score,
    reason: payload.reason,
  })
}

export async function assignTask(payload: AssignTaskPayload): Promise<void> {
  await api.post('/assign/assign-task', payload)
}

export interface AvailabilityDeadline {
  day:    number  // 0=Sun, 1=Mon, ..., 6=Sat
  hour:   number  // 0–23
  minute: number  // 0–59
}

export async function getAvailabilityDeadline(): Promise<AvailabilityDeadline> {
  const res = await api.get<{ success: boolean; data: AvailabilityDeadline }>('/admin/availability-deadline')
  return res.data.data
}

export async function setAvailabilityDeadline(payload: AvailabilityDeadline): Promise<void> {
  await api.post('/admin/availability-deadline', payload)
}

export interface PendingUser {
  id:        string
  name:      string
  email:     string
  role:      string
  createdAt: string
}

export async function getPendingUsers(): Promise<PendingUser[]> {
  const res = await api.get<{ success: boolean; data: PendingUser[] }>('/admin/pending-users')
  return res.data.data
}

export async function approveUser(userId: string): Promise<void> {
  await api.post('/admin/approve-user', { userId })
}

export async function rejectUser(userId: string): Promise<void> {
  await api.post('/admin/reject-user', { userId })
}

export async function finishInternship(internId: string): Promise<void> {
  await api.post('/admin/finish-internship', { internId })
}

// ── Integration Status ────────────────────────────────────────────────────────

export interface IntegrationInfo {
  id: string
  name: string
  status: 'connected' | 'partial' | 'not_configured' | 'failed'
  /** Whether all required env vars are present (backend field: `configured`) */
  configured: boolean
  /** Alias for configured — kept for backward compatibility */
  envOk?: boolean
  operational: boolean
  /** Plain-English status summary (backend field: `health`) */
  health: string
  /** Alias for health — kept for backward compatibility */
  notes?: string
  /** What this integration powers in the product (backend field: `powers`) */
  powers: string[]
  /** Alias for powers — kept for backward compatibility */
  features?: string[]
  frontendVisible: boolean
  optional?: boolean
}

export interface IntegrationAudit {
  status: 'all_operational' | 'degraded' | 'partial'
  summary?: string
  timestamp: string
  /** Uptime as a formatted string (e.g. "2h 15m 30s") from the backend */
  uptime: string | number
  integrations: IntegrationInfo[]
}

export async function getIntegrationStatus(): Promise<IntegrationAudit> {
  // Use fetch directly — no auth needed, public health endpoint
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:5000'
  const res = await fetch(`${base}/health/integrations`)
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}

// ── Intern Management ─────────────────────────────────────────────────────────

export interface UpdateInternPayload {
  name?: string
  gdocUrl?: string
  joiningDate?: string
  dateOfBirth?: string
}

export async function deleteIntern(internId: string): Promise<void> {
  await api.delete(`/admin/interns/${internId}`)
}

export async function updateIntern(internId: string, payload: UpdateInternPayload): Promise<void> {
  await api.patch(`/admin/interns/${internId}`, payload)
}
