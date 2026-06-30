import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, AlertTriangle, Loader2, ChevronLeft, ChevronRight, Filter, X } from 'lucide-react'
import Sidebar from '../../components/Sidebar'
import Starfield from '../../components/Starfield'
import { getAuditLogs, type AuditLog, type AuditLogFilters } from '../../services/auditLog.service'
import { extractErrorMessage } from '../../services/error'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  // Auth
  'LOGIN', 'REGISTER', 'LOGOUT',
  // Tasks
  'CREATE_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'ASSIGN_TASK', 'INTERN_UPDATE_TASK',
  // Scores & Reviews
  'OVERRIDE_SCORE', 'SUBMIT_REVIEW',
  // Alerts
  'RESOLVE_ALERT',
  // User lifecycle
  'APPROVE_USER', 'REJECT_USER', 'FINISH_INTERNSHIP', 'DELETE_INTERN', 'UPDATE_INTERN',
  'DEACTIVATE_USER', 'ARCHIVE_USER', 'RESTORE_USER', 'MARK_USER_REMOVED',
  // Roles & Permissions
  'CHANGE_USER_ROLE', 'UPDATE_ACCESS_MATRIX',
  // Governance & Approvals
  'REQUEST_APPROVAL', 'APPROVE_ACTION', 'REJECT_ACTION', 'CANCEL_APPROVAL', 'EXECUTE_APPROVED_ACTION',
  // Security
  'BLOCK_IP', 'UNBLOCK_IP',
  // Config
  'SET_AVAILABILITY_DEADLINE',
  // Profile & Password
  'PROFILE_UPDATE', 'PASSWORD_CHANGED', 'PASSWORD_RESET',
  // Workflow
  'ADD_TASK_NOTE', 'UPDATE_TASK_NOTE', 'DELETE_TASK_NOTE',
  'RAISE_ESCALATION', 'ACKNOWLEDGE_ESCALATION', 'RESOLVE_ESCALATION',
  'ADD_TASK_COLLABORATOR', 'REMOVE_TASK_COLLABORATOR', 'ADD_TASK_OBSERVER', 'REMOVE_TASK_OBSERVER',
  // Support
  'CREATE_SUPPORT_REQUEST', 'ASSIGN_SUPPORT_REQUEST', 'UPDATE_SUPPORT_REQUEST_STATUS',
  // Virtual Presence
  'CHECK_IN', 'CHECK_OUT', 'DECLARE_WINDOW',
  // Access denied
  'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS',
]

const ENTITY_OPTIONS = ['USER', 'TASK', 'SCORE', 'REVIEW', 'ALERT', 'APPROVAL', 'CONFIG', 'INTERN', 'SUPPORT', 'PRESENCE', 'SYSTEM']

const ACTION_COLORS: Record<string, string> = {
  // Auth — green
  LOGIN:    '#4ade80',
  REGISTER: '#4ade80',
  LOGOUT:   '#b8d4f0',
  // Tasks — gold
  CREATE_TASK:        '#c9a84c',
  UPDATE_TASK:        '#c9a84c',
  DELETE_TASK:        '#f87171',
  ASSIGN_TASK:        '#e2c76e',
  INTERN_UPDATE_TASK: '#c9a84c',
  // Scores & Reviews — purple
  OVERRIDE_SCORE: '#f59e0b',
  SUBMIT_REVIEW:  '#a78bfa',
  // Alerts
  RESOLVE_ALERT: '#34d399',
  // User lifecycle — red/amber
  APPROVE_USER:      '#4ade80',
  REJECT_USER:       '#f87171',
  FINISH_INTERNSHIP: '#f59e0b',
  DELETE_INTERN:     '#f87171',
  UPDATE_INTERN:     '#c9a84c',
  DEACTIVATE_USER:   '#f59e0b',
  ARCHIVE_USER:      '#f87171',
  RESTORE_USER:      '#4ade80',
  MARK_USER_REMOVED: '#f87171',
  // Roles & Permissions — blue
  CHANGE_USER_ROLE:    '#60a5fa',
  UPDATE_ACCESS_MATRIX:'#60a5fa',
  // Governance — blue
  REQUEST_APPROVAL:        '#60a5fa',
  APPROVE_ACTION:          '#4ade80',
  REJECT_ACTION:           '#f87171',
  CANCEL_APPROVAL:         '#b8d4f0',
  EXECUTE_APPROVED_ACTION: '#4ade80',
  // Security — red
  BLOCK_IP:   '#f87171',
  UNBLOCK_IP: '#4ade80',
  // Config
  SET_AVAILABILITY_DEADLINE: '#c9a84c',
  // Profile
  PROFILE_UPDATE:   '#b8d4f0',
  PASSWORD_CHANGED: '#f59e0b',
  PASSWORD_RESET:   '#f59e0b',
  // Workflow
  ADD_TASK_NOTE:    '#b8d4f0',
  RAISE_ESCALATION: '#f59e0b',
  RESOLVE_ESCALATION: '#4ade80',
  // Access denied — red
  PERMISSION_DENIED:   '#f87171',
  UNAUTHORIZED_ACCESS: '#f87171',
  // Virtual Presence — cyan/teal
  CHECK_IN:       '#34d399',
  CHECK_OUT:      '#60a5fa',
  DECLARE_WINDOW: '#a78bfa',
}

