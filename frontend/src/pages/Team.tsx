import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Loader2, AlertTriangle, Award, Wifi, WifiOff, Clock, LogIn, LogOut, ShieldCheck, X, Check } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getAdminOverview, type InternRow } from '../services/dashboard.service'
import { finishInternship } from '../services/admin.service'
import { changeUserRole } from '../services/collaboration.service'
import { extractErrorMessage } from '../services/error'

const SKILL_COLORS: Record<string, string> = {
  Frontend: '#b8d4f0',
  Backend: '#c9a84c',
  DevOps: '#4ade80',
  Testing: '#a78bfa',
  'AI/ML': '#fb923c',
  Research: '#34d399',
}

const PRESENCE_CFG = {
  ONLINE:         { label: 'ONLINE',         color: '#4ade80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.25)',  icon: Wifi },
  IN_SESSION:     { label: 'IN SESSION',      color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.25)',  icon: Wifi },
  AVAILABLE_SOON: { label: 'AVAILABLE SOON',  color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  icon: Clock },
  OFFLINE:        { label: 'OFFLINE',         color: 'rgba(184,212,240,0.35)', bg: 'rgba(184,212,240,0.04)', border: 'rgba(184,212,240,0.1)', icon: WifiOff },
} as const

function PresenceBadge({ status }: { status?: string }) {
  const cfg = PRESENCE_CFG[(status ?? 'OFFLINE') as keyof typeof PRESENCE_CFG] ?? PRESENCE_CFG.OFFLINE
  const Icon = cfg.icon
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      {status === 'ONLINE' && (
        <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
          className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
      )}
      {status !== 'ONLINE' && <Icon size={9} style={{ color: cfg.color, flexShrink: 0 }} />}
      <span className="nav-label text-[0.45rem]" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  )
}

function RingScore({ val, label }: { val: number; label: string }) {
  const r = 22
  const circ = 2 * Math.PI * r
  const c = val > 70 ? '#4ade80' : val > 40 ? '#f59e0b' : '#f87171'
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 52 52" className="w-14 h-14 -rotate-90">
          <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          <motion.circle cx="26" cy="26" r={r} fill="none" stroke={c} strokeWidth="3"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - val / 100) }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display font-black text-sm"
          style={{ color: c }}>{val}</span>
      </div>
      <span className="nav-label text-[0.5rem] text-ice/40">{label}</span>
    </div>
  )
}

