import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart3, Users, AlertTriangle, CheckCircle2, TrendingUp, Clock, ChevronRight, Star, MessageSquare, ClipboardList, UserCheck, X, Check, Loader2 } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getAdminOverview, type AdminOverview, type InternRow } from '../services/dashboard.service'
import { getAllTasks, type Task } from '../services/tasks.service'
import { getPendingUsers, approveUser, rejectUser, type PendingUser } from '../services/admin.service'
import { extractErrorMessage } from '../services/error'
import { useAuthStore } from '../store/authStore'
import InternDashboard from './InternDashboard'

function BandDot({ score }: { score: number }) {
  const isNegative = score < 0
  const c = score > 70 ? '#4ade80' : score > 40 ? '#f59e0b' : '#f87171'
  return (
    <span className={`status-dot ${isNegative ? 'animate-pulse' : ''}`}
      style={{
        background: isNegative ? '#ff4d4d' : c,
        boxShadow: `0 0 ${isNegative ? '8px' : '5px'} ${isNegative ? '#ff4d4d88' : c + '55'}`,
        border: isNegative ? '1px solid rgba(255,255,255,0.2)' : 'none'
      }}
    />
  )
}

function ScoreBar({ val }: { val: number }) {
  const c = val > 70 ? '#4ade80' : val > 40 ? '#f59e0b' : '#f87171'
  return (
    <div className="progress-bar w-full mt-1">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${val}%` }}
        transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        style={{ height: '100%', background: `linear-gradient(90deg, ${c}88, ${c})`, borderRadius: 2 }}
      />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-5 rounded-sm h-24"
            style={{ background: 'rgba(255,255,255,0.03)' }} />
        ))}
      </div>
      <div className="glass-card rounded-sm h-64" style={{ background: 'rgba(255,255,255,0.03)' }} />
    </div>
  )
}

export default function Dashboard() {
  const isAdmin = useAuthStore(s => s.isAdmin())

  // Route to the correct dashboard based on role.
  // Interns get InternDashboard; all admin/lead roles get AdminCommandDashboard.
  if (!isAdmin) return <InternDashboard />

  return <AdminCommandDashboard />
}

function AdminCommandDashboard() {
  const nav     = useNavigate()
  const isAdmin = useAuthStore(s => s.isAdmin())

  const [data, setData]             = useState<AdminOverview | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  // Pending reviews — completed tasks not yet reviewed (leads + admins)
  const [pendingReviewCount, setPendingReviewCount] = useState(0)

  // Overdue tasks count (deadline in the past, not completed)
  const [overdueCount, setOverdueCount] = useState(0)

  // Pending user approvals — admin only
  const [pendingUsers, setPendingUsers]   = useState<PendingUser[]>([])
  const [approvingId, setApprovingId]     = useState<string | null>(null)
  const [rejectingId, setRejectingId]     = useState<string | null>(null)
  const [approvalMsg, setApprovalMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // Per-intern row — expanded action panel (internId or null = collapsed)
  const [expandedInternId, setExpandedInternId] = useState<string | null>(null)

  // Assign shortcut state — pre-fills the internId in AdminOverview assign tab
  // We navigate to /admin with a pre-selected intern via query param
  const handleAssignShortcut = (internId: string) => {
    nav(`/admin?tab=assign&internId=${internId}`)
  }

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const overview = await getAdminOverview()
        setData(overview)
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to load dashboard data. Check your connection and try again.'))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // Fetch task-derived counts (pending reviews, overdue)
  useEffect(() => {
    async function loadTaskCounts(): Promise<void> {
      try {
        const tasks = await getAllTasks()
        const now = Date.now()
        // Overdue: not completed, has a deadline, deadline is in the past
        setOverdueCount(
          tasks.filter(t =>
            t.status !== 'completed' &&
            t.deadline &&
            new Date(t.deadline).getTime() < now
          ).length
        )
        // Pending reviews: completed tasks (proxy — backend deduplicate reviewed ones
        // in Review.tsx; here we just count completed as needing potential review)
        setPendingReviewCount(tasks.filter(t => t.status === 'completed').length)
      } catch { /* non-fatal — cards just show 0 */ }
    }
    void loadTaskCounts()
  }, [])

  // Fetch pending approvals for admin
  useEffect(() => {
    if (!isAdmin) return
    getPendingUsers()
      .then(setPendingUsers)
      .catch(() => {})
  }, [isAdmin])

  const handleApprove = async (userId: string, email: string) => {
    setApprovingId(userId)
    setApprovalMsg(null)
    try {
      await approveUser(userId)
      setPendingUsers(prev => prev.filter(u => u.id !== userId))
      setApprovalMsg({ ok: true, text: `${email} approved.` })
    } catch {
      setApprovalMsg({ ok: false, text: 'Approval failed.' })
    } finally {
      setApprovingId(null)
    }
  }

  const handleReject = async (userId: string, email: string) => {
    if (!window.confirm(`Reject and remove ${email}?`)) return
    setRejectingId(userId)
    setApprovalMsg(null)
    try {
      await rejectUser(userId)
      setPendingUsers(prev => prev.filter(u => u.id !== userId))
      setApprovalMsg({ ok: true, text: `${email} rejected.` })
    } catch {
      setApprovalMsg({ ok: false, text: 'Rejection failed.' })
    } finally {
      setRejectingId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 text-frost">
        <Starfield />
        <Sidebar />
        <main className="md:ml-52 pt-14 min-h-screen relative z-10">
          <div className="px-4 md:px-8 py-8"><LoadingSkeleton /></div>
        </main>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-navy-950 text-frost">
        <Starfield />
        <Sidebar />
        <main className="md:ml-52 pt-14 min-h-screen relative z-10 flex items-center justify-center">
          <div className="glass-card rounded-sm p-6 md:p-10 text-center max-w-md mx-4">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-4" />
            <p className="font-display text-xl text-frost mb-2">Dashboard Unavailable</p>
            <p className="font-body text-sm text-ice/40">{error || 'No data returned from server.'}</p>
          </div>
        </main>
      </div>
    )
  }

  const stats = [
    { label: 'Active Interns',   val: data.totalInterns,    sub: 'Currently onboarded', icon: Users,         color: '#c9a84c',  to: '/team'   },
    { label: 'Tasks In Progress',val: data.activeTasks,     sub: 'Across all interns',  icon: BarChart3,     color: '#b8d4f0',  to: '/tasks'  },
    { label: 'Open Alerts',      val: data.openAlerts,      sub: 'Require attention',   icon: AlertTriangle, color: '#f87171',  to: '/alerts' },
    { label: 'Completed (30d)',  val: data.completedLast30, sub: 'Tasks delivered',     icon: CheckCircle2,  color: '#4ade80',  to: '/tasks'  },
    { label: 'Awaiting Review',  val: pendingReviewCount,   sub: 'Completed tasks',     icon: Star,          color: '#f59e0b',  to: '/review' },
    { label: 'Overdue Tasks',    val: overdueCount,         sub: 'Past deadline',       icon: Clock,
      color: overdueCount > 0 ? '#f87171' : '#4ade80', to: '/tasks' },
  ]

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />

      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-8">
            <div className="flex-1">
              <div className="flex items-center justify-between sm:justify-start gap-4 mb-1">
                <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra">OPERATIONS CENTRE</p>
                <div className="signal-badge sm:hidden">
                  <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
                  <span className="nav-label text-[0.6rem] text-ice/50">LIVE</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <h1 className="font-display font-black text-3xl md:text-4xl text-ice-gradient">Command Dashboard</h1>
                <Link to="/tasks" className="w-full sm:w-auto">
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    className="btn-gold px-4 py-1.5 text-[0.65rem] rounded-sm flex items-center justify-center gap-2">
                    <TrendingUp size={12} />
                    NEW TASK
                  </motion.button>
                </Link>
              </div>
              <div className="gold-rule w-16 mt-2" />
            </div>
            <div className="signal-badge hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
              <span className="nav-label text-[0.6rem] text-ice/50">LIVE · 15m SYNC</span>
            </div>
          </motion.div>

          {/* Stat cards — all clickable */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {stats.map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }} whileHover={{ y: -2 }}>
                <Link to={s.to} style={{ textDecoration: 'none' }}>
                  <div className="glass-card p-4 rounded-sm h-full cursor-pointer">
                    <div className="flex items-center justify-between mb-2">
                      <p className="nav-label text-[0.48rem] text-ice/40 leading-tight">{s.label}</p>
                      <s.icon size={11} style={{ color: s.color }} />
                    </div>
                    <p className="font-display font-black text-2xl mb-0.5" style={{ color: s.color }}>{s.val}</p>
                    <p className="font-body text-[0.6rem] text-ice/30">{s.sub}</p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Pending Approvals — admin only, surfaced inline on dashboard */}
          <AnimatePresence>
            {isAdmin && pendingUsers.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="glass-card rounded-sm p-5 mb-6"
                style={{ border: '1px solid rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.04)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="nav-label text-[0.55rem] text-red-400/60 mb-0.5">ACTION REQUIRED</p>
                    <h2 className="font-display text-base text-frost">
                      Pending Approvals
                      <span className="ml-2 nav-label text-[0.5rem] px-2 py-0.5 rounded-full align-middle"
                        style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>
                        {pendingUsers.length}
                      </span>
                    </h2>
                  </div>
                  <Link to="/admin?tab=approvals" className="nav-label text-[0.5rem] text-red-400/60 hover:text-red-400 transition-colors flex items-center gap-1"
                    style={{ textDecoration: 'none' }}>
                    VIEW ALL <ChevronRight size={10} />
                  </Link>
                </div>
                {approvalMsg && (
                  <div className="mb-3 px-3 py-2 rounded-sm text-xs font-body"
                    style={{ background: approvalMsg.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', color: approvalMsg.ok ? '#4ade80' : '#f87171' }}>
                    {approvalMsg.text}
                  </div>
                )}
                <div className="space-y-2">
                  {pendingUsers.slice(0, 4).map(u => (
                    <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-sm"
                      style={{ background: 'rgba(13,15,28,0.5)', border: '1px solid rgba(248,113,113,0.1)' }}>
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-sm text-frost/80 truncate">{u.name || u.email.split('@')[0]}</p>
                        <p className="font-body text-xs text-ice/40 truncate">{u.email}</p>
                      </div>
                      <span className="nav-label text-[0.44rem] px-1.5 py-0.5 rounded-sm flex-shrink-0"
                        style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>
                        {u.role.replace(/_/g, ' ')}
                      </span>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button disabled={approvingId === u.id || rejectingId === u.id}
                          onClick={() => void handleApprove(u.id, u.email)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-sm nav-label text-[0.48rem] disabled:opacity-50"
                          style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }}>
                          {approvingId === u.id ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                          APPROVE
                        </button>
                        <button disabled={approvingId === u.id || rejectingId === u.id}
                          onClick={() => void handleReject(u.id, u.email)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-sm nav-label text-[0.48rem] disabled:opacity-50"
                          style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                          {rejectingId === u.id ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
                          REJECT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Capacity Table — rows are clickable, expand inline action panel */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }} className="glass-card rounded-sm xl:col-span-2">
              <div className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
                <div>
                  <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">WEEKLY INTELLIGENCE</p>
                  <h2 className="font-display text-lg text-frost">Who Is Free This Week</h2>
                </div>
                <p className="nav-label text-[0.45rem] text-ice/25">Click a row to act</p>
              </div>

              {data.interns.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="font-body text-sm text-ice/30">No intern data available.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="uris-table w-full">
                    <thead>
                      <tr>
                        <th className="text-left">Intern</th>
                        <th className="text-center">Presence</th>
                        <th className="text-center">Last Check-In</th>
                        <th className="text-center">Availability</th>
                        <th className="text-center">Capacity</th>
                        <th className="text-center">TLI</th>
                        <th className="text-center">RPI</th>
                        <th className="text-center">Cred.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.interns.map((intern, i) => (
                        <React.Fragment key={intern.id}>
                          {/* Main row — click to expand action panel */}
                          <motion.tr
                            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.4 + i * 0.06 }}
                            onClick={() => setExpandedInternId(prev => prev === intern.id ? null : intern.id)}
                            className="cursor-pointer select-none"
                            style={expandedInternId === intern.id ? { background: 'rgba(201,168,76,0.05)' } : undefined}>
                            <td>
                              <div className="flex items-center gap-2">
                                <BandDot score={intern.capacityScore} />
                                <span className="font-body text-sm text-frost/80">{intern.name}</span>
                                <ChevronRight size={10} className="text-ice/20 transition-transform flex-shrink-0"
                                  style={{ transform: expandedInternId === intern.id ? 'rotate(90deg)' : 'none' }} />
                              </div>
                            </td>
                            <td className="text-center">
                              {(() => {
                                const s = (intern as any).presenceStatus || 'OFFLINE'
                                const presenceMap: Record<string, { label: string; color: string; bg: string }> = {
                                  ONLINE:         { label: '🟢 Online',        color: '#4ade80',               bg: 'rgba(74,222,128,0.10)'  },
                                  IN_SESSION:     { label: '🔵 In Session',     color: '#60a5fa',               bg: 'rgba(96,165,250,0.10)'  },
                                  AVAILABLE_SOON: { label: '🟡 Available Soon', color: '#f59e0b',               bg: 'rgba(245,158,11,0.10)'  },
                                  OFFLINE:        { label: '⚪ Offline',        color: 'rgba(184,212,240,0.35)', bg: 'rgba(184,212,240,0.04)' },
                                }
                                const c = presenceMap[s] ?? presenceMap.OFFLINE
                                return (
                                  <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                                    style={{ background: c.bg, color: c.color }}>
                                    {c.label}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="text-center nav-label text-[0.5rem] text-ice/40">
                              {(intern as any).lastCheckIn
                                ? new Date((intern as any).lastCheckIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td className="text-center">
                              <span className="nav-label text-[0.55rem] px-2 py-0.5 rounded-full"
                                style={{
                                  background: intern.availability === 'Available' ? 'rgba(74,222,128,0.12)' : intern.availability === 'Partial' ? 'rgba(245,158,11,0.12)' : 'rgba(248,113,113,0.12)',
                                  color:      intern.availability === 'Available' ? '#4ade80'               : intern.availability === 'Partial' ? '#f59e0b'               : '#f87171',
                                }}>
                                {intern.availability}
                              </span>
                            </td>
                            <td className="text-center min-w-[100px]">
                              <div className="flex flex-col items-center">
                                <span className={`font-mono text-sm px-2 py-0.5 rounded-sm ${intern.capacityScore < 0 ? 'bg-red-500/20 text-red-400 font-bold' : ''}`}
                                  style={{ color: intern.capacityScore > 70 ? '#4ade80' : intern.capacityScore > 40 ? '#f59e0b' : intern.capacityScore < 0 ? '#ff4d4d' : '#f87171' }}>
                                  {intern.capacityScore}
                                  {intern.capacityScore === -30 && <span className="text-[0.5rem] block leading-none mt-0.5">EXAM WEEK</span>}
                                </span>
                                <ScoreBar val={Math.max(0, intern.capacityScore)} />
                              </div>
                            </td>
                            <td className="text-center font-mono text-sm"
                              style={{ color: intern.tli <= 6 ? '#4ade80' : intern.tli <= 12 ? '#f59e0b' : '#f87171' }}>
                              {intern.tli?.toFixed(1)}
                            </td>
                            <td className="text-center font-mono text-sm text-ice/60">{intern.rpi?.toFixed(1)}</td>
                            <td className="text-center font-mono text-sm text-ice/60">{intern.credibilityScore}</td>
                          </motion.tr>

                          {/* Inline action panel — expands below the row on click */}
                          <AnimatePresence>
                            {expandedInternId === intern.id && (
                              <tr key={`${intern.id}-actions`}>
                                <td colSpan={8} style={{ padding: 0 }}>
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                                    <div className="flex items-center gap-2 px-6 py-3 flex-wrap"
                                      style={{ background: 'rgba(201,168,76,0.04)', borderBottom: '1px solid rgba(201,168,76,0.08)' }}>
                                      <p className="nav-label text-[0.48rem] text-gold/40 mr-1">{intern.name.toUpperCase()}</p>

                                      <button onClick={() => nav(`/tasks?internId=${intern.id}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.5rem] transition-colors hover:border-ice/30"
                                        style={{ background: 'rgba(184,212,240,0.06)', border: '1px solid rgba(184,212,240,0.15)', color: 'rgba(184,212,240,0.7)' }}>
                                        <ClipboardList size={10} />VIEW TASKS
                                      </button>

                                      <button onClick={() => nav(`/chat?userId=${(intern as any).userId ?? intern.id}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.5rem] transition-colors hover:border-ice/30"
                                        style={{ background: 'rgba(184,212,240,0.06)', border: '1px solid rgba(184,212,240,0.15)', color: 'rgba(184,212,240,0.7)' }}>
                                        <MessageSquare size={10} />CHAT
                                      </button>

                                      <button onClick={() => nav(`/admin?tab=assign&internId=${intern.id}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.5rem] transition-colors"
                                        style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c' }}>
                                        <UserCheck size={10} />ASSIGN TASK
                                      </button>
                                    </div>
                                  </motion.div>
                                </td>
                              </tr>
                            )}
                          </AnimatePresence>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>

            {/* Alerts panel */}
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }} className="glass-card rounded-sm">
              <div className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
                <div>
                  <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">SYSTEM ALERTS</p>
                  <h2 className="font-display text-lg text-frost">Active Signals</h2>
                </div>
                <span className="nav-label text-[0.55rem] px-2 py-0.5 rounded-full text-red-400 bg-red-400/10">
                  {data.alerts.length} ACTIVE
                </span>
              </div>
              <div className="p-4 space-y-3">
                {data.alerts.length === 0 ? (
                  <div className="py-6 text-center">
                    <CheckCircle2 size={20} className="text-signal/40 mx-auto mb-2" />
                    <p className="font-body text-sm text-ice/30">No active alerts.</p>
                  </div>
                ) : (
                  // Critical alerts sorted first
                  [...data.alerts]
                    .sort((a, b) => {
                      if (a.severity === 'critical' && b.severity !== 'critical') return -1
                      if (b.severity === 'critical' && a.severity !== 'critical') return 1
                      return 0
                    })
                    .map((a, i) => {
                      const c = a.severity === 'critical' ? '#f87171' : '#f59e0b'
                      return (
                        <motion.div key={a.id ?? i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5 + i * 0.08 }} whileHover={{ x: 2 }}
                          className="flex gap-3 p-3 rounded-sm cursor-pointer"
                          style={{ background: `${c}08`, border: `1px solid ${c}22` }}>
                          <div className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse-slow"
                            style={{ background: c }} />
                          <div className="flex-1 min-w-0">
                            <p className="font-body text-sm leading-snug" style={{ color: `${c}cc` }}>{a.message}</p>
                            {a.severity === 'critical' && (
                              <span className="nav-label text-[0.44rem] text-red-400/60">CRITICAL</span>
                            )}
                          </div>
                        </motion.div>
                      )
                    })
                )}
                <Link to="/alerts" className="w-full flex items-center justify-between px-3 py-2 mt-2 rounded-sm text-gold/50 hover:text-gold transition-colors"
                  style={{ borderTop: '1px solid rgba(201,168,76,0.1)', textDecoration: 'none' }}>
                  <span className="nav-label text-[0.6rem]">VIEW ALL ALERTS</span>
                  <ChevronRight size={12} />
                </Link>
              </div>
            </motion.div>
          </div>

          {/*
           * AVAILABILITY HEATMAP
           * Data source: data.teams[].capacityScore from /admin/overview
           *   → admin.controller.js aggregates real ScoreHistory records per team.
           * No synthetic/fabricated values are used.
           * If no teams exist, show an empty state instead of manufactured data.
           */}
          {data.teams && data.teams.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }} className="glass-card rounded-sm mt-6 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">AVAILABILITY HEATMAP</p>
                  <h2 className="font-display text-lg text-frost">Team Capacity Overview</h2>
                </div>
                <Clock size={13} className="text-gold/40" />
              </div>

              {/* Real capacity data table — one row per team, current capacity score only.
                  Per-day breakdown requires AvailabilityWindow records in the DB.
                  Until that data exists this section shows the current aggregate score. */}
              <div className="overflow-x-auto">
                <table className="uris-table w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Team</th>
                      <th className="text-center">Members</th>
                      <th className="text-center">Avg Capacity</th>
                      <th className="text-center">Avg RPI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.map((team) => (
                      <tr key={team.id}>
                        <td>
                          <span className={`font-body text-sm ${team.isBestPerforming ? 'text-green-400 font-semibold' : 'text-frost/80'}`}>
                            {team.name} {team.isBestPerforming && '👑'}
                          </span>
                        </td>
                        <td className="text-center font-mono text-sm text-ice/60">{team.internCount}</td>
                        <td className="text-center">
                          <span className="font-mono text-sm font-bold"
                            style={{ color: team.capacityScore >= 70 ? '#4ade80' : team.capacityScore >= 40 ? '#f59e0b' : '#f87171' }}>
                            {team.capacityScore}
                          </span>
                        </td>
                        <td className="text-center font-mono text-sm text-ice/60">{team.rpi.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="nav-label text-[0.5rem] text-ice/25 mt-3 text-right">
                Capacity scores sourced from ScoreHistory · per-day breakdown available when AvailabilityWindow data is present
              </p>
            </motion.div>
          ) : (data.interns.length > 0) ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }} className="glass-card rounded-sm mt-6 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">AVAILABILITY HEATMAP</p>
                  <h2 className="font-display text-lg text-frost">Team Capacity Overview</h2>
                </div>
                <Clock size={13} className="text-gold/40" />
              </div>
              <div className="py-6 text-center">
                <Clock size={20} className="mx-auto mb-2 text-ice/20" />
                <p className="font-body text-sm text-ice/30">No team data available.</p>
                <p className="nav-label text-[0.5rem] text-ice/20 mt-1">
                  Assign interns to teams to see capacity data here.
                </p>
              </div>
            </motion.div>
          ) : null}
          {/* STEMONEF BRANDING */}
          <div className="mt-12 py-8 flex flex-col items-center gap-4 opacity-40">
            <div className="h-[1px] w-12 bg-gold/20" />
            <span className="font-display font-black text-xs tracking-[0.4em] text-ice-gradient">STEMONEF</span>
            <p className="nav-label text-[0.45rem] tracking-[0.6em] text-ice/30 uppercase">Intelligence Design System</p>
          </div>
        </div>
      </main>
    </div>
  )
}
