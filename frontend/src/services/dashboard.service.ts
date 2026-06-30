/**
 * Dashboard service — admin overview & intern dashboard data.
 */
import api from './api'

export interface InternRow {
  id: string
  name: string
  capacityScore: number
  tli: number
  rpi: number
  credibilityScore: number
  availability: string
  taskCount: number
  activeTasks?: number
  completedTasks?: number
  completionPct?: number
  skill_tags?: string[]
  college?: string
  email?: string
  // Virtual presence fields (from /admin/overview)
  presenceStatus?: 'ONLINE' | 'IN_SESSION' | 'AVAILABLE_SOON' | 'OFFLINE'
  lastCheckIn?: string | null
  todayWindow?: { availableFrom: string; availableTo: string } | null
}

export interface AlertItem {
  id?: string | number
  type: string
  message: string
  severity: 'critical' | 'warning' | 'info'
}

export interface TeamCapacityRow {
  id: string
  name: string
  capacityScore: number
  rpi: number
  internCount: number
  isBestPerforming: boolean
}

export interface AdminOverview {
  totalInterns: number
  activeTasks: number
  openAlerts: number
  completedLast30: number
  interns: InternRow[]
  alerts: AlertItem[]
  teams?: TeamCapacityRow[]
}

export interface InternAlert {
  id: string
  type: string
  severity: string
  message: string
  createdAt: string
  taskId?: string | null
}

export interface InternDashboard {
  capacityScore: number
  performanceIndex: number
  credibility: number
  unreadCount: number
  unreadAlerts: InternAlert[]
  isNewUser?: boolean
  assignedTasks: Array<{
    id: string
    title: string
    status: string
    complexity: number
    progressPct: number
    hasBlocker?: boolean
    deadline?: string | null
  }>
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await api.get<{ success: boolean; data: AdminOverview }>('/admin/overview')
  return res.data.data
}

export async function getInternDashboard(): Promise<InternDashboard> {
  const res = await api.get<{ success: boolean; data: InternDashboard }>('/intern/dashboard')
  return res.data.data
}