export default function Team() {
  const [team, setTeam]       = useState<InternRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [selected, setSelected] = useState<InternRow | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoteMsg, setPromoteMsg]   = useState<{ id: string; ok: boolean; text: string } | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await getAdminOverview()
      setTeam(data.interns)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load team data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleFinish = async (internId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to finish ${name}'s internship? They will be moved to alumni status and lose dashboard access.`)) return
    try {
      await finishInternship(internId)
      await load()
    } catch (err) {
      alert(extractErrorMessage(err, 'Failed to finish internship.'))
    }
  }

  const handlePromoteToCoreAdmin = async (intern: InternRow) => {
    if (!window.confirm(`Promote ${intern.name} to CORE_ADMIN? They will gain full admin access immediately.`)) return
    setPromotingId(intern.id)
    setPromoteMsg(null)
    try {
      await changeUserRole(intern.id, 'CORE_ADMIN', 'Promoted via Team Intelligence page')
      setPromoteMsg({ id: intern.id, ok: true, text: `${intern.name} promoted to Core Admin.` })
    } catch (err: unknown) {
      setPromoteMsg({ id: intern.id, ok: false, text: extractErrorMessage(err, 'Promotion failed.') })
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">COHORT OVERVIEW</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Team Intelligence</h1>
            <div className="gold-rule w-14 mt-2" />
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="text-gold animate-spin" />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="glass-card rounded-sm p-10 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-body text-sm text-ice/50">{error}</p>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && team.length === 0 && (
            <div className="glass-card rounded-sm p-10 text-center">
              <p className="font-body text-sm text-ice/30">No team members found.</p>
            </div>
          )}

          {/* Online count banner */}
          {!loading && !error && team.length > 0 && (
            <div className="flex items-center gap-4 mb-6 flex-wrap">
              {(['ONLINE', 'IN_SESSION', 'AVAILABLE_SOON', 'OFFLINE'] as const).map(s => {
                const count = team.filter(i => (i.presenceStatus ?? 'OFFLINE') === s).length
                if (count === 0) return null
                const cfg = PRESENCE_CFG[s]
                return (
                  <div key={s} className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm"
                    style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                    <span className="font-display font-black text-base" style={{ color: cfg.color }}>{count}</span>
                    <span className="nav-label text-[0.5rem]" style={{ color: cfg.color }}>{cfg.label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Team grid */}
          {!loading && !error && team.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
              {team.map((intern, i) => (
                <motion.div key={intern.id}
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  whileHover={{ y: -4, borderColor: 'rgba(201,168,76,0.3)' }}
                  onClick={() => setSelected(intern === selected ? null : intern)}
                  className="glass-card rounded-sm p-6 cursor-pointer"
                  style={{ borderColor: selected?.id === intern.id ? 'rgba(201,168,76,0.35)' : undefined }}>

                  {/* Top row — name + presence badge */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1 mr-3">
                      <p className="font-display text-lg text-frost truncate">{intern.name}</p>
                      <p className="font-body text-xs text-ice/40">{intern.college ?? '—'}</p>
                    </div>
                    <PresenceBadge status={intern.presenceStatus} />
                  </div>

                  {/* Check-in info row */}
                  <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-sm"
                    style={{ background: 'rgba(184,212,240,0.03)', border: '1px solid rgba(184,212,240,0.06)' }}>
                    {intern.presenceStatus === 'ONLINE' || intern.presenceStatus === 'IN_SESSION' ? (
                      <div className="flex items-center gap-1.5">
                        <LogIn size={10} style={{ color: '#4ade80' }} />
                        <span className="nav-label text-[0.48rem]" style={{ color: '#4ade80' }}>
                          CHECKED IN
                          {intern.lastCheckIn && ` · ${new Date(intern.lastCheckIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                      </div>
                    ) : intern.lastCheckIn ? (
                      <div className="flex items-center gap-1.5">
                        <LogOut size={10} style={{ color: 'rgba(184,212,240,0.4)' }} />
                        <span className="nav-label text-[0.48rem] text-ice/30">
                          LAST SEEN · {new Date(intern.lastCheckIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ) : (
                      <span className="nav-label text-[0.48rem] text-ice/20">No check-in today</span>
                    )}
                    {intern.todayWindow && (
                      <span className="nav-label text-[0.45rem] ml-auto text-ice/30">
                        Window: {new Date(intern.todayWindow.availableFrom).toISOString().slice(11,16)} → {new Date(intern.todayWindow.availableTo).toISOString().slice(11,16)}
                      </span>
                    )}
                  </div>

                  {/* Availability + score rings */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                      style={{
                        background: intern.availability === 'Available' ? 'rgba(74,222,128,0.12)' : intern.availability === 'Partial' ? 'rgba(245,158,11,0.12)' : 'rgba(248,113,113,0.12)',
                        color: intern.availability === 'Available' ? '#4ade80' : intern.availability === 'Partial' ? '#f59e0b' : '#f87171',
                      }}>{intern.availability}</span>
                    <span className="nav-label text-[0.45rem] text-ice/25">
                      {intern.activeTasks ?? 0} active · {intern.completedTasks ?? 0} done
                    </span>
                  </div>

                  {/* Score rings */}
                  <div className="flex items-center justify-around mb-4">
                    <RingScore val={intern.capacityScore}          label="CAPACITY" />
                    <RingScore val={Math.round(intern.rpi * 20)}   label="RPI" />
                    <RingScore val={intern.credibilityScore}       label="CRED." />
                  </div>

                  {/* TLI bar */}
                  <div className="mb-4">
                    <div className="flex justify-between mb-1">
                      <span className="nav-label text-[0.5rem] text-gold/40">TASK LOAD INDEX</span>
                      <span className="font-mono text-xs"
                        style={{ color: intern.tli <= 6 ? '#4ade80' : intern.tli <= 12 ? '#f59e0b' : '#f87171' }}>
                        {intern.tli?.toFixed(1)}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <motion.div initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (intern.tli / 15) * 100)}%` }}
                        transition={{ duration: 1, delay: i * 0.05 + 0.3 }}
                        style={{
                          height: '100%', borderRadius: 2,
                          background: intern.tli <= 6 ? 'linear-gradient(90deg,#4ade8055,#4ade80)' : intern.tli <= 12 ? 'linear-gradient(90deg,#f59e0b55,#f59e0b)' : 'linear-gradient(90deg,#f8717155,#f87171)',
                        }} />
                    </div>
                  </div>

                  {/* Skill tags */}
                  {(intern.skill_tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(intern.skill_tags ?? []).map(tag => (
                        <span key={tag} className="nav-label text-[0.5rem] px-2 py-0.5 rounded-sm"
                          style={{ background: `${SKILL_COLORS[tag] ?? '#c9a84c'}15`, color: SKILL_COLORS[tag] ?? '#c9a84c' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Promote msg */}
                  <AnimatePresence>
                    {promoteMsg?.id === intern.id && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-2 mb-3 p-2 rounded-sm"
                        style={{
                          background: promoteMsg.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                          border: `1px solid ${promoteMsg.ok ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                        }}>
                        {promoteMsg.ok
                          ? <Check size={10} style={{ color: '#4ade80', flexShrink: 0 }} />
                          : <AlertTriangle size={10} style={{ color: '#f87171', flexShrink: 0 }} />}
                        <span className="nav-label text-[0.48rem]"
                          style={{ color: promoteMsg.ok ? '#4ade80' : '#f87171' }}>
                          {promoteMsg.text}
                        </span>
                        <button onClick={e => { e.stopPropagation(); setPromoteMsg(null) }}
                          className="ml-auto text-ice/30 hover:text-ice/60">
                          <X size={9} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Action row */}
                  <div className="flex items-center justify-between pt-3 gap-2"
                    style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}>
                    <motion.button whileTap={{ scale: 0.95 }}
                      onClick={(e) => { e.stopPropagation(); handleFinish(intern.id, intern.name) }}
                      className="nav-label text-[0.5rem] px-2 py-1 rounded-sm transition-all flex items-center gap-1"
                      style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
                      <Award size={10} /> FINISH
                    </motion.button>

                    {/* Quick promote to Core Admin */}
                    <motion.button whileTap={{ scale: 0.95 }}
                      disabled={promotingId === intern.id}
                      onClick={(e) => { e.stopPropagation(); void handlePromoteToCoreAdmin(intern) }}
                      className="nav-label text-[0.5rem] px-2 py-1 rounded-sm transition-all flex items-center gap-1 disabled:opacity-40"
                      style={{ background: 'rgba(96,165,250,0.08)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}
                      title="Promote to Core Admin">
                      {promotingId === intern.id
                        ? <Loader2 size={9} className="animate-spin" />
                        : <ShieldCheck size={9} />}
                      CORE ADMIN
                    </motion.button>

                    <ChevronRight size={12} className="text-gold/30" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}

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


