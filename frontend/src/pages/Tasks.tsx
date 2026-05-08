import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp, AlertOctagon, Clock, Flag, Plus, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { getAllTasks, createTask, updateTaskProgress, type Task } from '../services/tasks.service'
import { useAuthStore } from '../store/authStore'
import { extractErrorMessage } from '../services/error'

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

export default function Tasks() {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [interns, setInterns] = useState<InternRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter]   = useState<'all' | 'stale' | 'blocked'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', internId: '', complexity: '3', status: 'backlog', planeTaskId: '' })
  const [creating, setCreating]   = useState(false)
  const [createError, setCreateError] = useState('')
  const isAdmin = useAuthStore(s => s.isAdmin())

  // Intern progress update state
  const [editingTaskId, setEditingTaskId]   = useState<string | null>(null)
  const [progressInput, setProgressInput]   = useState<number>(0)
  const [noteInput, setNoteInput]           = useState('')
  const [hasBlockerInput, setHasBlockerInput] = useState(false)
  const [blockerTypeInput, setBlockerTypeInput] = useState('')
  const [updating, setUpdating]             = useState(false)
  const [updateError, setUpdateError]       = useState('')
  const [updateSuccess, setUpdateSuccess]   = useState('')

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [tasksData, overviewData] = await Promise.all([
        getAllTasks(),
        isAdmin ? getAdminOverview() : Promise.resolve({ interns: [] })
      ])
      setTasks(tasksData)
      if (isAdmin && 'interns' in overviewData) {
        setInterns(overviewData.interns)
      }
      setError('')
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load task data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchData() }, [isAdmin])

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
      setNewTask({ title: '', internId: '', complexity: '3', status: 'backlog', planeTaskId: '' })
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
    setUpdateSuccess('')
  }

  const handleProgressUpdate = async (taskId: string) => {
    setUpdating(true)
    setUpdateError('')
    setUpdateSuccess('')
    try {
      await updateTaskProgress(taskId, {
        progressPct:  progressInput,
        note:         noteInput || undefined,
        hasBlocker:   hasBlockerInput,
        blockerType:  hasBlockerInput && blockerTypeInput ? blockerTypeInput : null,
      })
      setUpdateSuccess('Progress updated!')
      setEditingTaskId(null)
      await fetchData()
    } catch (err: unknown) {
      setUpdateError(extractErrorMessage(err, 'Failed to update progress.'))
    } finally {
      setUpdating(false)
    }
  }

    filter === 'all'     ? true :
    filter === 'stale'   ? t.isStale :
    !!(t.blocker ?? t.hasBlocker)
  )

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">
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
              {isAdmin && (
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
                        onClick={() => setExpanded(isOpen ? null : task.id)}>
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
                            {task.note && (
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
                                  <p className="font-body text-sm text-red-300/80">
                                    Blocker: <strong>{task.blocker ?? task.blockerType ?? 'Unspecified'}</strong>
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Intern progress update panel */}
                            {!isAdmin && task.status !== 'completed' && (
                              <div className="px-5 pb-5" style={{ borderTop: '1px solid rgba(201,168,76,0.08)' }}>
                                {editingTaskId === task.id ? (
                                  <div className="pt-4 space-y-4">
                                    <p className="nav-label text-[0.55rem] text-gold/50 mb-1">UPDATE PROGRESS</p>
                                    <div>
                                      <div className="flex justify-between mb-1">
                                        <label className="nav-label text-[0.55rem] text-ice/40">PROGRESS</label>
                                        <span className="nav-label text-[0.55rem] text-gold">{progressInput}%</span>
                                      </div>
                                      <input type="range" min={0} max={99} step={1}
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
                                      <button type="button" onClick={() => setHasBlockerInput(b => !b)}
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
                                          <option value="">Blocker type...</option>
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
