/**
 * presence.service.ts — Virtual Presence & Availability Tracking
 */
import api from './api'

export type PresenceStatus = 'ONLINE' | 'OFFLINE' | 'AVAILABLE_SOON' | 'IN_SESSION'

export interface PresenceSession {
  id:              string
  internId:        string
  checkInAt:       string
  checkOutAt:      string | null
  durationMinutes: number | null
}

export interface AvailabilityWindowData {
  id:            string
  internId:      string
  date:          string
  availableFrom: string
  availableTo:   string
}

export interface TodayPresence {
  internId:          string
  status:            PresenceStatus
  statusDetail:      Record<string, unknown>
  sessions:          PresenceSession[]
  totalDurationToday: number
  window:            AvailabilityWindowData | null
}

export async function checkIn(): Promise<{ session: PresenceSession; alreadyCheckedIn: boolean }> {
  const res = await api.post<{ success: boolean; data: { session: PresenceSession; alreadyCheckedIn: boolean } }>('/presence/check-in')
  return res.data.data
}

export async function checkOut(): Promise<{ session: PresenceSession }> {
  const res = await api.post<{ success: boolean; data: { session: PresenceSession } }>('/presence/check-out')
  return res.data.data
}

export async function declareWindow(payload: {
  date?: string
  availableFrom: string
  availableTo:   string
}): Promise<{ window: AvailabilityWindowData }> {
  const res = await api.post<{ success: boolean; data: { window: AvailabilityWindowData } }>('/presence/window', payload)
  return res.data.data
}

export async function getMyPresence(): Promise<TodayPresence> {
  const res = await api.get<{ success: boolean; data: TodayPresence }>('/presence/me')
  return res.data.data
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 1) return '0m'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
