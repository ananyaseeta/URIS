import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle, AlertTriangle, XCircle, Loader2,
  RefreshCw, Wifi, WifiOff, Clock, GitBranch,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getIntegrationStatus, type IntegrationAudit, type IntegrationInfo } from '../services/admin.service'
import { getOpenProjectIntelligence, type OpenProjectIntelligenceData, type OPMilestone, type OPDetectedPattern } from '../services/analytics.service'

// ── Design tokens (match index.css exactly) ───────────────────────────────────
const GOLD    = '#c9a84c'
const GREEN   = '#4ade80'
const AMBER   = '#f59e0b'
const RED     = '#f87171'
const ICE_DIM = 'rgba(184,212,240,0.25)'
const ICE     = 'rgba(184,212,240,0.7)'

// ── Status helpers ────────────────────────────────────────────────────────────

function statusColor(status: IntegrationInfo['status']): string {
  if (status === 'connected')       return GREEN
  if (status === 'partial')         return AMBER
  if (status === 'not_configured')  return ICE_DIM
  return RED
}

function statusLabel(status: IntegrationInfo['status']): string {
  if (status === 'connected')       return 'CONNECTED'
  if (status === 'partial')         return 'PARTIAL'
  if (status === 'not_configured')  return 'NOT CONFIGURED'
  return 'FAILED'
}

function StatusIcon({ status }: { status: IntegrationInfo['status'] }) {
  const size = 16
  if (status === 'connected')      return <CheckCircle size={size} style={{ color: GREEN }} />
  if (status === 'partial')        return <AlertTriangle size={size} style={{ color: AMBER }} />
  if (status === 'not_configured') return <WifiOff size={size} style={{ color: ICE_DIM }} />
  return <XCircle size={size} style={{ color: RED }} />
}

