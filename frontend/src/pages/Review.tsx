import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Check, ChevronDown, Loader2, AlertTriangle } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { submitReview } from '../services/review.service'
import { getAllTasks, type Task } from '../services/tasks.service'
import { extractErrorMessage } from '../services/error'
import api from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type RatingKey = 'quality' | 'timeliness' | 'independence'
type Ratings   = Record<RatingKey, number>

interface RatingDim {
  label:  string
  key:    RatingKey
  weight: number
  desc:   string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DIMS: RatingDim[] = [
  { label: 'Quality',      key: 'quality',      weight: 0.40, desc: 'Did the deliverable meet acceptance criteria?' },
  { label: 'Timeliness',   key: 'timeliness',   weight: 0.35, desc: 'Was the task completed on or before deadline?' },
  { label: 'Independence', key: 'independence', weight: 0.25, desc: 'Did the intern work autonomously without guidance?' },
]

const EMPTY_RATINGS: Ratings = { quality: 0, timeliness: 0, independence: 0 }

// ── Component ─────────────────────────────────────────────────────────────────

export default function Review() {
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading]     = useState(true)
  const [tasksError, setTasksError]         = useState('')
  // Track whether any completed tasks exist at all (reviewed or not) so the
  // empty state can distinguish "nothing finished yet" from "all reviewed ✓"
  const [totalCompletedCount, setTotalCompletedCount] = useState(0)

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [ratings, setRatings]           = useState<Ratings>(EMPTY_RATINGS)
  const [note, setNote]                 = useState('')
  const [submitted, setSubmitted]       = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [dropOpen, setDropOpen]         = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        // Fetch all completed tasks and all existing reviews in parallel
        const [all, reviewsRes] = await Promise.all([
          getAllTasks(),
          api.get<{ success: boolean; data: { taskId: string }[] }>('/review/all-task-ids').catch(() => ({ data: { data: [] } })),
        ])

        // Build a set of taskIds that already have a review
        const reviewedTaskIds = new Set(
          (reviewsRes.data.data ?? []).map((r: { taskId: string }) => r.taskId)
        )

