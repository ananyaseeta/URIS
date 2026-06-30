import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, AlertOctagon, Clock, Flag, Plus, X, Loader2, AlertTriangle, CheckCircle2, Pause, Play, ShieldAlert, Star, Trash2 } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getAllTasks, createTask, updateTaskProgress, adminControlTask, getReviewForTask, deleteTask, type Task, type TaskReview } from '../services/tasks.service'
import { useAuthStore, selectUser } from '../store/authStore'
import { getPermissions } from '../utils/permissions'
import { extractErrorMessage } from '../services/error'

import TaskWorkflowPanel from '../components/TaskWorkflowPanel'
import TaskCollaborationPanel from '../components/TaskCollaborationPanel'
import { getAdminOverview, type InternRow } from '../services/dashboard.service'

const SKILL_COLORS: Record<string, string> = {
  Frontend: '#b8d4f0', Backend: '#c9a84c', DevOps: '#4ade80',
  Testing: '#a78bfa', Documentation: '#f87171', 'AI/ML': '#fb923c', Research: '#34d399',
}

function statusPct(s: string): number {
  if (s === 'backlog' || s === 'not_started') return 0
  if (s === 'in_progress_early') return 25
  if (s === 'in_progress_mid') return 50
  if (s === 'under_review') return 75
  if (s === 'completed') return 100
  if (typeof s === 'number') return s as unknown as number
  return 0
}

function formatHoursRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  const mins = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours <= 0) return `${remMins}m`;
  if (remMins === 0) return `${hours}h`;
  return `${hours}h ${remMins}m`;
}


