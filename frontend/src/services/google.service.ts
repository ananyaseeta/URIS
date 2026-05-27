import api from './api'

export interface WorklogStatus {
  gdocUrl: string | null
  connected: boolean
  lastModified: string | null
  isStale: boolean
  metaRefreshedAt: string | null
  recentActivity: Array<{
    timestamp: string | null
    actions: string[]
  }>
}

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  allDay: boolean
}

export interface BusySlot {
  start: string
  end: string
}

export interface CalendarData {
  connected: boolean
  busySlots: BusySlot[]
  events: CalendarEvent[]
}

export interface GoogleStatus {
  connected: boolean
}

export async function getGoogleStatus(): Promise<GoogleStatus> {
  const res = await api.get('/auth/google/status')
  return res.data.data
}

export async function connectGoogle(): Promise<void> {
  // Redirect to backend OAuth initiation — pass JWT as query param since
  // browser redirects cannot send Authorization headers
  let jwt = ''
  try {
    // Zustand persist stores as { state: { token, user, isAuthenticated } }
    const raw = localStorage.getItem('uris_auth')
    if (raw) {
      const parsed = JSON.parse(raw)
      jwt = parsed?.state?.token ?? parsed?.token ?? ''
    }
  } catch { /* ignore parse errors */ }

  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000'
  // Strip /api suffix if present — the OAuth route is at the root
  const backendBase = base.replace(/\/api\/?$/, '')
  window.location.href = jwt
    ? `${backendBase}/auth/google?token=${encodeURIComponent(jwt)}`
    : `${backendBase}/auth/google`
}

export async function disconnectGoogle(): Promise<void> {
  await api.delete('/auth/google')
}

export async function getWorklogStatus(): Promise<WorklogStatus> {
  const res = await api.get('/google/worklog')
  return res.data.data
}

export async function getCalendarData(days = 7): Promise<CalendarData> {
  const res = await api.get(`/google/calendar?days=${days}`)
  return res.data.data
}

export interface GoogleIntelligence {
  staleWorklogs: Array<{
    internId: string
    name: string
    gdocUrl: string | null
    lastModified: string | null
    daysSinceUpdate: number | null
    metaRefreshedAt: string | null
    isConnected: boolean
  }>
  noWorklog: Array<{
    internId: string
    name: string
    isConnected: boolean
  }>
  notConnected: Array<{
    internId: string
    name: string
    hasGdoc: boolean
  }>
  activeWorklogs: Array<{
    internId: string
    name: string
    lastModified: string | null
  }>
  summary: {
    totalInterns: number
    connectedToGoogle: number
    staleWorklogCount: number
    noWorklogCount: number
    notConnectedCount: number
    activeWorklogCount: number
    staleDaysThreshold: number
  }
}

export async function getGoogleIntelligence(): Promise<GoogleIntelligence> {
  const res = await api.get('/google/intelligence')
  return res.data.data
}