        // Only show completed tasks that have NOT been reviewed yet
        const allCompleted = all.filter(t => t.status === 'completed' && !!t.internId)
        setTotalCompletedCount(allCompleted.length)
        setCompletedTasks(
          allCompleted.filter(t => !reviewedTaskIds.has(t.id))
        )
      } catch (err) {
        setTasksError(extractErrorMessage(err, 'Failed to load completed tasks.'))
      } finally {
        setTasksLoading(false)
      }
    }
    void load()
  }, [])

  const pps: number =
    ratings.quality * 0.40 + ratings.timeliness * 0.35 + ratings.independence * 0.25

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!selectedTask) return
    if (Object.values(ratings).some(v => v === 0)) {
      setError('Please rate all three dimensions.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await submitReview({
        internId:          selectedTask.internId ?? '',
        taskId:            selectedTask.id,
        qualityScore:      ratings.quality,
        timelinessScore:   ratings.timeliness,
        independenceScore: ratings.independence,
        reviewNotes:       note || undefined,
      })
      // Remove the reviewed task from the dropdown immediately
      setCompletedTasks(prev => prev.filter(t => t.id !== selectedTask.id))
      setSubmitted(true)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Submission failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const reset = (): void => {
    setSubmitted(false)
    setSelectedTask(null)
    setRatings(EMPTY_RATINGS)
    setNote('')
    setError('')
  }

  const setRating = (key: RatingKey, value: number): void => {
    setRatings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">PERFORMANCE SYSTEM</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Task Review</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm text-ice/40 mt-3">
              Formula: Performance = 0.40 × Quality + 0.35 × Timeliness + 0.25 × Independence
            </p>
          </motion.div>

          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="glass-card rounded-sm p-10 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                  className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)' }}>
                  <Check size={24} className="text-signal" />
                </motion.div>
                <h2 className="font-display text-2xl text-frost mb-2">Review Submitted</h2>
                <p className="font-body text-sm text-ice/40 mb-6">
                  Performance Index has been updated for {selectedTask?.assignee ?? 'the intern'}.
                </p>
                <div className="glass-card rounded-sm p-5 mb-6">
                  <p className="nav-label text-[0.5rem] text-gold/40 mb-2">PERFORMANCE SCORE (PPS)</p>
                  <p className="font-display font-black text-5xl text-gold">{pps.toFixed(2)}</p>
                  <p className="font-body text-xs text-ice/30 mt-1">out of 5.00</p>
                  <div className="progress-bar mt-3">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(pps / 5) * 100}%` }}
                      transition={{ duration: 1, delay: 0.3 }}
                      style={{ height: '100%', background: 'linear-gradient(90deg, #c9a84c88, #c9a84c)', borderRadius: 2 }} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    {DIMS.map(d => (
                      <div key={d.key} className="text-center">
                        <p className="nav-label text-[0.5rem] text-gold/40">{d.label.toUpperCase()}</p>
                        <p className="font-display font-black text-xl text-frost">
                          {ratings[d.key]}<span className="text-ice/30 text-sm">/5</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <motion.button whileHover={{ scale: 1.02 }} onClick={reset} className="btn-outline px-6 py-2 rounded-sm">
                  REVIEW ANOTHER TASK
                </motion.button>
              </motion.div>
            ) : (
              <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onSubmit={handleSubmit} className="space-y-5">

                {/* Task selector */}
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }} className="glass-card rounded-sm p-6" style={{ overflow: 'visible', position: 'relative', zIndex: 50 }}>
                  <p className="nav-label text-[0.6rem] text-gold/60 mb-3">SELECT COMPLETED TASK</p>

                  {tasksLoading && (
                    <div className="flex items-center gap-2 py-3">
                      <Loader2 size={14} className="text-gold animate-spin" />
                      <span className="font-body text-sm text-ice/40">Loading tasks...</span>
                    </div>
                  )}

                  {!tasksLoading && tasksError && (
                    <div className="flex items-center gap-2 py-3">
                      <AlertTriangle size={14} className="text-red-400" />
                      <span className="font-body text-sm text-red-400/70">{tasksError}</span>
                    </div>
                  )}

                  {!tasksLoading && !tasksError && completedTasks.length === 0 && (
                    totalCompletedCount === 0 ? (
                      /* No completed tasks at all yet */
                      <div className="py-4">
                        <p className="font-body text-sm text-ice/40 mb-1">No completed tasks to review yet.</p>
                        <p className="font-body text-xs text-ice/25">
                          Reviews become available once an intern's task is marked completed. Check back after the next task cycle.
                        </p>
                      </div>
                    ) : (
                      /* Completed tasks exist but all have been reviewed */
                      <div className="flex items-start gap-3 py-3 px-3 rounded-sm"
                        style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)' }}>
                        <Check size={14} className="text-signal mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-body text-sm text-signal/80">All caught up — every completed task has a review.</p>
                          <p className="font-body text-xs text-ice/30 mt-0.5">
                            New tasks will appear here once they're marked complete.
                          </p>
                        </div>
                      </div>
                    )
                  )}

                  {!tasksLoading && !tasksError && completedTasks.length > 0 && (
                    <div className="relative">
                      <button type="button" onClick={() => setDropOpen(!dropOpen)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-sm transition-all"
                        style={{ background: 'rgba(13,15,28,0.8)', border: '1px solid rgba(201,168,76,0.2)' }}>
                        <span className="font-body text-sm text-frost/70">
                          {selectedTask
                            ? `${selectedTask.title} — ${selectedTask.assignee ?? 'Unassigned'}`
                            : 'Choose a completed task...'}
                        </span>
                        <ChevronDown size={14} className="text-gold/50" />
                      </button>
                      <AnimatePresence>
                        {dropOpen && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="absolute top-full left-0 right-0 glass-card rounded-sm mt-1 overflow-hidden"
                            style={{ zIndex: 200 }}>
                            {completedTasks.map(t => (
                              <button key={t.id} type="button"
                                onClick={() => { setSelectedTask(t); setDropOpen(false) }}
                                className="w-full text-left px-4 py-3 transition-colors hover:bg-gold/5"
                                style={{ borderBottom: '1px solid rgba(201,168,76,0.06)' }}>
                                <p className="font-body text-sm text-frost/80">{t.title}</p>
                                <p className="nav-label text-[0.5rem] text-gold/40 mt-0.5">
                                  {t.assignee ?? 'Unassigned'}
                                </p>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </motion.div>

                {/* Rating dimensions */}
                {DIMS.map((dim, di) => (
                  <motion.div key={dim.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + di * 0.1 }} className="glass-card rounded-sm p-6">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="nav-label text-[0.6rem] text-gold/60">{dim.label.toUpperCase()}</p>
                        <p className="font-body text-xs text-ice/35 mt-0.5">{dim.desc}</p>
                      </div>
                      <span className="nav-label text-[0.55rem] text-gold/30">WEIGHT {(dim.weight * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:gap-3 mt-4">
                      {([1, 2, 3, 4, 5] as const).map(n => (
                        <motion.button key={n} type="button" whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
                          onClick={() => setRating(dim.key, n)}
                          className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-sm transition-all duration-200 min-w-[3rem]"
                          style={{
                            background: ratings[dim.key] >= n ? 'rgba(201,168,76,0.12)' : 'rgba(13,15,28,0.6)',
                            border: `1px solid ${ratings[dim.key] >= n ? 'rgba(201,168,76,0.4)' : 'rgba(201,168,76,0.08)'}`,
                          }}>
                          <Star size={16} fill={ratings[dim.key] >= n ? '#c9a84c' : 'none'}
                            style={{ color: ratings[dim.key] >= n ? '#c9a84c' : 'rgba(184,212,240,0.2)' }} />
                          <span className="nav-label text-[0.5rem]"
                            style={{ color: ratings[dim.key] >= n ? '#c9a84c' : 'rgba(184,212,240,0.2)' }}>{n}</span>
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                ))}

                {/* Live PPS preview */}
                {Object.values(ratings).some(v => v > 0) && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    className="glass-card rounded-sm p-5"
                    style={{ border: '1px solid rgba(201,168,76,0.2)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="nav-label text-[0.6rem] text-gold/60">PERFORMANCE SCORE PREVIEW</p>
                      <p className="font-display font-black text-2xl text-gold">
                        {pps.toFixed(2)}<span className="text-ice/30 text-sm font-body font-normal">/5</span>
                      </p>
                    </div>
                    <div className="progress-bar">
                      <motion.div animate={{ width: `${(pps / 5) * 100}%` }} transition={{ duration: 0.4 }}
                        style={{ height: '100%', background: 'linear-gradient(90deg, #c9a84c88, #c9a84c)', borderRadius: 2 }} />
                    </div>
                    <p className="font-body text-xs text-ice/30 mt-2">
                      = 0.40 × {ratings.quality} + 0.35 × {ratings.timeliness} + 0.25 × {ratings.independence}
                    </p>
                  </motion.div>
                )}

                {/* Note */}
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }} className="glass-card rounded-sm p-6">
                  <p className="nav-label text-[0.6rem] text-gold/60 mb-3">REVIEW NOTES (OPTIONAL)</p>
                  <textarea className="uris-input resize-none" rows={2}
                    placeholder="Any qualitative feedback on this task..."
                    value={note} onChange={e => setNote(e.target.value)} />
                </motion.div>

                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="font-body text-sm text-red-400/80 text-center py-2 rounded-sm"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    {error}
                  </motion.p>
                )}

                <motion.button type="submit" disabled={loading || !selectedTask}
                  whileHover={!loading && selectedTask ? { scale: 1.02, boxShadow: '0 12px 32px rgba(201,168,76,0.25)' } : {}}
                  whileTap={!loading && selectedTask ? { scale: 0.98 } : {}}
                  className="btn-gold w-full py-4 rounded-sm text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  {loading ? 'SUBMITTING REVIEW...' : 'SUBMIT PERFORMANCE REVIEW'}
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
