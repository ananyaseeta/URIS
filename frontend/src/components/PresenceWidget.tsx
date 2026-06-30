/**
 * PresenceWidget — compact check-in/check-out panel for the intern dashboard.
 *
 * Matches existing glass-card / btn-gold / btn-outline styling exactly.
 * Does NOT redesign any existing card — this is a standalone additive widget.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LogIn, LogOut, Clock, Calendar, Loader2, X } from 'lucide-react'
import { usePresenceStore } from '../store/presenceStore'
import { declareWindow, formatDuration } from '../services/presence.service'

// ── Status colour map — matches existing severity palette ──────────────────
const STATUS_CFG = {
  ONLINE:         { label: 'ONLINE',         color: '#4ade80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.25)',  dot: true  },
  IN_SESSION:     { label: 'IN SESSION',      color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.25)',  dot: false },
  AVAILABLE_SOON: { label: 'AVAILABLE SOON',  color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  dot: false },
  OFFLINE:        { label: 'OFFLINE',         color: 'rgba(184,212,240,0.35)', bg: 'rgba(184,212,240,0.04)', border: 'rgba(184,212,240,0.1)', dot: false },
} as const

// ── Helpers ────────────────────────────────────────────────────────────────
// Extract HH:MM directly from a stored time/datetime string without any
// timezone conversion. The backend stores TIME values like "18:00:00" or
// returns ISO strings like "1970-01-01T18:00:00.000Z". We always want the
// time component exactly as the intern typed it — no UTC conversion.
function extractTimeHHMM(d: string | Date): string {
  const s = typeof d === 'string' ? d : d.toISOString()
  // "1970-01-01T18:00:00.000Z" → "18:00"
  // "18:00:00"                 → "18:00"
  // "2026-06-11T18:00:00"      → "18:00"
  const match = s.match(/(\d{2}:\d{2})/)
  return match ? match[1] : s.slice(0, 5)
}

// ── Window declaration form ────────────────────────────────────────────────
function WindowForm({ onDone }: { onDone: () => void }) {
  const [from, setFrom] = useState('18:00')
  const [to,   setTo]   = useState('22:00')
  const [saving, setSaving] = useState(false)
  const load = usePresenceStore(s => s.load)

  const handleSave = async () => {
    setSaving(true)
    try {
      // Send plain time strings (HH:MM) — backend stores them as TIME without
      // timezone conversion, so the intern sees exactly what they typed.
      await declareWindow({
        availableFrom: from,  // e.g. "18:00"
        availableTo:   to,    // e.g. "22:00"
      })
      await load()
      onDone()
    } catch { /* non-fatal */ }
    finally { setSaving(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-3"
      style={{ borderTop: '1px solid rgba(201,168,76,0.1)', paddingTop: '12px' }}>
      <p className="nav-label text-[0.55rem] text-gold/50">DECLARE AVAILABILITY WINDOW</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="nav-label text-[0.5rem] text-ice/30 mb-1">FROM</p>
          <input type="time" className="uris-input text-sm"
            value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <p className="nav-label text-[0.5rem] text-ice/30 mb-1">TO</p>
          <input type="time" className="uris-input text-sm"
            value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          disabled={saving}
          onClick={handleSave}
          className="btn-gold flex-1 py-2 rounded-sm text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Calendar size={11} />}
          {saving ? 'SAVING…' : 'SAVE WINDOW'}
        </motion.button>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={onDone}
          className="btn-outline px-3 py-2 rounded-sm text-xs">
          <X size={11} />
        </motion.button>
      </div>
    </motion.div>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────
export default function PresenceWidget() {
  const { status, todayData, loading, checkingIn, checkingOut, error, load, doCheckIn, doCheckOut } =
    usePresenceStore()
  const [showWindowForm, setShowWindowForm] = useState(false)

  useEffect(() => { void load() }, [])

  const cfg     = STATUS_CFG[status ?? 'OFFLINE']
  const isOnline = status === 'ONLINE'

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-sm p-5"
      style={{ border: `1px solid ${cfg.border}` }}>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">VIRTUAL PRESENCE</p>
          <h3 className="font-display text-base text-frost">Today's Session</h3>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          {cfg.dot && (
            <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: cfg.color }} />
          )}
          <span className="nav-label text-[0.5rem]" style={{ color: cfg.color }}>
            {loading ? 'LOADING…' : cfg.label}
          </span>
        </div>
      </div>

      {/* Today's duration */}
      {todayData && (
        <div className="flex items-center gap-3 mb-4">
          <Clock size={13} style={{ color: 'rgba(184,212,240,0.3)' }} />
          <div>
            <p className="nav-label text-[0.48rem] text-ice/30">TODAY'S SESSION TIME</p>
            <p className="font-display font-black text-xl text-gold leading-none mt-0.5">
              {formatDuration(todayData.totalDurationToday)}
            </p>
          </div>
          {todayData.sessions.length > 1 && (
            <span className="nav-label text-[0.48rem] text-ice/25 ml-auto">
              {todayData.sessions.length} sessions
            </span>
          )}
        </div>
      )}

      {/* Declared availability window */}
      {todayData?.window && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-sm"
          style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}>
          <Calendar size={11} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div className="min-w-0">
            <p className="nav-label text-[0.48rem] text-ice/30">DECLARED WINDOW</p>
            <p className="font-body text-xs text-frost/70">
              {extractTimeHHMM(todayData.window.availableFrom)}
              {' → '}
              {extractTimeHHMM(todayData.window.availableTo)}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="font-body text-xs text-red-400/80 mb-3 px-2 py-1.5 rounded-sm"
          style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
          {error}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isOnline ? (
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            disabled={checkingIn || loading}
            onClick={doCheckIn}
            className="btn-gold flex-1 py-2.5 rounded-sm flex items-center justify-center gap-2 text-xs disabled:opacity-50">
            {checkingIn ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
            {checkingIn ? 'CHECKING IN…' : 'CHECK IN'}
          </motion.button>
        ) : (
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            disabled={checkingOut}
            onClick={doCheckOut}
            className="btn-outline flex-1 py-2.5 rounded-sm flex items-center justify-center gap-2 text-xs disabled:opacity-50"
            style={{ borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>
            {checkingOut ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
            {checkingOut ? 'CHECKING OUT…' : 'CHECK OUT'}
          </motion.button>
        )}

        {/* Declare window toggle */}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => setShowWindowForm(v => !v)}
          className="btn-outline px-3 py-2.5 rounded-sm text-xs flex items-center gap-1.5"
          style={{
            borderColor: showWindowForm ? 'rgba(96,165,250,0.4)' : undefined,
            color:        showWindowForm ? '#60a5fa'              : undefined,
          }}
          title="Declare availability window">
          <Calendar size={12} />
        </motion.button>
      </div>

      {/* Window declaration form */}
      <AnimatePresence>
        {showWindowForm && <WindowForm onDone={() => setShowWindowForm(false)} />}
      </AnimatePresence>
    </motion.div>
  )
}
