import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, AlertOctagon, Bell, Clock, Check, Loader2, Flag, Star, ClipboardList, Pause, ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import Sidebar   from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { useAlertStore } from '../store/alertStore'
import { useRealtimeStore } from '../store/realtimeStore'

// ── Type meta ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { Icon: React.ElementType; label: string; color: string }> = {
  blocker:                      { Icon: AlertOctagon,  label: 'BLOCKER',               color: '#f87171' },
  blocker_escalation:           { Icon: AlertOctagon,  label: 'BLOCKER ESC.',           color: '#f87171' },
  blocker_reported:             { Icon: Flag,          label: 'BLOCKER',               color: '#f87171' },
  task_paused:                  { Icon: Pause,         label: 'TASK PAUSED',           color: '#f59e0b' },
  task_assigned:                { Icon: ClipboardList, label: 'TASK ASSIGNED',         color: '#c9a84c' },
  review_submitted:             { Icon: Star,          label: 'REVIEW',                color: '#4ade80' },
  stale:                        { Icon: Clock,         label: 'STALE TASK',            color: '#f59e0b' },
  stale_task:                   { Icon: Clock,         label: 'STALE TASK',            color: '#f59e0b' },
  deadline_approaching:         { Icon: Clock,         label: 'DEADLINE',              color: '#f87171' },
  availability_reminder:        { Icon: Bell,          label: 'AVAILABILITY',          color: '#c9a84c' },
  credibility:                  { Icon: AlertTriangle, label: 'CREDIBILITY',           color: '#f87171' },
  availability:                 { Icon: Bell,          label: 'AVAILABILITY',          color: '#f59e0b' },
  capacity:                     { Icon: AlertTriangle, label: 'CAPACITY',              color: '#f59e0b' },
  low_capacity:                 { Icon: AlertTriangle, label: 'LOW CAPACITY',          color: '#f59e0b' },
  overload:                     { Icon: ShieldAlert,   label: 'OVERLOAD',              color: '#f87171' },
  overreliance:                 { Icon: Bell,          label: 'OVER-RELIANCE',         color: '#b8d4f0' },
  reassignment:                 { Icon: AlertTriangle, label: 'REASSIGNMENT',          color: '#f59e0b' },
  low_performance:              { Icon: AlertTriangle, label: 'LOW PERFORMANCE',       color: '#f87171' },
  spike:                        { Icon: Bell,          label: 'SCORE SPIKE',           color: '#f59e0b' },
  form_reminder:                { Icon: ClipboardList, label: 'FORM REMINDER',         color: '#c9a84c' },
  integration_inactivity:       { Icon: AlertTriangle, label: 'INTEGRATION INACTIVITY',color: '#f87171' },
  integration_delivery_risk:    { Icon: AlertTriangle, label: 'DELIVERY RISK',         color: '#f59e0b' },
  integration_collaboration_risk:{ Icon: Bell,         label: 'COLLAB RISK',           color: '#f59e0b' },
}

function getMeta(type: string) {
  return TYPE_META[type] ?? { Icon: AlertTriangle, label: type.replace(/_/g, ' ').toUpperCase(), color: '#f59e0b' }
}

function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Renders a message string — any https:// URL is turned into a gold clickable link.
 * Everything else is plain text.
 */
