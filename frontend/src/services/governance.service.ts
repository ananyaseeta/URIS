/**
 * governance.service.ts — Phase 8 Enterprise Governance Layer
 */
import api from './api'
import type { Permission } from '../constants/roles'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type ApprovalAction = 'CHANGE_USER_ROLE' | 'ARCHIVE_USER' | 'FINISH_INTERNSHIP' | 'REMOVE_USER'

export interface ApprovalRequest {
  id:            string
  action:        ApprovalAction
  targetId:      string
  targetType:    string
  requestedById: string
  payload:       Record<string, unknown>
  status:        ApprovalStatus
  reviewedById:  string | null
  reviewNote:    string | null
  expiresAt:     string | null
  createdAt:     string
  updatedAt:     string
  requester:     { id: string; name: string; email: string } | null
  reviewer:      { id: string; name: string; email: string } | null
  isExpired:     boolean
}

export interface ApprovalListResponse {
  requests:   ApprovalRequest[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface PermissionsResponse {
  role:        string
  permissions: Permission[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrap<T>(p: Promise<{ data: { success: boolean; data: T } }>): Promise<T> {
  return p.then(r => r.data.data)
}

// ── Approval requests ─────────────────────────────────────────────────────────

export function listApprovals(params?: {
  status?: ApprovalStatus
  action?: ApprovalAction
  page?:   number
  limit?:  number
}): Promise<ApprovalListResponse> {
  return wrap(api.get('/governance/approvals', { params }))
}

export function submitApprovalRequest(payload: {
  action:     ApprovalAction
  targetId:   string
  targetType: 'USER' | 'INTERN' | 'TASK'
  payload:    Record<string, unknown>
}): Promise<ApprovalRequest> {
  return wrap(api.post('/governance/approvals', payload))
}

export function approveRequest(id: string, reviewNote?: string): Promise<{ request: ApprovalRequest; result: unknown }> {
  return wrap(api.post(`/governance/approvals/${id}/approve`, { reviewNote }))
}

export function rejectRequest(id: string, reviewNote?: string): Promise<ApprovalRequest> {
  return wrap(api.post(`/governance/approvals/${id}/reject`, { reviewNote }))
}

export function cancelApprovalRequest(id: string): Promise<ApprovalRequest> {
  return wrap(api.post(`/governance/approvals/${id}/cancel`))
}

// ── Permissions ───────────────────────────────────────────────────────────────

export function getMyPermissions(): Promise<PermissionsResponse> {
  return wrap(api.get('/governance/permissions/me'))
}

export function getPermissionsForRole(role: string): Promise<PermissionsResponse> {
  return wrap(api.get(`/governance/permissions/${role}`))
}

// ── User management ───────────────────────────────────────────────────────────

export interface GovernanceUser {
  id:        string
  email:     string
  name:      string
  role:      string
  status:    string
  createdAt: string
  internId:  string | null
  teams:     string[]
}

export interface UserListResponse {
  users:      GovernanceUser[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export function getAllUsers(params?: { status?: string; page?: number; limit?: number }): Promise<UserListResponse> {
  return wrap(api.get('/governance/users', { params }))
}

// ── Role history ──────────────────────────────────────────────────────────────

export interface RoleHistoryRecord {
  id:           string
  userId:       string
  previousRole: string
  newRole:      string
  changedById:  string | null
  reason:       string | null
  createdAt:    string
  user:         { id: string; name: string; email: string } | null
  changedBy:    { id: string; name: string; email: string } | null
}

export interface RoleHistoryResponse {
  records:    RoleHistoryRecord[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export function getRoleHistory(params?: { page?: number; limit?: number }): Promise<RoleHistoryResponse> {
  return wrap(api.get('/governance/role-history', { params }))
}

// ── Access matrix ─────────────────────────────────────────────────────────────

export interface RolePermissions {
  role:        string
  permissions: string[]
}

export interface AccessMatrixResponse {
  matrix:         RolePermissions[]
  allPermissions: string[]
}

export function getAccessMatrix(): Promise<AccessMatrixResponse> {
  return wrap(api.get('/governance/access-matrix'))
}

export function updateAccessMatrix(overrides: Record<string, string[]>): Promise<{ overrides: Record<string, string[]> }> {
  return wrap(api.put('/governance/access-matrix', { overrides }))
}

// ── Security overview ─────────────────────────────────────────────────────────

export interface BlockedIPRecord {
  id:        string
  ipAddress: string
  reason:    string | null
  expiresAt: string | null
  blockedAt: string
  isExpired: boolean
}

export interface SecurityOverview {
  summary: {
    failedLogins24h:   number
    successLogins24h:  number
    blockedIPCount:    number
    inactiveUsers:     number
    pendingUsers:      number
    suspiciousIPCount: number
  }
  blockedIPs:          BlockedIPRecord[]
  suspiciousIPs:       { ip: string; failCount: number }[]
  recentFailedLogins:  { id: string; email: string; ipAddress: string; createdAt: string }[]
}

export function getSecurityOverview(): Promise<SecurityOverview> {
  return wrap(api.get('/governance/security'))
}

// ── Promotion helper ──────────────────────────────────────────────────────────

export function submitPromotionRequest(params: {
  targetUserId: string
  newRole:      string
  reason?:      string
}): Promise<ApprovalRequest> {
  return submitApprovalRequest({
    action:     'CHANGE_USER_ROLE',
    targetId:   params.targetUserId,
    targetType: 'USER',
    payload:    { newRole: params.newRole, reason: params.reason ?? '' },
  })
}

// ── Unified Intelligence Overview ─────────────────────────────────────────────

export interface GovernanceIntelligenceOverview {
  computedAt:      string
  enterpriseHealth: {
    score:  number
    label:  string
    components: Record<string, number>
    explainability: {
      contributingSystems: string[]
      weightingBreakdown:  Record<string, number>
      workloadReasoning:   string
      credibilityReasoning: string
      integrationReasoning: string
      detectedRisks:       string[]
    }
  }
  operationalRisk: {
    score:  number
    label:  string
    components: Record<string, number>
    explainability: {
      contributingSystems: string[]
      weightingBreakdown:  Record<string, number>
      workloadReasoning:   string
      credibilityReasoning: string
      integrationReasoning: string
      detectedRisks:       string[]
    }
  }
  teamStability: {
    score:  number
    label:  string
    components: Record<string, number>
    explainability: {
      contributingSystems: string[]
      weightingBreakdown:  Record<string, number>
      workloadReasoning:   string
      credibilityReasoning: string
      integrationReasoning: string
      detectedRisks:       string[]
    }
  }
  executiveSummary: {
    headline:             string
    urgentActions:        string[]
    crossSystemWarnings:  string[]
    operationalSnapshot: {
      totalInterns:     number
      activeTasks:      number
      unresolvedAlerts: number
      criticalAlerts:   number
      staleTasks:       number
      blockedTasks:     number
    }
  }
  liveSignals: {
    unresolvedEscalations:   number
    overloadWarnings:        number
    staleTaskWarnings:       number
    reassignmentInstability: number
    integrationRiskCount:    number
    totalUnresolvedAlerts:   number
  }
}

export function getGovernanceIntelligenceOverview(): Promise<GovernanceIntelligenceOverview> {
  return wrap(api.get('/governance/intelligence-overview'))
}

// ── IP Block Management ───────────────────────────────────────────────────────

export async function blockIP(ipAddress: string, reason?: string): Promise<void> {
  await api.post('/admin/block-ip', { ipAddress, reason: reason ?? 'Blocked via Governance panel' })
}

export async function unblockIP(ipAddress: string): Promise<void> {
  await api.delete('/admin/block-ip', { data: { ipAddress } })
}
