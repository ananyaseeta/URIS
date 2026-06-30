/**
 * presenceStore.ts — Zustand store for intern virtual presence.
 *
 * Manages today's check-in/out state and declared availability window.
 * Loaded lazily on the intern dashboard — no impact on other roles.
 */
import { create } from 'zustand'
import {
  checkIn,
  checkOut,
  getMyPresence,
  type PresenceStatus,
  type TodayPresence,
} from '../services/presence.service'

interface PresenceState {
  status:      PresenceStatus | null
  todayData:   TodayPresence  | null
  loading:     boolean
  checkingIn:  boolean
  checkingOut: boolean
  error:       string | null

  load:        () => Promise<void>
  doCheckIn:   () => Promise<void>
  doCheckOut:  () => Promise<void>
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  status:      null,
  todayData:   null,
  loading:     false,
  checkingIn:  false,
  checkingOut: false,
  error:       null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const data = await getMyPresence()
      set({ todayData: data, status: data.status, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  doCheckIn: async () => {
    set({ checkingIn: true, error: null })
    try {
      await checkIn()
      await get().load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-in failed'
      set({ error: msg })
    } finally {
      set({ checkingIn: false })
    }
  },

  doCheckOut: async () => {
    set({ checkingOut: true, error: null })
    try {
      await checkOut()
      await get().load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-out failed'
      set({ error: msg })
    } finally {
      set({ checkingOut: false })
    }
  },
}))
