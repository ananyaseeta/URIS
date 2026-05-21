/**
 * Centralized Axios instance.
 *
 * Token source: reads from the Zustand auth store (single source of truth).
 * The store is backed by `persist` middleware so the token is always in sync
 * with localStorage — no direct localStorage access needed here.
 *
 * All API calls in the app must go through this client.
 * Never create a second axios instance elsewhere.
 */
import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000',
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,  // 60s — Render free tier can take up to 60s to wake from sleep
})

// ── Request interceptor: attach JWT from store ────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // getState() is the non-reactive way to read Zustand outside React —
  // correct for interceptors which run outside the component tree.
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor: handle 401 via store ───────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (
      axios.isAxiosError(err) &&
      err.response?.status === 401
    ) {
      // Clear auth state through the store — this also clears the persisted
      // localStorage entry via the persist middleware.
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
