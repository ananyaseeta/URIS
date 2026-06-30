import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, TrendingUp, Star, AlertTriangle, Loader2, Bell, BellRing, CheckCircle2, Flag, Pause, Clock, X, CalendarDays, ChevronRight } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getInternDashboard, type InternDashboard } from '../services/dashboard.service'
import { useAuthStore, selectUser } from '../store/authStore'
import { extractErrorMessage } from '../services/error'
import ActivitySummaryCard from '../components/ActivitySummaryCard'
import AnomalyAlertPanel  from '../components/AnomalyAlertPanel'
import GoogleWorklogPanel from '../components/GoogleWorklogPanel'
import GoogleCalendarPanel from '../components/GoogleCalendarPanel'
import PresenceWidget     from '../components/PresenceWidget'
import { useTeamStore, selectActiveTeam } from '../store/teamStore'
import { getTeamContribution, type TeamContribution } from '../services/team.service'
import api from '../services/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusPct(s: string): number {
  if (s === 'backlog' || s === 'not_started') return 0
  if (s === 'in_progress_early') return 25
  if (s === 'in_progress_mid')   return 50
  if (s === 'under_review')      return 75
  if (s === 'completed')         return 100
  return 0
}

function ScoreRing({ val, label, color }: { val: number; label: string; color: string }) {
  const r    = 28
  const circ = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 64 64" className="w-20 h-20 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" />
          <motion.circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="3.5"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - val / 100) }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
            strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display font-black text-lg"
          style={{ color }}>{val}</span>
      </div>
      <span className="nav-label text-[0.55rem] text-ice/40">{label}</span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InternDashboard() {
  const user       = useAuthStore(selectUser)
  const activeTeam = useTeamStore(selectActiveTeam)
  const nav        = useNavigate()

  const [data, setData]                   = useState<InternDashboard | null>(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [teamStats, setTeamStats]         = useState<TeamContribution | null>(null)
  const [teamStatsLoading, setTeamStatsLoading] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const result = await getInternDashboard()
        setData(result)
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to load your dashboard. Please try again.'))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const dismissAlert = async (alertId: string) => {
    try {
      await api.patch(`/alerts/my/${alertId}/resolve`)
      setData(prev => prev ? {
        ...prev,
        unreadAlerts: prev.unreadAlerts?.filter((a: { id: string }) => a.id !== alertId) ?? [],
        unreadCount:  Math.max(0, (prev.unreadCount ?? 0) - 1),
      } : prev)
    } catch {
      // non-fatal
    }
  }

  const alertIcon = (type: string) => {
    if (type === 'task_assigned')        return <ClipboardList size={13} className="text-gold flex-shrink-0" />
    if (type === 'task_paused')          return <Pause size={13} className="text-amber-400 flex-shrink-0" />
    if (type === 'blocker_reported')     return <Flag size={13} className="text-red-400 flex-shrink-0" />
    if (type === 'review_submitted')     return <Star size={13} className="text-green-400 flex-shrink-0" />
    if (type === 'deadline_approaching') return <Clock size={13} className="text-red-400 flex-shrink-0" />
    if (type === 'availability_reminder') return <Bell size={13} className="text-gold flex-shrink-0" />
    return <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
  }

  // Reload team-specific contribution whenever active team changes
  useEffect(() => {
    if (!activeTeam) { setTeamStats(null); return }
    const team = activeTeam
    async function loadTeamStats(): Promise<void> {
      setTeamStatsLoading(true)
      try {
        const stats = await getTeamContribution(team.teamId)
        setTeamStats(stats)
      } catch {
        setTeamStats(null)
      } finally {
        setTeamStatsLoading(false)
      }
    }
    void loadTeamStats()
  }, [activeTeam])

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">INTERN PORTAL</p>
            <div className="flex items-center justify-between">
              <h1 className="font-display font-black text-3xl md:text-4xl text-ice-gradient">
                Welcome, {user?.name ?? 'Intern'}
              </h1>
              {/* Notification bell */}
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setShowNotifications(v => !v)}
                className="relative p-2 rounded-sm transition-all"
                style={{ background: showNotifications ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(201,168,76,0.15)' }}>
                {(data?.unreadCount ?? 0) > 0
                  ? <BellRing size={18} className="text-gold" />
                  : <Bell size={18} className="text-ice/40" />}
                {data && data.unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[0.5rem] font-bold"
                    style={{ background: '#f87171', color: '#fff' }}>
                    {data.unreadCount > 9 ? '9+' : data.unreadCount}
                  </span>
                )}
              </motion.button>
            </div>
            <div className="gold-rule w-16 mt-2" />
          </motion.div>

          {/* Notification panel */}
          <AnimatePresence>
            {showNotifications && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="glass-card rounded-sm mb-6 overflow-hidden"
                style={{ border: '1px solid rgba(201,168,76,0.2)' }}>
                <div className="flex items-center justify-between px-5 py-3"
                  style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
                  <div>
                    <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">NOTIFICATIONS</p>
                    <h2 className="font-display text-base text-frost">Your Alerts</h2>
                  </div>
                  <button onClick={() => setShowNotifications(false)} className="text-ice/30 hover:text-frost transition-colors">
                    <X size={14} />
                  </button>
                </div>
                {(!data?.unreadAlerts || data.unreadAlerts.length === 0) ? (
                  <div className="px-5 py-8 text-center">
                    <CheckCircle2 size={20} className="text-green-400/40 mx-auto mb-2" />
                    <p className="font-body text-sm text-ice/30">You're all caught up.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gold/5 max-h-80 overflow-y-auto">
                    {data.unreadAlerts.map((alert: { id: string; type: string; severity: string; message: string; createdAt: string }) => {
                      const isCritical = alert.severity === 'critical'
                      const c = isCritical ? '#f87171' : alert.type === 'task_assigned' || alert.type === 'review_submitted' ? '#4ade80' : '#f59e0b'
                      return (
                        <motion.div key={alert.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          className="flex items-start gap-3 px-5 py-3">
                          <div className="mt-0.5">{alertIcon(alert.type)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-body text-sm leading-snug" style={{ color: `${c}cc` }}>
                              {alert.message}
                            </p>
                            <p className="nav-label text-[0.5rem] text-ice/25 mt-1">
                              {new Date(alert.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <button onClick={() => dismissAlert(alert.id)}
                            className="flex-shrink-0 text-ice/20 hover:text-ice/60 transition-colors mt-0.5">
                            <X size={12} />
                          </button>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={28} className="text-gold animate-spin" />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="glass-card rounded-sm p-10 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-body text-sm text-ice/50">{error}</p>
            </div>
          )}

          {/* Content */}
          {!loading && !error && data && (
            <>
              {/* ── New user onboarding state ── */}
              {data.isNewUser && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  className="glass-card rounded-sm p-10 text-center mb-6"
                  style={{ border: '1px solid rgba(201,168,76,0.15)' }}>
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                    style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
                    <ClipboardList size={24} className="text-gold/60" />
                  </div>
                  <h2 className="font-display font-black text-2xl text-ice-gradient mb-2">Welcome aboard</h2>
                  <div className="gold-rule w-12 mx-auto mb-4" />
                  <p className="font-body text-sm text-ice/50 mb-2">
                    Your account is set up and ready. Your tasks haven't started yet.
                  </p>
                  <p className="font-body text-sm text-ice/35 mb-6">
                    Once an admin assigns tasks to you, they'll appear here along with your performance scores.
                  </p>
                  <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">
                    {[
                      { label: 'CAPACITY', val: '0' },
                      { label: 'PERFORMANCE', val: '0.00' },
                      { label: 'CREDIBILITY', val: '0' },
                    ].map(({ label, val }) => (
                      <div key={label} className="rounded-sm p-3"
                        style={{ background: 'rgba(184,212,240,0.04)', border: '1px solid rgba(184,212,240,0.08)' }}>
                        <p className="font-display font-black text-xl text-ice/30">{val}</p>
                        <p className="nav-label text-[0.44rem] text-ice/20 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ── Normal dashboard (only when not new user) ── */}
              {!data.isNewUser && (
                <>
              {/* ── Availability banner ───────────────────────────────────────
                  Shown when the intern has an availability_reminder OR
                  form_reminder alert (both are generated by backend schedulers
                  when a submission is missing for the current week) OR it is
                  Monday and the intern has no active tasks.                  */}
              {(() => {
                // Show banner for both alert types:
                // - 'availability_reminder' — set by the stale-availability scheduler
                // - 'form_reminder' — set by the form-reminder scheduler (generateFormReminders)
                // Both signal that the intern has not completed their weekly submission.
                const REMINDER_TYPES = new Set(['availability_reminder', 'form_reminder'])
                const hasReminderAlert = data.unreadAlerts?.some(
                  (a: { type: string }) => REMINDER_TYPES.has(a.type)
                )
                const isMon = new Date().getDay() === 1
                const showBanner = hasReminderAlert || (isMon && !data.isNewUser && data.assignedTasks.length === 0)
                return showBanner ? (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between gap-4 px-5 py-4 rounded-sm mb-6 flex-wrap"
                    style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.25)' }}>
                        <CalendarDays size={14} className="text-gold" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-body font-semibold text-sm text-gold/90">Submit your schedule for this week</p>
                        <p className="font-body text-xs text-ice/45 mt-0.5">
                          Your lead needs your availability to assign the next task.
                        </p>
                      </div>
                    </div>
                    <button onClick={() => nav('/availability')}
                      className="flex items-center gap-1.5 flex-shrink-0 px-4 py-2 rounded-sm transition-all"
                      style={{ background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' }}>
                      <span className="nav-label text-[0.6rem]">SUBMIT NOW</span>
                      <ChevronRight size={12} />
                    </button>
                  </motion.div>
                ) : null
              })()}

              {/* ── Assigned tasks (promoted to top) ─────────────────────── */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }} className="glass-card rounded-sm mb-6">
                <div className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
                  <div>
                    <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">ACTIVE WORKLOAD</p>
                    <h2 className="font-display text-lg text-frost">Your Tasks</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <ClipboardList size={14} className="text-gold/40" />
                    <span className="nav-label text-[0.55rem] text-ice/30">
                      {data.assignedTasks.length} TASK{data.assignedTasks.length !== 1 ? 'S' : ''}
                    </span>
                  </div>
                </div>

                {data.assignedTasks.length === 0 ? (
                  <div className="p-10 text-center">
                    <ClipboardList size={28} className="text-gold/20 mx-auto mb-3" />
                    <p className="font-body text-sm text-ice/50 mb-1">No tasks assigned yet.</p>
                    <p className="font-body text-xs text-ice/30 max-w-xs mx-auto">
                      Your lead assigns tasks once your availability is submitted. Make sure you've
                      filled in <strong style={{ color: 'rgba(201,168,76,0.6)' }}>My Schedule</strong> for this week.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gold/5">
                    {data.assignedTasks.map((task, i) => {
                      const pct = task.progressPct ?? statusPct(task.status)
                      return (
                        <motion.div key={task.id}
                          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 + i * 0.07 }}
                          className="flex items-center gap-4 px-6 py-4">

                          {/* Radial progress */}
                          <div className="relative flex-shrink-0 w-10 h-10">
                            <svg viewBox="0 0 40 40" className="w-10 h-10 -rotate-90">
                              <circle cx="20" cy="20" r="16" fill="none"
                                stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
                              <motion.circle cx="20" cy="20" r="16" fill="none"
                                stroke={pct === 100 ? '#4ade80' : '#c9a84c'} strokeWidth="2.5"
                                strokeDasharray={`${2 * Math.PI * 16}`}
                                initial={{ strokeDashoffset: 2 * Math.PI * 16 }}
                                animate={{ strokeDashoffset: 2 * Math.PI * 16 * (1 - pct / 100) }}
                                transition={{ duration: 1, delay: 0.4 + i * 0.07 }}
                                strokeLinecap="round" />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center
                              font-ui font-bold text-[0.5rem] text-ice/60">{pct}%</span>
                          </div>

                          {/* Task info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-body text-sm text-frost/85 truncate">{task.title}</p>
                            <p className="nav-label text-[0.5rem] text-ice/30 mt-0.5">
                              {task.status.replace(/_/g, ' ')}
                            </p>
                          </div>

                          {/* Complexity dots */}
                          <div className="flex gap-0.5 flex-shrink-0">
                            {[0.2, 0.4, 0.6, 0.8, 1.0].map(n => (
                              <div key={n} className="w-2 h-2 rounded-sm"
                                style={{
                                  background: n <= task.complexity
                                    ? 'rgba(201,168,76,0.7)'
                                    : 'rgba(255,255,255,0.06)',
                                }} />
                            ))}
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </motion.div>

              {/* ── Performance scores (moved below tasks) ───────────────────
                  Labels use plain English — not internal metric names.
                  Tooltips explain what each score means.                     */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-card rounded-sm p-8 mb-6">
                <p className="nav-label text-[0.55rem] text-gold/40 mb-6">HOW YOUR LEAD SEES YOU</p>
                <div className="flex items-center justify-around flex-wrap gap-8">
                  <ScoreRing
                    val={Math.round(data.capacityScore)}
                    label="Workload Capacity"
                    color={data.capacityScore > 70 ? '#4ade80' : data.capacityScore > 40 ? '#f59e0b' : '#f87171'}
                  />
                  <ScoreRing
                    val={Math.round((data.performanceIndex / 5) * 100)}
                    label="Performance Score"
                    color="#c9a84c"
                  />
                  <ScoreRing
                    val={Math.round(data.credibility)}
                    label="Reliability Score"
                    color={data.credibility > 70 ? '#4ade80' : data.credibility > 40 ? '#f59e0b' : '#f87171'}
                  />
                </div>

                {/* Raw performance score */}
                <div className="mt-6 pt-5 flex items-center justify-center gap-2"
                  style={{ borderTop: '1px solid rgba(201,168,76,0.1)' }}>
                  <Star size={13} className="text-gold/60" />
                  <span className="nav-label text-[0.6rem] text-ice/40">OVERALL SCORE</span>
                  <span className="font-display font-black text-xl text-gold ml-2">
                    {data.performanceIndex.toFixed(2)}
                    <span className="font-body font-normal text-sm text-ice/30">/5</span>
                  </span>
                </div>
              </motion.div>

              {/* Team contribution — only shown when a team is selected */}
              {activeTeam && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }} className="glass-card rounded-sm p-6 mb-6"
                  style={{ border: '1px solid rgba(201,168,76,0.15)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">TEAM CONTRIBUTION</p>
                      <h2 className="font-display text-lg text-frost">{activeTeam.teamName}</h2>
                    </div>
                    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-sm"
                      style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c' }}>
                      {activeTeam.role.toUpperCase()}
                    </span>
                  </div>

                  {teamStatsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={16} className="text-gold animate-spin" />
                    </div>
                  ) : teamStats ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="font-display font-black text-2xl text-signal">{teamStats.tasksCompleted}</p>
                        <p className="nav-label text-[0.5rem] text-ice/40 mt-0.5">COMPLETED</p>
                      </div>
                      <div className="text-center">
                        <p className="font-display font-black text-2xl text-gold">{teamStats.tasksActive}</p>
                        <p className="nav-label text-[0.5rem] text-ice/40 mt-0.5">ACTIVE</p>
                      </div>
                      <div className="text-center">
                        <p className="font-display font-black text-2xl text-ice/60">
                          {teamStats.latestScore !== null ? teamStats.latestScore.toFixed(1) : '—'}
                        </p>
                        <p className="nav-label text-[0.5rem] text-ice/40 mt-0.5">LATEST SCORE</p>
                      </div>
                    </div>
                  ) : (
                    <p className="font-body text-sm text-ice/30 text-center py-2">
                      No contribution data for this team yet.
                    </p>
                  )}

                  <p className="nav-label text-[0.45rem] text-ice/20 text-center mt-4">
                    GLOBAL PERFORMANCE SHOWN ABOVE · TEAM CONTRIBUTION SHOWN HERE
                  </p>
                </motion.div>
              )}

              {/* Anomaly alerts — only renders when alerts exist */}
              <AnomalyAlertPanel />

              {/* Virtual Presence — check-in/out and availability window */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }} className="mb-6">
                <PresenceWidget />
              </motion.div>

              {/* Activity summary — 7-day window */}
              <ActivitySummaryCard />

              {/* Google Work Log Status */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }} className="mt-6">
                <GoogleWorklogPanel />
              </motion.div>

              {/* Google Calendar Availability */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }} className="mt-4">
                <GoogleCalendarPanel />
              </motion.div>

              {/* STEMONEF BRANDING */}
              <div className="mt-12 py-8 flex flex-col items-center gap-4 opacity-40">
                <div className="h-[1px] w-12 bg-gold/20" />
                <span className="font-display font-black text-xs tracking-[0.4em] text-ice-gradient">STEMONEF</span>
                <p className="nav-label text-[0.45rem] tracking-[0.6em] text-ice/30 uppercase">Intelligence Design System</p>
              </div>
            </>
          )}
          </>
        )}

        </div>
      </main>
    </div>
  )
}