export default function Tasks() {
  const [searchParams] = useSearchParams()
  // FIX 1: read ?internId= from URL — Dashboard "View Tasks" shortcut pre-sets this.
  // When present, the task list is automatically filtered to that intern's tasks.
  const internIdParam = searchParams.get('internId')

  const [tasks, setTasks]     = useState<Task[]>([])
  const [interns, setInterns] = useState<InternRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter]   = useState<'all' | 'stale' | 'blocked'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', internId: '', complexity: '3', status: 'backlog', planeTaskId: '', description: '' })
  const [creating, setCreating]   = useState(false)
  const [createError, setCreateError] = useState('')
  const user = useAuthStore(selectUser)
  const permissions = getPermissions(user?.role || '')

  // Intern progress update state
  const [editingTaskId, setEditingTaskId]   = useState<string | null>(null)
  const [progressInput, setProgressInput]   = useState<number>(0)
  const [noteInput, setNoteInput]           = useState('')
  const [hasBlockerInput, setHasBlockerInput] = useState(false)
  const [blockerTypeInput, setBlockerTypeInput] = useState('')
  const [updating, setUpdating]             = useState(false)
  const [updateError, setUpdateError]       = useState('')

  // Admin task control state
  const [adminControlTaskId, setAdminControlTaskId] = useState<string | null>(null)
  const [adminAction, setAdminAction]               = useState<'pause' | 'block' | null>(null)
  const [adminReason, setAdminReason]               = useState('')
  const [adminBlockerType, setAdminBlockerType]     = useState('')
  const [adminControlling, setAdminControlling]     = useState(false)
  const [adminControlError, setAdminControlError]   = useState('')

  // Review state — cache fetched reviews by taskId
  const [reviews, setReviews]         = useState<Record<string, TaskReview | null>>({})
  const [loadingReview, setLoadingReview] = useState<string | null>(null)

  const fetchReview = async (taskId: string) => {
    if (reviews[taskId] !== undefined) return  // already fetched
    setLoadingReview(taskId)
    try {
      const review = await getReviewForTask(taskId)
      setReviews(prev => ({ ...prev, [taskId]: review }))
    } catch {
      setReviews(prev => ({ ...prev, [taskId]: null }))
    } finally {
      setLoadingReview(null)
    }
  }

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [tasksData, overviewData] = await Promise.all([
        getAllTasks(),
        permissions.canAssign !== 'NO' ? getAdminOverview() : Promise.resolve({ interns: [] })
      ])
      setTasks(tasksData)
      if (permissions.canAssign !== 'NO' && 'interns' in overviewData) {
        setInterns(overviewData.interns)
      }
      setError('')
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load task data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchData() }, [permissions.canAssign])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const complexity = parseFloat(newTask.complexity)
      if (!Number.isInteger(complexity) || complexity < 1 || complexity > 5) throw new Error('Complexity must be an integer between 1 and 5')
      if (!newTask.internId) throw new Error('Please select an intern')
      await createTask({ ...newTask, complexity })
      setShowCreate(false)
      setNewTask({ title: '', internId: '', complexity: '3', status: 'backlog', planeTaskId: '', description: '' })
      await fetchData()
    } catch (err: unknown) {
      setCreateError(extractErrorMessage(err, 'Failed to create task.'))
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (task: Task) => {
    setEditingTaskId(task.id)
    setProgressInput(task.progressPct ?? task.progress ?? 0)
    setNoteInput('')
    setHasBlockerInput(task.hasBlocker ?? false)
    setBlockerTypeInput(task.blockerType ?? '')
    setUpdateError('')
  }

  const handleProgressUpdate = async (taskId: string) => {
    setUpdating(true)
    setUpdateError('')
    try {
      await updateTaskProgress(taskId, {
        progressPct:  progressInput,
        note:         noteInput || undefined,
        hasBlocker:   hasBlockerInput,
        blockerType:  hasBlockerInput && blockerTypeInput && blockerTypeInput !== 'none'
                        ? blockerTypeInput
                        : undefined,
      })
      setEditingTaskId(null)
      await fetchData()
    } catch (err: unknown) {
      setUpdateError(extractErrorMessage(err, 'Failed to update progress.'))
    } finally {
      setUpdating(false)
    }
  }

  const handleAdminControl = async (taskId: string, action: 'pause' | 'block' | 'resume' | 'unblock') => {
    setAdminControlling(true)
    setAdminControlError('')
    try {
      if (action === 'resume') {
        await adminControlTask({ taskId, status: 'active' })
      } else if (action === 'unblock') {
        await adminControlTask({ taskId, status: 'active', hasBlocker: false })
      } else if (action === 'pause') {
        await adminControlTask({ taskId, status: 'paused', pauseReason: adminReason || 'Admin paused' })
      } else if (action === 'block') {
        await adminControlTask({
          taskId,
          status:      'active',
          hasBlocker:  true,
          blockerType: adminBlockerType || 'none',
          pauseReason: adminReason || undefined,
        })
      }
      setAdminControlTaskId(null)
      setAdminAction(null)
      setAdminReason('')
      setAdminBlockerType('')
      await fetchData()
    } catch (err: unknown) {
      setAdminControlError(extractErrorMessage(err, 'Failed to update task.'))
    } finally {
      setAdminControlling(false)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to remove this task? This will not affect any person\'s score or calculations.')) return
    try {
      await deleteTask(taskId)
      await fetchData()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to delete task.'))
    }
  }

  // FIX 1: apply intern filter from URL param first, then status filter
  const filtered = tasks
    .filter(t => !internIdParam || t.internId === internIdParam)
    .filter(t =>
      filter === 'all'     ? true :
      filter === 'stale'   ? t.isStale :
      !!(t.blocker ?? t.hasBlocker)
    )

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8 max-w-7xl mx-auto">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 mb-8">
            <div>
              <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">TASK INTELLIGENCE</p>
              <h1 className="font-display font-black text-3xl text-ice-gradient">Task Monitor</h1>
              <div className="gold-rule w-14 mt-2" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {(['all', 'stale', 'blocked'] as const).map(f => (
                <motion.button key={f} whileTap={{ scale: 0.96 }} onClick={() => setFilter(f)}
                  className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm transition-all duration-200"
                  style={{
                    background: filter === f ? 'rgba(201,168,76,0.15)' : 'transparent',
                    border: `1px solid ${filter === f ? 'rgba(201,168,76,0.4)' : 'rgba(201,168,76,0.12)'}`,
                    color: filter === f ? '#c9a84c' : 'rgba(184,212,240,0.4)',
                  }}>{f.toUpperCase()}</motion.button>
              ))}
              {permissions.canAssign !== 'NO' && (
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setShowCreate(true)}
                  className="btn-gold px-4 py-1.5 rounded-sm flex items-center gap-1.5 text-[0.65rem]">
                  <Plus size={12} />NEW TASK
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

          {/* Error */}
          {!loading && error && (
            <div className="glass-card rounded-sm p-10 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
              <p className="font-body text-sm text-ice/50">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Summary pills */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 md:gap-4 mb-6">
                {[
                  { label: 'Total',     val: tasks.length,                                              c: '#c9a84c' },
                  { label: 'Stale',     val: tasks.filter(t => t.isStale).length,                      c: '#f59e0b' },
                  { label: 'Blocked',   val: tasks.filter(t => t.blocker ?? t.hasBlocker).length,      c: '#f87171' },
                  { label: 'Completed', val: tasks.filter(t => t.status === 'completed').length,        c: '#4ade80' },
                ].map(p => (
                  <motion.div key={p.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 px-4 py-2 rounded-sm"
                    style={{ background: `${p.c}0d`, border: `1px solid ${p.c}25` }}>
                    <span className="font-display font-black text-lg" style={{ color: p.c }}>{p.val}</span>
                    <span className="nav-label text-[0.55rem] text-ice/40">{p.label}</span>
                  </motion.div>
                ))}
              </div>

              {/* Empty state */}
              {filtered.length === 0 && (
                <div className="glass-card rounded-sm p-10 text-center">
                  <p className="font-body text-sm text-ice/30">No tasks match this filter.</p>
                </div>
              )}

              {/* Task list */}
              <div className="space-y-3">
                {filtered.map((task, i) => {
                  const pct = statusPct(task.status)
                  const isOpen = expanded === task.id
                  const isOverdue = task.deadline ? task.deadline < new Date().toISOString().split('T')[0] : false
                  const skill = task.skill ?? (task.skills?.[0]) ?? 'Backend'
                  const hasBlocker = !!(task.blocker ?? task.hasBlocker)

                  return (
                    <motion.div key={task.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }} className="glass-card rounded-sm overflow-hidden"
                      style={{ borderColor: task.isStale ? 'rgba(245,158,11,0.25)' : hasBlocker ? 'rgba(248,113,113,0.2)' : undefined }}>
                      <motion.button className="w-full flex items-center gap-4 px-5 py-4 text-left"
                        onClick={() => {
                          const next = isOpen ? null : task.id
                          setExpanded(next)
                          // Fetch review when expanding a completed task
                          if (task.status === 'completed' && next) {
                            void fetchReview(task.id)
                          }
                        }}>
                        {/* Radial progress */}
                        <div className="relative flex-shrink-0 w-9 h-9">
                          <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
                            <motion.circle cx="18" cy="18" r="15" fill="none"
                              stroke={pct === 100 ? '#4ade80' : '#c9a84c'} strokeWidth="2.5"
                              strokeDasharray={`${2 * Math.PI * 15}`}
                              initial={{ strokeDashoffset: 2 * Math.PI * 15 }}
                              animate={{ strokeDashoffset: 2 * Math.PI * 15 * (1 - pct / 100) }}
                              transition={{ duration: 1, delay: i * 0.1 + 0.2 }} strokeLinecap="round" />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center font-ui font-bold text-[0.55rem] text-ice/60">{pct}%</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[0.6rem] text-gold/40">{task.id ?? task.planeTaskId}</span>
                            <span className="nav-label text-[0.5rem] px-1.5 py-0.5 rounded-sm"
                              style={{ background: `${SKILL_COLORS[skill] ?? '#c9a84c'}15`, color: SKILL_COLORS[skill] ?? '#c9a84c' }}>
                              {skill.toUpperCase()}
                            </span>
                            {task.isStale && <span className="nav-label text-[0.5rem] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-sm flex items-center gap-1"><Clock size={8} />STALE</span>}
                            {task.isStale && task.deadline && (
                              (() => {
                                const now = Date.now()
                                const deadlineMs = new Date(task.deadline).getTime() - now
                                const within48h = deadlineMs <= 48 * 60 * 60 * 1000 && deadlineMs > 0
                                const within24h = deadlineMs <= 24 * 60 * 60 * 1000 && deadlineMs > 0
                                const color = within24h ? '#f87171' : within48h ? '#f59e0b' : 'rgba(184,212,240,0.3)'
                                const bg = within24h
                                  ? 'rgba(248,113,113,0.12)'
                                  : within48h
                                    ? 'rgba(245,158,11,0.12)'
                                    : 'rgba(184,212,240,0.08)'

                                return (
                                  <span className="nav-label text-[0.5rem] px-1.5 py-0.5 rounded-sm flex items-center gap-1"
                                    style={{ background: bg, color, border: `1px solid ${within24h ? 'rgba(248,113,113,0.25)' : within48h ? 'rgba(245,158,11,0.25)' : 'rgba(184,212,240,0.12)'}` }}>
                                    <Clock size={8} />ESCALATES {formatHoursRemaining(deadlineMs)}
                                  </span>
                                )
                              })()
                            )}
                            {hasBlocker && <span className="nav-label text-[0.5rem] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-sm flex items-center gap-1"><Flag size={8} />BLOCKED</span>}
                          </div>
                          <p className="font-body text-sm text-frost/85 truncate">{task.title}</p>
                        </div>

                        <div className="flex-shrink-0 text-right hidden lg:block">
                          <p className="nav-label text-[0.55rem] text-ice/40">{(task.assignee ?? '').split(' ')[0]}</p>
                          <p className="nav-label text-[0.5rem]" style={{ color: isOverdue ? '#f87171' : 'rgba(184,212,240,0.3)' }}>
                            {isOverdue ? 'OVERDUE' : task.deadline ?? '—'}
                          </p>
                        </div>
                        <div className="flex-shrink-0 ml-2 text-ice/30">
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </motion.button>

                      <AnimatePresence>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                            style={{ borderTop: '1px solid rgba(201,168,76,0.08)', overflow: 'hidden' }}>
                            <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-5">
                              <div>
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-1">ASSIGNEE</p>
                                <p className="font-body text-sm text-frost/80">{task.assignee ?? '—'}</p>
                              </div>
                              <div>
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-1">STATUS</p>
                                <p className="font-body text-sm text-frost/80">{task.status?.replace(/_/g, ' ')}</p>
                              </div>
                              <div>
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-1">COMPLEXITY</p>
                                <div className="flex gap-0.5 mt-1">
                                  {[0.2, 0.4, 0.6, 0.8, 1.0].map(n => (
                                    <div key={n} className="w-3 h-3 rounded-sm"
                                      style={{ background: n <= task.complexity ? 'rgba(201,168,76,0.7)' : 'rgba(255,255,255,0.06)' }} />
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-1">DEADLINE</p>
                                <p className="font-body text-sm" style={{ color: isOverdue ? '#f87171' : 'rgba(232,240,251,0.6)' }}>
                                  {task.deadline ?? '—'}
                                </p>
                              </div>
                            </div>
                            {permissions.canSeeNotes && task.note && (
                              <div className="px-5 pb-4">
                                <p className="nav-label text-[0.5rem] text-gold/40 mb-2">PROGRESS NOTE</p>
                                <p className="font-body text-sm text-ice/50 italic">"{task.note}"</p>
                              </div>
                            )}
                            {hasBlocker && (
                              <div className="px-5 pb-4">
                                <div className="flex items-center gap-2 p-3 rounded-sm"
                                  style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)' }}>
                                  <AlertOctagon size={13} className="text-red-400 flex-shrink-0" />
                                  <div>
                                    <p className="font-body text-sm text-red-300/80">
                                      <strong>Blocked</strong>
                                      {(task.blockerType) && (
                                        <span className="ml-2 nav-label text-[0.55rem] px-2 py-0.5 rounded-sm"
                                          style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
                                          {task.blockerType.replace(/_/g, ' ').toUpperCase()}
                                        </span>
                                      )}
                                    </p>
                                    {task.note && (
                                      <p className="font-body text-xs text-red-300/60 mt-1 italic">"{task.note}"</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {task.status === 'paused' && (
                              <div className="px-5 pb-4">
                                <div className="flex items-center gap-2 p-3 rounded-sm"
                                  style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                  <Pause size={13} className="text-amber-400 flex-shrink-0" />
                                  <p className="font-body text-sm text-amber-300/80">
                                    <strong>Task paused by admin</strong>
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Workflow panel — notes, escalations, timeline */}
                            <div className="px-5 pb-2">
                              <TaskWorkflowPanel
                                taskId={task.id}
                                isAdmin={permissions.canAssign !== 'NO'}
                              />
                            </div>

                            {/* Collaboration panel — description, collaborator teams, observers */}
                            <TaskCollaborationPanel
                              taskId={task.id}
                              description={task.description}
                              isAdmin={permissions.canAssign !== 'NO'}
                            />

                            {/* Admin controls panel */}
                            {permissions.canAssign !== 'NO' && task.status !== 'completed' && (
                              <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}>
                                {adminControlTaskId === task.id ? (
                                  <div className="pt-4 space-y-3">
                                    <p className="nav-label text-[0.55rem] text-gold/50">
                                      {adminAction === 'pause' ? 'PAUSE TASK' : 'FLAG BLOCKER'}
                                    </p>
                                    {adminAction === 'block' && (
                                      <select value={adminBlockerType} onChange={e => setAdminBlockerType(e.target.value)}
                                        className="uris-input text-xs w-full">
                                        <option value="none">None / General blocker</option>
                                        {['code_review','manager_approval','api_access','dependency','unclear_req'].map(b => (
                                          <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>
                                        ))}
                                      </select>
                                    )}
                                    <textarea rows={2} maxLength={280}
                                      placeholder={adminAction === 'pause' ? 'Reason for pausing...' : 'Describe the blocker...'}
                                      value={adminReason} onChange={e => setAdminReason(e.target.value)}
                                      className="uris-input w-full resize-none text-sm" style={{ minHeight: '56px' }} />
                                    {adminControlError && (
                                      <p className="font-body text-xs text-red-400/80 py-1.5 px-3 rounded-sm"
                                        style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                                        {adminControlError}
                                      </p>
                                    )}
                                    <div className="flex gap-2">
                                      <motion.button whileTap={{ scale: 0.97 }} disabled={adminControlling}
                                        onClick={() => handleAdminControl(task.id, adminAction!)}
                                        className="btn-gold flex-1 py-2 rounded-sm text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        {adminControlling ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                        {adminControlling ? 'SAVING...' : 'CONFIRM'}
                                      </motion.button>
                                      <motion.button whileTap={{ scale: 0.97 }}
                                        onClick={() => { setAdminControlTaskId(null); setAdminAction(null); setAdminReason(''); setAdminBlockerType(''); setAdminControlError('') }}
                                        className="btn-outline px-4 rounded-sm text-xs">CANCEL</motion.button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="pt-4 flex flex-wrap gap-2">
                                    {task.status === 'paused' ? (
                                      <motion.button whileTap={{ scale: 0.97 }}
                                        onClick={() => handleAdminControl(task.id, 'resume')}
                                        className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-all"
                                        style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}>
                                        <Play size={9} />RESUME TASK
                                      </motion.button>
                                    ) : (
                                      <motion.button whileTap={{ scale: 0.97 }}
                                        onClick={() => { setAdminControlTaskId(task.id); setAdminAction('pause'); setAdminControlError('') }}
                                        className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-all"
                                        style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
                                        <Pause size={9} />PAUSE TASK
                                      </motion.button>
                                    )}
                                    {hasBlocker ? (
                                      <motion.button whileTap={{ scale: 0.97 }}
                                        onClick={() => handleAdminControl(task.id, 'unblock')}
                                        className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-all"
                                        style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80' }}>
                                        <ShieldAlert size={9} />CLEAR BLOCKER
                                      </motion.button>
                                    ) : (
                                      <motion.button whileTap={{ scale: 0.97 }}
                                        onClick={() => { setAdminControlTaskId(task.id); setAdminAction('block'); setAdminControlError('') }}
                                        className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-all"
                                        style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
                                        <Flag size={9} />FLAG BLOCKER
                                      </motion.button>
                                    )}
                                    <motion.button whileTap={{ scale: 0.97 }}
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="nav-label text-[0.6rem] px-3 py-1.5 rounded-sm flex items-center gap-1.5 transition-all ml-auto"
                                      style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
                                      <Trash2 size={9} />REMOVE TASK
                                    </motion.button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Intern progress update panel */}
                            {permissions.canSeeDetailedTask === 'OWN_TASKS' && task.status !== 'completed' && (
                              <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}>
                                {editingTaskId === task.id ? (
                                  <div className="pt-4 space-y-4">
                                    <p className="nav-label text-[0.55rem] text-gold/50 mb-1">UPDATE PROGRESS</p>
                                    <div>
                                      <div className="flex justify-between mb-1">
                                        <label className="nav-label text-[0.55rem] text-ice/40">PROGRESS</label>
                                        <span className="nav-label text-[0.55rem] text-gold">{progressInput}%</span>
                                      </div>
                                      <input type="range" min={0} max={100} step={1}
                                        value={progressInput}
                                        onChange={e => setProgressInput(Number(e.target.value))}
                                        className="w-full h-1 rounded-full cursor-pointer" style={{ accentColor: '#c9a84c' }} />
                                    </div>
                                    <div>
                                      <label className="nav-label text-[0.55rem] text-ice/40 block mb-1">NOTE (OPTIONAL)</label>
                                      <textarea rows={2} maxLength={280} placeholder="What did you work on?"
                                        value={noteInput} onChange={e => setNoteInput(e.target.value)}
                                        className="uris-input w-full resize-none text-sm" style={{ minHeight: '60px' }} />
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button type="button" onClick={() => {
                                          setHasBlockerInput(b => !b)
                                          setBlockerTypeInput('')
                                        }}
                                        className="nav-label text-[0.55rem] px-3 py-1.5 rounded-sm transition-all"
                                        style={{
                                          background: hasBlockerInput ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.04)',
                                          border: `1px solid ${hasBlockerInput ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.08)'}`,
                                          color: hasBlockerInput ? '#f87171' : 'rgba(184,212,240,0.35)',
                                        }}>
                                        <Flag size={9} className="inline mr-1" />
                                        {hasBlockerInput ? 'BLOCKED' : 'MARK AS BLOCKED'}
                                      </button>
                                      {hasBlockerInput && (
                                        <select value={blockerTypeInput} onChange={e => setBlockerTypeInput(e.target.value)}
                                          className="uris-input text-xs flex-1">
                                          <option value="">Type (optional)...</option>
                                          {['code_review','manager_approval','api_access','dependency','unclear_req'].map(b => (
                                            <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>
                                          ))}
                                        </select>
                                      )}
                                    </div>
                                    {updateError && (
                                      <p className="font-body text-xs text-red-400/80 py-1.5 px-3 rounded-sm"
                                        style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                                        {updateError}
                                      </p>
                                    )}
                                    <div className="flex gap-2 pt-1">
                                      <motion.button whileTap={{ scale: 0.97 }} disabled={updating}
                                        onClick={() => handleProgressUpdate(task.id)}
                                        className="btn-gold flex-1 py-2 rounded-sm text-xs flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        {updating ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                        {updating ? 'SAVING...' : 'SAVE UPDATE'}
                                      </motion.button>
                                      <motion.button whileTap={{ scale: 0.97 }} onClick={() => setEditingTaskId(null)}
                                        className="btn-outline px-4 rounded-sm text-xs">CANCEL</motion.button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="pt-4">
                                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                      onClick={() => openEdit(task)}
                                      className="nav-label text-[0.6rem] px-4 py-2 rounded-sm transition-all"
                                      style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                                      UPDATE PROGRESS
                                    </motion.button>
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Review panel for completed tasks */}
                            {task.status === 'completed' && (
                              <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}>
                                <div className="pt-4">
                                  <p className="nav-label text-[0.55rem] text-gold/40 mb-3">TASK REVIEW</p>
                                  {loadingReview === task.id ? (
                                    <div className="flex items-center gap-2 py-2">
                                      <Loader2 size={13} className="text-gold animate-spin" />
                                      <span className="font-body text-xs text-ice/30">Loading review...</span>
                                    </div>
                                  ) : reviews[task.id] === undefined ? (
                                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                      onClick={() => fetchReview(task.id)}
                                      className="nav-label text-[0.6rem] px-4 py-2 rounded-sm transition-all flex items-center gap-1.5"
                                      style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                                      <Star size={10} />VIEW REVIEW
                                    </motion.button>
                                  ) : reviews[task.id] === null ? (
                                    <p className="font-body text-xs text-ice/30 italic">No review submitted for this task yet.</p>
                                  ) : (
                                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                      className="rounded-sm p-4 space-y-3"
                                      style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)' }}>
                                      {/* PPS score */}
                                      <div className="flex items-center justify-between">
                                        <span className="nav-label text-[0.55rem] text-gold/50">PERFORMANCE SCORE</span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-display font-black text-xl text-gold">
                                            {reviews[task.id]!.pps.toFixed(2)}
                                          </span>
                                          <span className="font-body text-xs text-ice/30">/5</span>
                                        </div>
                                      </div>
                                      {/* Score bars */}
                                      {[
                                        { label: 'QUALITY',     val: reviews[task.id]!.quality,    weight: '40%', c: '#c9a84c' },
                                        { label: 'TIMELINESS',  val: reviews[task.id]!.timeliness, weight: '35%', c: '#b8d4f0' },
                                        { label: 'INITIATIVE',  val: reviews[task.id]!.initiative, weight: '25%', c: '#4ade80' },
                                      ].map(s => (
                                        <div key={s.label}>
                                          <div className="flex justify-between mb-1">
                                            <span className="nav-label text-[0.48rem] text-ice/35">
                                              {s.label} <span className="text-ice/20">({s.weight})</span>
                                            </span>
                                            <span className="nav-label text-[0.5rem]" style={{ color: s.c }}>
                                              {s.val}/5
                                            </span>
                                          </div>
                                          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                            <motion.div
                                              initial={{ width: 0 }}
                                              animate={{ width: `${(s.val / 5) * 100}%` }}
                                              transition={{ duration: 0.8, ease: 'easeOut' }}
                                              className="h-full rounded-full"
                                              style={{ background: s.c }} />
                                          </div>
                                        </div>
                                      ))}
                                      <p className="nav-label text-[0.46rem] text-ice/20 pt-1">
                                        Reviewed {new Date(reviews[task.id]!.createdAt).toLocaleDateString()}
                                      </p>
                                    </motion.div>
                                  )}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )
                })}
              </div>
            </>
          )}

          {/* STEMONEF BRANDING */}
          <div className="mt-12 py-8 flex flex-col items-center gap-4 opacity-40">
            <div className="h-[1px] w-12 bg-gold/20" />
            <span className="font-display font-black text-xs tracking-[0.4em] text-ice-gradient">STEMONEF</span>
            <p className="nav-label text-[0.45rem] tracking-[0.6em] text-ice/30 uppercase">Intelligence Design System</p>
          </div>
        </div>
      </main>

      {/* Create Task Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(7,8,15,0.85)', backdropFilter: 'blur(8px)' }}>
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
              className="glass-card rounded-sm p-8 w-full max-w-md">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="nav-label text-[0.55rem] text-gold/40 mb-0.5">ADMIN ACTION</p>
                  <h2 className="font-display text-xl text-frost">Create New Task</h2>
                </div>
                <button onClick={() => setShowCreate(false)} className="text-ice/30 hover:text-frost transition-colors">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">TASK TITLE</label>
                  <input className="uris-input" placeholder="e.g. Implement credibility analyzer"
                    value={newTask.title} onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))} required />
                </div>
                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">ASSIGN TO INTERN</label>
                  <select className="uris-input" value={newTask.internId}
                    onChange={e => setNewTask(f => ({ ...f, internId: e.target.value }))} required>
                    <option value="">Choose an intern...</option>
                    {interns.map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  {newTask.internId && interns.find(i => i.id === newTask.internId) && (
                    (() => {
                      const intern = interns.find(i => i.id === newTask.internId)!;
                      const isOverloaded = intern.capacityScore < 40 || intern.tli > 5;
                      if (isOverloaded) {
                        return (
                          <div className="mt-2 p-2 rounded-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                            <p className="font-body text-xs text-amber-400/90 flex items-start gap-1.5">
                              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                              <span>
                                <strong>Warning:</strong> This intern is currently overloaded (Capacity: {intern.capacityScore}, TLI: {intern.tli}). They may not be capable of handling this task, but you can still assign it.
                              </span>
                            </p>
                          </div>
                        );
                      }
                      return null;
                    })()
                  )}
                </div>
                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">COMPLEXITY (1–5)</label>
                  <input type="number" min="1" max="5" step="1" className="uris-input"
                    value={newTask.complexity} onChange={e => setNewTask(f => ({ ...f, complexity: e.target.value }))} required />
                </div>
                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">
                    PLANE TASK ID <span className="text-ice/25">(OPTIONAL — LEAVE BLANK IF NOT USING PLANE)</span>
                  </label>
                  <input className="uris-input" placeholder="e.g. plane-task-123 — auto-generated if blank"
                    value={newTask.planeTaskId} onChange={e => setNewTask(f => ({ ...f, planeTaskId: e.target.value }))} />
                </div>
                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">
                    DESCRIPTION <span className="text-ice/25">(OPTIONAL)</span>
                  </label>
                  <textarea rows={3} maxLength={2000} className="uris-input w-full resize-none text-sm"
                    placeholder="Task description, context, or requirements..."
                    value={newTask.description}
                    onChange={e => setNewTask(f => ({ ...f, description: e.target.value }))} />
                </div>
                {createError && (
                  <p className="font-body text-sm text-red-400/80 text-center py-2 rounded-sm"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    {createError}
                  </p>
                )}
                <div className="flex gap-3 pt-2">
                  <motion.button type="submit" disabled={creating} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    className="btn-gold flex-1 py-3 rounded-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {creating && <Loader2 size={13} className="animate-spin" />}
                    {creating ? 'CREATING...' : 'CREATE TASK'}
                  </motion.button>
                  <motion.button type="button" whileHover={{ scale: 1.02 }} onClick={() => setShowCreate(false)}
                    className="btn-outline px-5 rounded-sm">
                    CANCEL
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