function OverallBadge({ status }: { status: IntegrationAudit['status'] }) {
  const map = {
    all_operational: { label: 'ALL OPERATIONAL', color: GREEN, bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' },
    partial:         { label: 'PARTIAL',          color: AMBER, bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
    degraded:        { label: 'DEGRADED',         color: RED,   bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  }
  const s = map[status]
  return (
    <span className="nav-label text-[0.55rem] px-3 py-1.5 rounded-sm"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
      {s.label}
    </span>
  )
}

// ── Integration card ──────────────────────────────────────────────────────────

function IntegrationCard({ integration, index }: { integration: IntegrationInfo; index: number }) {
  const color = statusColor(integration.status)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.07 }}
      className="glass-card rounded-sm p-5"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-sm flex-shrink-0" style={{ background: `${color}18` }}>
            <StatusIcon status={integration.status} />
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-sm text-frost/90 truncate">{integration.name}</p>
            <p className="nav-label text-[0.5rem] mt-0.5" style={{ color: ICE_DIM }}>
              {integration.frontendVisible ? 'VISIBLE IN UI' : 'BACKEND ONLY'}
            </p>
          </div>
        </div>
        <span className="nav-label text-[0.5rem] px-2 py-1 rounded-sm flex-shrink-0"
          style={{
            background: `${color}18`,
            border:     `1px solid ${color}33`,
            color,
          }}>
          {statusLabel(integration.status)}
        </span>
      </div>

      {/* Gold rule */}
      <div className="gold-rule mb-4" />

      {/* Notes */}
      <div className="mb-4 p-3 rounded-sm"
        style={{ background: 'rgba(7,8,15,0.5)', border: '1px solid rgba(201,168,76,0.08)' }}>
        <p className="nav-label text-[0.48rem] mb-1" style={{ color: `${GOLD}66` }}>STATUS NOTE</p>
        <p className="font-body text-xs" style={{ color: ICE }}>{integration.health ?? integration.notes}</p>
      </div>

      {/* Env + operational indicators */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: (integration.configured ?? integration.envOk) ? GREEN : RED }} />
          <span className="nav-label text-[0.48rem]" style={{ color: (integration.configured ?? integration.envOk) ? GREEN : RED }}>
            ENV VARS
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: integration.operational ? GREEN : AMBER }} />
          <span className="nav-label text-[0.48rem]" style={{ color: integration.operational ? GREEN : AMBER }}>
            OPERATIONAL
          </span>
        </div>
        {integration.frontendVisible && (
          <div className="flex items-center gap-1.5">
            <Wifi size={9} style={{ color: GREEN }} />
            <span className="nav-label text-[0.48rem]" style={{ color: GREEN }}>UI VISIBLE</span>
          </div>
        )}
      </div>

      {/* Features list */}
      <div>
        <p className="nav-label text-[0.48rem] mb-2" style={{ color: `${GOLD}55` }}>FEATURES</p>
        <div className="flex flex-wrap gap-1.5">
          {(integration.powers ?? integration.features ?? []).map(f => (
            <span key={f} className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
              style={{ background: 'rgba(184,212,240,0.05)', border: '1px solid rgba(184,212,240,0.1)', color: ICE_DIM }}>
              {f}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ── OpenProject Intelligence Panel ───────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  assignmentChurn01:      'Assignment Churn',
  milestoneInstability01: 'Milestone Instability',
  delayedUpdates01:       'Delayed Updates',
  blockerFrequency01:     'Blocker Frequency',
  sprintInstability01:    'Sprint Instability',
}

function SignalBar({ label, value01, color }: { label: string; value01: number; color: string }) {
  const pct = Math.round(value01 * 100)
  return (
    <div className="flex items-center gap-3">
      <p className="nav-label text-[0.48rem] w-36 flex-shrink-0" style={{ color: ICE_DIM }}>{label}</p>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(184,212,240,0.08)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <span className="font-mono text-xs w-8 text-right flex-shrink-0" style={{ color }}>{pct}%</span>
    </div>
  )
}

function MilestoneRow({ m }: { m: OPMilestone }) {
  const color = m.isOverdue ? RED : m.percentDone >= 100 ? GREEN : AMBER
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
      style={{ borderColor: 'rgba(184,212,240,0.06)' }}>
      <div className="flex-1 min-w-0">
        <p className="font-body text-xs text-frost/80 truncate">{m.subject}</p>
        <p className="nav-label text-[0.44rem] mt-0.5" style={{ color: ICE_DIM }}>
          {m.dueDate
            ? `Due ${new Date(m.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
            : 'No due date'}
          {' · '}{m.status}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(184,212,240,0.08)' }}>
          <div className="h-full rounded-full" style={{ width: `${m.percentDone}%`, background: color }} />
        </div>
        <span className="font-mono text-xs w-8 text-right" style={{ color }}>{m.percentDone}%</span>
        {m.isOverdue && (
          <span className="nav-label text-[0.44rem] px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(248,113,113,0.12)', color: RED }}>OVERDUE</span>
        )}
      </div>
    </div>
  )
}

function PatternBadge({ p }: { p: OPDetectedPattern }) {
  const color = p.severity === 'high' ? RED : AMBER
  return (
    <div className="flex items-start gap-2 p-3 rounded-sm"
      style={{ background: `${color}08`, border: `1px solid ${color}18` }}>
      <AlertTriangle size={11} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="nav-label text-[0.48rem]" style={{ color }}>
          {p.pattern.replace(/_/g, ' ').toUpperCase()}
        </p>
        <p className="font-body text-xs mt-0.5" style={{ color: ICE_DIM }}>{p.detail}</p>
      </div>
    </div>
  )
}

function OpenProjectPanel({ data }: { data: OpenProjectIntelligenceData }) {
  if (!data.available) {
    return (
      <div className="glass-card rounded-sm p-5 mt-6"
        style={{ border: '1px solid rgba(184,212,240,0.08)' }}>
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={14} style={{ color: ICE_DIM }} />
          <p className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>OPENPROJECT INTELLIGENCE</p>
        </div>
        <p className="font-body text-xs" style={{ color: ICE_DIM }}>
          {data.reason ?? 'OpenProject not configured or unreachable.'}
        </p>
      </div>
    )
  }

  const healthColor = (data.opHealthScore ?? 0) >= 75 ? GREEN
    : (data.opHealthScore ?? 0) >= 50 ? AMBER : RED

  const signals = data.signals
  const signalEntries = Object.entries(signals) as [string, number][]

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-sm p-5 mt-6"
      style={{ border: `1px solid ${healthColor}22` }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-sm" style={{ background: `${healthColor}15` }}>
            <GitBranch size={13} style={{ color: healthColor }} />
          </div>
          <div>
            <p className="nav-label text-[0.5rem]" style={{ color: `${GOLD}88` }}>OPENPROJECT INTELLIGENCE</p>
            <p className="font-body text-xs" style={{ color: ICE_DIM }}>
              {data.raw?.totalWPs ?? 0} work packages · {data.raw?.totalMilestones ?? 0} milestones
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display font-black text-2xl leading-none" style={{ color: healthColor }}>
            {data.opHealthScore ?? '—'}
          </p>
          <p className="nav-label text-[0.44rem]" style={{ color: ICE_DIM }}>OP HEALTH</p>
        </div>
      </div>

      {/* Signal bars */}
      <div className="space-y-2 mb-4">
        {signalEntries.map(([key, val]) => {
          const color = val > 0.5 ? RED : val > 0.25 ? AMBER : GREEN
          return (
            <SignalBar
              key={key}
              label={SIGNAL_LABELS[key] ?? key}
              value01={val}
              color={color}
            />
          )
        })}
      </div>

      {/* Raw counters */}
      {data.raw && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'OVERDUE MILESTONES', value: data.raw.overdueMilestones, color: data.raw.overdueMilestones > 0 ? RED : GREEN },
            { label: 'BLOCKED WPs',        value: data.raw.blockerCount,       color: data.raw.blockerCount > 0 ? AMBER : GREEN },
            { label: 'DELAYED WPs',        value: data.raw.delayedCount,       color: data.raw.delayedCount > 0 ? AMBER : GREEN },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-sm p-2 text-center"
              style={{ background: 'rgba(184,212,240,0.04)', border: '1px solid rgba(184,212,240,0.08)' }}>
              <p className="font-display font-black text-xl" style={{ color }}>{value}</p>
              <p className="nav-label text-[0.42rem] mt-0.5" style={{ color: ICE_DIM }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Detected patterns */}
      {(data.detectedPatterns?.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="nav-label text-[0.48rem] mb-2" style={{ color: `${GOLD}66` }}>DETECTED PATTERNS</p>
          <div className="space-y-2">
            {data.detectedPatterns!.map((p, i) => <PatternBadge key={i} p={p} />)}
          </div>
        </div>
      )}

      {/* Milestone timeline */}
      {(data.raw?.milestones?.length ?? 0) > 0 && (
        <div>
          <p className="nav-label text-[0.48rem] mb-2" style={{ color: `${GOLD}66` }}>MILESTONE TIMELINE</p>
          <div className="glass-card rounded-sm px-3 py-1"
            style={{ border: '1px solid rgba(184,212,240,0.06)' }}>
            {data.raw!.milestones.map(m => <MilestoneRow key={m.opId} m={m} />)}
          </div>
        </div>
      )}

      {/* All clear */}
      {(data.detectedPatterns?.length ?? 0) === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-sm"
          style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)' }}>
          <CheckCircle size={12} style={{ color: GREEN }} />
          <p className="font-body text-xs" style={{ color: GREEN }}>No operational patterns detected — OpenProject is healthy.</p>
        </div>
      )}
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Integrations() {
  const [data, setData]       = useState<IntegrationAudit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [opData, setOpData]   = useState<OpenProjectIntelligenceData | null>(null)
  const [opLoading, setOpLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await getIntegrationStatus()
      setData(result)
      setLastRefresh(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load integration status.')
    } finally {
      setLoading(false)
    }
    // Load OP intelligence in parallel (non-blocking)
    setOpLoading(true)
    getOpenProjectIntelligence()
      .then(setOpData)
      .catch(() => setOpData({ available: false, reason: 'Failed to load OpenProject intelligence.', signals: { assignmentChurn01: 0, milestoneInstability01: 0, delayedUpdates01: 0, blockerFrequency01: 0, sprintInstability01: 0 } }))
      .finally(() => setOpLoading(false))
  }

  useEffect(() => { void load() }, [])

  const connectedCount  = data?.integrations.filter(i => i.status === 'connected').length ?? 0
  const totalCount      = data?.integrations.length ?? 0
  // uptime comes back as a pre-formatted string (e.g. "2h 15m 30s") from the backend
  const uptimeDisplay   = typeof data?.uptime === 'string' ? data.uptime : data ? `${Math.floor((data.uptime as number) / 3600)}h ${Math.floor(((data.uptime as number) % 3600) / 60)}m` : '—'

  return (
    <div className="min-h-screen bg-navy-950 text-frost relative overflow-hidden">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">SYSTEM HEALTH</p>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="font-display font-black text-3xl text-ice-gradient">Integration Status</h1>
                <div className="gold-rule w-14 mt-2" />
              </div>
              <div className="flex items-center gap-3">
                {data && <OverallBadge status={data.status} />}
                <motion.button
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => void load()}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 rounded-sm nav-label text-[0.55rem] disabled:opacity-40 transition-all"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: GOLD }}>
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                  REFRESH
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Loading */}
          {loading && !data && (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="text-gold animate-spin" />
            </div>
          )}

          {/* Error */}
          {error && !data && (
            <div className="glass-card rounded-sm p-8 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: RED }} />
              <p className="font-body text-sm" style={{ color: ICE_DIM }}>{error}</p>
            </div>
          )}

          {data && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }} className="glass-card rounded-sm p-4">
                  <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>CONNECTED</p>
                  <p className="font-display font-black text-2xl" style={{ color: GREEN }}>
                    {connectedCount}<span className="text-sm font-normal" style={{ color: ICE_DIM }}>/{totalCount}</span>
                  </p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }} className="glass-card rounded-sm p-4">
                  <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>UPTIME</p>
                  <p className="font-display font-black text-2xl" style={{ color: GOLD }}>
                    {uptimeDisplay}
                  </p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }} className="glass-card rounded-sm p-4">
                  <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>LAST CHECKED</p>
                  <p className="font-body text-sm" style={{ color: ICE }}>
                    {lastRefresh
                      ? lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '—'}
                  </p>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }} className="glass-card rounded-sm p-4">
                  <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>OVERALL</p>
                  <div className="flex items-center gap-2 mt-1">
                    {data.status === 'all_operational'
                      ? <CheckCircle size={16} style={{ color: GREEN }} />
                      : data.status === 'degraded'
                        ? <XCircle size={16} style={{ color: RED }} />
                        : <AlertTriangle size={16} style={{ color: AMBER }} />}
                    <span className="nav-label text-[0.55rem]"
                      style={{ color: data.status === 'all_operational' ? GREEN : data.status === 'degraded' ? RED : AMBER }}>
                      {data.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </motion.div>
              </div>

              {/* Integration cards grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {data.integrations.map((integration, i) => (
                  <IntegrationCard key={integration.id} integration={integration} index={i} />
                ))}
              </div>

              {/* OpenProject Intelligence Panel */}
              {opLoading && (
                <div className="flex items-center gap-2 mt-6 p-4 glass-card rounded-sm"
                  style={{ border: '1px solid rgba(184,212,240,0.08)' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: GOLD }} />
                  <p className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>Loading OpenProject intelligence...</p>
                </div>
              )}
              {!opLoading && opData && <OpenProjectPanel data={opData} />}

              {/* Legend */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
                className="mt-8 glass-card rounded-sm p-4">
                <p className="nav-label text-[0.5rem] mb-3" style={{ color: `${GOLD}55` }}>LEGEND</p>
                <div className="flex flex-wrap gap-4">
                  {[
                    { color: GREEN,   label: 'CONNECTED — env vars set, API reachable, operational' },
                    { color: AMBER,   label: 'PARTIAL — env vars set but API unreachable or incomplete' },
                    { color: ICE_DIM, label: 'NOT CONFIGURED — env vars missing' },
                    { color: RED,     label: 'FAILED — configured but connection failed' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.color }} />
                      <span className="nav-label text-[0.48rem]" style={{ color: ICE_DIM }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Timestamp footer */}
              <p className="text-center nav-label text-[0.48rem] mt-6" style={{ color: 'rgba(184,212,240,0.15)' }}>
                <Clock size={9} className="inline mr-1" />
                Data as of {new Date(data.timestamp).toLocaleString('en-GB')} · Uptime {uptimeDisplay}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