const PAGE_SIZE = 25

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? '#b8d4f0'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogs() {
  const [logs, setLogs]       = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [total, setTotal]     = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [emailFilter, setEmailFilter]   = useState('')
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [page, setPage]                 = useState(1)
  const [expanded, setExpanded]         = useState<string | null>(null)

  const fetchLogs = useCallback(async (filters: AuditLogFilters): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const { logs: data, meta } = await getAuditLogs(filters)
      setLogs(data)
      setTotal(meta.total)
      setTotalPages(meta.totalPages)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load audit logs.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchLogs({
      action: actionFilter || undefined,
      entity: entityFilter || undefined,
      email:  emailFilter  || undefined,
      from:   fromDate     || undefined,
      to:     toDate       || undefined,
      page,
      limit:  PAGE_SIZE,
    })
  }, [fetchLogs, actionFilter, entityFilter, emailFilter, fromDate, toDate, page])

  const clearFilters = (): void => {
    setActionFilter('')
    setEntityFilter('')
    setEmailFilter('')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  const hasFilters = !!(actionFilter || entityFilter || emailFilter || fromDate || toDate)

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />

      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">ADMIN · TRACEABILITY</p>
              <h1 className="font-display font-black text-3xl text-ice-gradient">Audit Logs</h1>
              <div className="gold-rule w-14 mt-2" />
            </div>
            <div className="flex items-center gap-3">
              <div className="signal-badge">
                <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
                <span className="nav-label text-[0.6rem] text-ice/50">{total} RECORDS</span>
              </div>
            </div>
          </motion.div>

          {/* Filters */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-sm p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={12} className="text-gold/50" />
              <span className="nav-label text-[0.6rem] text-gold/50">FILTERS</span>
              {hasFilters && (
                <motion.button whileTap={{ scale: 0.95 }} onClick={clearFilters}
                  className="ml-auto flex items-center gap-1 nav-label text-[0.55rem] text-ice/40 hover:text-red-400 transition-colors">
                  <X size={10} />CLEAR
                </motion.button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Action filter */}
              <div>
                <label className="nav-label text-[0.55rem] text-gold/40 block mb-1.5">ACTION</label>
                <select className="uris-input text-sm" value={actionFilter}
                  onChange={e => { setActionFilter(e.target.value); setPage(1) }}>
                  <option value="">All actions</option>
                  {ACTION_OPTIONS.map(a => (
                    <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Entity filter */}
              <div>
                <label className="nav-label text-[0.55rem] text-gold/40 block mb-1.5">ENTITY</label>
                <select className="uris-input text-sm" value={entityFilter}
                  onChange={e => { setEntityFilter(e.target.value); setPage(1) }}>
                  <option value="">All entities</option>
                  {ENTITY_OPTIONS.map(e => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>

              {/* Email filter */}
              <div>
                <label className="nav-label text-[0.55rem] text-gold/40 block mb-1.5">ACTOR EMAIL</label>
                <input type="text" className="uris-input text-sm" placeholder="Search by email..."
                  value={emailFilter}
                  onChange={e => { setEmailFilter(e.target.value); setPage(1) }} />
              </div>

              {/* From date */}
              <div>
                <label className="nav-label text-[0.55rem] text-gold/40 block mb-1.5">FROM DATE</label>
                <input type="date" className="uris-input text-sm" value={fromDate}
                  onChange={e => { setFromDate(e.target.value); setPage(1) }} />
              </div>

              {/* To date */}
              <div>
                <label className="nav-label text-[0.55rem] text-gold/40 block mb-1.5">TO DATE</label>
                <input type="date" className="uris-input text-sm" value={toDate}
                  onChange={e => { setToDate(e.target.value); setPage(1) }} />
              </div>
            </div>
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
          {!loading && !error && logs.length === 0 && (
            <div className="glass-card rounded-sm p-10 text-center">
              <FileText size={28} className="text-gold/20 mx-auto mb-3" />
              <p className="font-body text-sm text-ice/30">No audit logs match the current filters.</p>
            </div>
          )}

          {/* Table */}
          {!loading && !error && logs.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }} className="glass-card rounded-sm">

              {/* Table header */}
              <div className="px-6 py-3 grid grid-cols-12 gap-4"
                style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
                {[
                  { label: 'ACTION',    cols: 'col-span-3' },
                  { label: 'ENTITY',    cols: 'col-span-2' },
                  { label: 'USER',      cols: 'col-span-3' },
                  { label: 'TIMESTAMP', cols: 'col-span-3' },
                  { label: '',          cols: 'col-span-1' },
                ].map(h => (
                  <div key={h.label} className={`${h.cols}`}>
                    <span className="nav-label text-[0.5rem] text-gold/40">{h.label}</span>
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="divide-y divide-gold/5">
                <AnimatePresence>
                  {logs.map((log, i) => {
                    const { date, time } = formatTimestamp(log.createdAt)
                    const color          = actionColor(log.action)
                    const isOpen         = expanded === log.id

                    return (
                      <motion.div key={log.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}>

                        {/* Main row */}
                        <button
                          onClick={() => setExpanded(isOpen ? null : log.id)}
                          className="w-full px-6 py-3.5 grid grid-cols-12 gap-4 items-center text-left
                            hover:bg-white/[0.02] transition-colors">

                          {/* Action badge */}
                          <div className="col-span-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: color }} />
                            <span className="nav-label text-[0.6rem] px-2 py-0.5 rounded-sm"
                              style={{ background: `${color}15`, color }}>
                              {log.action}
                            </span>
                          </div>

                          {/* Entity */}
                          <div className="col-span-2">
                            <span className="nav-label text-[0.6rem] text-ice/50">{log.entity}</span>
                            {log.entityId && (
                              <p className="font-mono text-[0.5rem] text-ice/25 truncate mt-0.5">
                                {log.entityId.slice(0, 8)}…
                              </p>
                            )}
                          </div>

                          {/* User */}
                          <div className="col-span-3">
                            {log.userEmail ? (
                              <>
                                <span className="font-body text-xs text-frost/80 truncate block font-medium">
                                  {log.userDisplayName || log.userEmail.split('@')[0]}
                                </span>
                                <span className="font-mono text-[0.5rem] text-ice/35 truncate block">
                                  {log.userEmail}
                                </span>
                              </>
                            ) : (
                              <span className="font-mono text-xs text-ice/30">system</span>
                            )}
                          </div>

                          {/* Timestamp */}
                          <div className="col-span-3">
                            <p className="font-body text-xs text-frost/70">{date}</p>
                            <p className="font-mono text-[0.55rem] text-ice/35 mt-0.5">{time}</p>
                          </div>

                          {/* Expand chevron */}
                          <div className="col-span-1 flex justify-end">
                            <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronRight size={12} className="text-ice/25" style={{ transform: 'rotate(90deg)' }} />
                            </motion.div>
                          </div>
                        </button>

                        {/* Expanded metadata */}
                        <AnimatePresence>
                          {isOpen && log.metadata && Object.keys(log.metadata).length > 0 && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              style={{ overflow: 'hidden', borderTop: '1px solid rgba(201,168,76,0.06)' }}>
                              <div className="px-6 py-4 ml-6">
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-2">METADATA</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                  {Object.entries(log.metadata).map(([key, val]) => (
                                    <div key={key}>
                                      <p className="nav-label text-[0.5rem] text-ice/30 mb-0.5">
                                        {key.replace(/([A-Z])/g, ' $1').toUpperCase()}
                                      </p>
                                      <p className="font-mono text-xs text-frost/60 break-all">
                                        {val === null || val === undefined
                                          ? '—'
                                          : typeof val === 'object'
                                            ? JSON.stringify(val)
                                            : String(val)}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4"
                  style={{ borderTop: '1px solid rgba(201,168,76,0.1)' }}>
                  <span className="nav-label text-[0.55rem] text-ice/30">
                    PAGE {page} OF {totalPages} · {total} RECORDS
                  </span>
                  <div className="flex items-center gap-2">
                    <motion.button whileTap={{ scale: 0.95 }}
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="w-7 h-7 rounded-sm flex items-center justify-center transition-colors disabled:opacity-30"
                      style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
                      <ChevronLeft size={12} className="text-gold" />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.95 }}
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="w-7 h-7 rounded-sm flex items-center justify-center transition-colors disabled:opacity-30"
                      style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
                      <ChevronRight size={12} className="text-gold" />
                    </motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  )
}