function MessageWithLinks({ text }: { text: string }) {
  // Split on URLs (greedy — captures everything up to whitespace)
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <p className="font-body text-sm text-frost/80 leading-snug break-words">
      {parts.map((part, i) =>
        part.match(/^https?:\/\//) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 transition-colors hover:opacity-80"
            style={{ color: '#c9a84c' }}
            onClick={e => e.stopPropagation()}
          >
            Open Form ↗
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Alerts() {
  const { alerts, resolvedAlerts, loading, unread, resolve, resolveAll, refresh } = useAlertStore()
  const { status: socketStatus, counters } = useRealtimeStore()
  const isLive = socketStatus === 'connected'
  const [filter, setFilter]           = useState<'all' | 'critical' | 'warning'>('all')
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set())
  const [clearing, setClearing]        = useState(false)

  // Refresh once on mount only — socket updates come via the store automatically.
  // Do NOT add `refresh` to deps or it creates an infinite loop.
  const didMount = useRef(false)
  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    void refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleResolve = async (id: string) => {
    setResolvingIds(prev => new Set(prev).add(id))
    try { await resolve(id) }
    finally { setResolvingIds(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try { await resolveAll() }
    finally { setClearing(false) }
  }

  const filtered = alerts.filter(a =>
    filter === 'all'      ? true :
    filter === 'critical' ? a.severity === 'critical' :
    a.severity === 'warning'
  )

  const critCount = alerts.filter(a => a.severity === 'critical').length
  const warnCount = alerts.filter(a => a.severity === 'warning').length
  const allClear  = !loading && alerts.length === 0

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8 max-w-3xl">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">SIGNAL MONITORING</p>
              <h1 className="font-display font-black text-3xl text-ice-gradient">System Alerts</h1>
              <div className="gold-rule w-14 mt-2" />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="signal-badge">
                {allClear ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="nav-label text-[0.6rem] text-green-400/70">ALL CLEAR</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
                    <span className="nav-label text-[0.6rem] text-ice/50">
                      {unread} ACTIVE SIGNAL{unread !== 1 ? 'S' : ''}
                    </span>
                  </>
                )}
              </div>

              {/* Live socket indicator */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm"
                style={{ background: isLive ? 'rgba(74,222,128,0.08)' : 'rgba(184,212,240,0.04)', border: `1px solid ${isLive ? 'rgba(74,222,128,0.2)' : 'rgba(184,212,240,0.08)'}` }}>
                {isLive
                  ? <><motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1 h-1 rounded-full bg-green-400" /><Wifi size={9} style={{ color: '#4ade80' }} /><span className="nav-label text-[0.48rem]" style={{ color: '#4ade80' }}>LIVE</span></>
                  : <><WifiOff size={9} style={{ color: 'rgba(184,212,240,0.25)' }} /><span className="nav-label text-[0.48rem]" style={{ color: 'rgba(184,212,240,0.25)' }}>OFFLINE</span></>
                }
              </div>

              {/* Critical counter — only show when > 0 */}
              {counters.criticalAlerts > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm"
                  style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)' }}>
                  <span className="w-1 h-1 rounded-full bg-red-400" />
                  <span className="nav-label text-[0.48rem]" style={{ color: '#f87171' }}>
                    {counters.criticalAlerts} CRITICAL
                  </span>
                </div>
              )}

              {alerts.length > 0 && (
                <motion.button whileTap={{ scale: 0.96 }} onClick={handleClearAll} disabled={clearing}
                  className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm transition-all disabled:opacity-40"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                  {clearing ? 'CLEARING...' : 'CLEAR ALL'}
                </motion.button>
              )}
            </div>
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-gold animate-spin" />
            </div>
          )}

          {!loading && (
            <>
              {/* Count pills */}
              {alerts.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {[
                    { key: 'all',      label: 'All',      val: alerts.length, c: '#c9a84c' },
                    { key: 'critical', label: 'Critical', val: critCount,     c: '#f87171' },
                    { key: 'warning',  label: 'Warning',  val: warnCount,     c: '#f59e0b' },
                  ].map(p => (
                    <motion.button key={p.key} whileTap={{ scale: 0.96 }}
                      onClick={() => setFilter(p.key as typeof filter)}
                      className="flex items-center gap-2 px-4 py-2 rounded-sm transition-all"
                      style={{
                        background: filter === p.key ? `${p.c}15` : 'rgba(13,15,28,0.6)',
                        border: `1px solid ${filter === p.key ? `${p.c}44` : 'rgba(201,168,76,0.1)'}`,
                      }}>
                      <span className="font-display font-black text-lg" style={{ color: p.c }}>{p.val}</span>
                      <span className="nav-label text-[0.55rem] text-ice/40">{p.label}</span>
                    </motion.button>
                  ))}
                </div>
              )}

              {/* Alert list — no staggered delay to prevent glitch on re-render */}
              <div className="space-y-3">
                <AnimatePresence mode="sync">
                  {filtered.length === 0 ? (
                    <motion.div key="empty"
                      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="glass-card rounded-sm p-12 text-center"
                      style={{ border: '1px solid rgba(74,222,128,0.15)' }}>
                      <div className="relative w-14 h-14 mx-auto mb-5">
                        <div className="w-14 h-14 rounded-full flex items-center justify-center"
                          style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                          <Check size={22} className="text-green-400" />
                        </div>
                        {[0, 0.5, 1.0].map(d => (
                          <motion.div key={d} className="absolute inset-0 rounded-full pointer-events-none"
                            style={{ border: '1px solid rgba(74,222,128,0.35)' }}
                            initial={{ opacity: 0.6, scale: 1 }}
                            animate={{ opacity: 0, scale: 2.2 }}
                            transition={{ duration: 2.2, delay: d, repeat: Infinity, ease: 'easeOut' }} />
                        ))}
                      </div>
                      <p className="font-display text-xl text-frost/60 mb-1">All signals clear</p>
                      <p className="font-body text-sm text-ice/25">
                        {filter !== 'all' ? `No ${filter} alerts` : 'No active alerts'}
                      </p>
                    </motion.div>
                  ) : filtered.map(alert => {
                    const meta        = getMeta(alert.type)
                    const c           = alert.severity === 'critical' ? '#f87171' : meta.color
                    const Icon        = meta.Icon
                    const isResolving = resolvingIds.has(alert.id)

                    return (
                      <motion.div key={alert.id}
                        layout="position"
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{   opacity: 0, x: 16, transition: { duration: 0.15 } }}
                        transition={{ duration: 0.2 }}
                        className="glass-card rounded-sm p-4 sm:p-5"
                        style={{ borderColor: `${c}25` }}>
                        <div className="flex items-start gap-3 sm:gap-4">

                          {/* Icon — only critical gets the pulse rings */}
                          <div className="relative flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 mt-0.5">
                            <div className="w-full h-full rounded-sm flex items-center justify-center"
                              style={{ background: `${c}12`, border: `1px solid ${c}30` }}>
                              <Icon size={14} style={{ color: c }} />
                            </div>
                            {alert.severity === 'critical' && (
                              [0, 0.6].map(d => (
                                <motion.div key={d} className="absolute inset-0 rounded-sm pointer-events-none"
                                  style={{ border: `1px solid ${c}` }}
                                  initial={{ opacity: 0.7, scale: 1 }}
                                  animate={{ opacity: 0,   scale: 2 }}
                                  transition={{ duration: 1.6, delay: d, repeat: Infinity, ease: 'easeOut' }} />
                              ))
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="nav-label text-[0.5rem] px-1.5 py-0.5 rounded-sm"
                                style={{ background: `${c}15`, color: c }}>
                                {meta.label}
                              </span>
                              {alert.severity === 'critical' && (
                                <span className="nav-label text-[0.46rem] px-1.5 py-0.5 rounded-sm"
                                  style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
                                  CRITICAL
                                </span>
                              )}
                              <span className="nav-label text-[0.46rem] text-ice/25 ml-auto">
                                {timeAgo(alert.createdAt)}
                              </span>
                            </div>
                            {/* URLs in form reminders become gold clickable links */}
                            <MessageWithLinks text={alert.message} />
                          </div>

                          {/* Resolve button */}
                          <motion.button
                            whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.88 }}
                            onClick={() => handleResolve(alert.id)}
                            disabled={isResolving}
                            className="flex-shrink-0 w-7 h-7 rounded-sm flex items-center justify-center transition-colors disabled:opacity-50"
                            style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}
                            title="Mark as resolved"
                          >
                            {isResolving
                              ? <Loader2 size={11} className="text-green-400 animate-spin" />
                              : <Check   size={11} className="text-green-400" />}
                          </motion.button>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* ── Resolved History ── */}
          {!loading && resolvedAlerts.length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-[1px] flex-1 bg-white/[0.06]" />
                <p className="nav-label text-[0.5rem] text-ice/25">RESOLVED HISTORY</p>
                <div className="h-[1px] flex-1 bg-white/[0.06]" />
              </div>
              <div className="space-y-2">
                {resolvedAlerts.map(alert => {
                  const meta = getMeta(alert.type)
                  const Icon = meta.Icon
                  return (
                    <div key={alert.id}
                      className="flex items-start gap-3 px-4 py-3 rounded-sm opacity-40"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <Icon size={12} className="flex-shrink-0 mt-0.5 text-ice/30" />
                      <div className="flex-1 min-w-0">
                        <MessageWithLinks text={alert.message} />
                        <p className="nav-label text-[0.44rem] text-ice/20 mt-0.5">{timeAgo(alert.createdAt)}</p>
                      </div>
                      <span className="nav-label text-[0.44rem] text-green-400/50 flex-shrink-0">✓ RESOLVED</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Branding */}
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
