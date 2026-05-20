import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, CheckCircle, X, Clock, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Key, Users, TrendingUp, Lock,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import { useAuthStore, selectUser } from '../store/authStore'
import { ROLES } from '../constants/roles'
import {
  listApprovals, approveRequest, rejectRequest, cancelApprovalRequest,
  getMyPermissions, getAllUsers, getRoleHistory, getAccessMatrix, getSecurityOverview,
  submitPromotionRequest,
  type ApprovalRequest, type PermissionsResponse,
  type GovernanceUser, type RoleHistoryRecord, type AccessMatrixResponse, type SecurityOverview,
} from '../services/governance.service'
import { extractErrorMessage } from '../services/error'

const GOLD    = '#c9a84c'
const ICE_DIM = 'rgba(184,212,240,0.25)'
const GREEN   = '#4ade80'
const AMBER   = '#f59e0b'
const RED     = '#f87171'
const BLUE    = '#60a5fa'

type Tab = 'approvals' | 'promotions' | 'users' | 'role-history' | 'access-matrix' | 'security' | 'permissions'

const ALL_ROLES = Object.values(ROLES).filter(r => r !== 'admin' && r !== 'intern')

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role.includes('admin') || role.includes('lead') || role.includes('manager')
  const isIntern = role.includes('intern') || role === 'orenda_member'
  const bg    = isAdmin ? 'rgba(201,168,76,0.12)' : isIntern ? 'rgba(96,165,250,0.12)' : 'rgba(184,212,240,0.08)'
  const color = isAdmin ? GOLD : isIntern ? BLUE : ICE_DIM
  return (
    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
      style={{ background: bg, color }}>
      {role.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending:   { bg: 'rgba(245,158,11,0.12)',  color: AMBER },
    approved:  { bg: 'rgba(74,222,128,0.12)',  color: GREEN },
    rejected:  { bg: 'rgba(248,113,113,0.12)', color: RED },
    cancelled: { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM },
    active:    { bg: 'rgba(74,222,128,0.12)',  color: GREEN },
    inactive:  { bg: 'rgba(245,158,11,0.12)',  color: AMBER },
    archived:  { bg: 'rgba(248,113,113,0.12)', color: RED },
    removed:   { bg: 'rgba(248,113,113,0.15)', color: RED },
    alumni:    { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM },
  }
  const s = map[status] ?? { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM }
  return (
    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color }}>
      {status.toUpperCase()}
    </span>
  )
}

function ActionBadge({ action }: { action: string }) {
  const labels: Record<string, string> = {
    CHANGE_USER_ROLE:  'Role Change',
    ARCHIVE_USER:      'Archive User',
    FINISH_INTERNSHIP: 'Finish Internship',
    REMOVE_USER:       'Remove User',
  }
  return (
    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(96,165,250,0.12)', color: BLUE }}>
      {labels[action] ?? action.replace(/_/g, ' ')}
    </span>
  )
}

function FeedbackBanner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex items-center gap-2 p-3 rounded-sm"
      style={{
        background: ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
        border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
      }}>
      {ok ? <CheckCircle size={13} style={{ color: GREEN }} /> : <AlertTriangle size={13} style={{ color: RED }} />}
      <p className="font-body text-sm" style={{ color: ok ? GREEN : RED }}>{text}</p>
    </motion.div>
  )
}

// ── Request Card ──────────────────────────────────────────────────────────────
function RequestCard({ req, currentUserId, onApprove, onReject, onCancel, loading }: {
  req: ApprovalRequest; currentUserId: string
  onApprove: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void
  loading: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isMine    = req.requestedById === currentUserId
  const isLoading = loading === req.id

  // Build human-readable description from payload
  const payloadDesc = req.action === 'CHANGE_USER_ROLE'
    ? `New role: ${String(req.payload.newRole ?? '').replace(/_/g, ' ')}`
    : req.action === 'ARCHIVE_USER' || req.action === 'REMOVE_USER'
      ? `Reason: ${String(req.payload.reason ?? 'not specified')}`
      : JSON.stringify(req.payload)

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-sm overflow-hidden">
      <div className="flex items-start justify-between p-4 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ActionBadge action={req.action} />
            <StatusBadge status={req.status} />
            {req.isExpired && <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full" style={{ background: 'rgba(248,113,113,0.12)', color: RED }}>EXPIRED</span>}
          </div>
          <p className="font-body text-sm text-frost/80 mt-1">{payloadDesc}</p>
          <p className="nav-label text-[0.5rem] mt-1" style={{ color: ICE_DIM }}>
            Target: <span className="font-mono">{req.targetId.slice(0, 8)}…</span>
            {' · '}Requested by {req.requester?.name ?? req.requestedById}
            {' · '}{new Date(req.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
          {req.reviewer && (
            <p className="nav-label text-[0.5rem] mt-0.5" style={{ color: ICE_DIM }}>
              Reviewed by {req.reviewer.name}{req.reviewNote && ` · "${req.reviewNote}"`}
            </p>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-sm" style={{ color: ICE_DIM }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 pb-3">
              <p className="nav-label text-[0.5rem] mb-1" style={{ color: `${GOLD}66` }}>PAYLOAD</p>
              <pre className="font-mono text-xs rounded-sm p-2 overflow-x-auto"
                style={{ background: 'rgba(13,15,28,0.6)', color: 'rgba(184,212,240,0.6)', fontSize: '0.65rem' }}>
                {JSON.stringify(req.payload, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {req.status === 'pending' && !req.isExpired && (
        <div className="flex gap-2 px-4 pb-4">
          {!isMine && (
            <>
              <motion.button whileHover={{ scale: 1.03 }} disabled={!!isLoading} onClick={() => onApprove(req.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.55rem] disabled:opacity-50"
                style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: GREEN }}>
                {isLoading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />} APPROVE
              </motion.button>
              <motion.button whileHover={{ scale: 1.03 }} disabled={!!isLoading} onClick={() => onReject(req.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.55rem] disabled:opacity-50"
                style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: RED }}>
                {isLoading ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} REJECT
              </motion.button>
            </>
          )}
          {isMine && (
            <>
              <motion.button whileHover={{ scale: 1.03 }} disabled={!!isLoading} onClick={() => onCancel(req.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm nav-label text-[0.55rem] disabled:opacity-50"
                style={{ background: 'rgba(184,212,240,0.08)', border: '1px solid rgba(184,212,240,0.15)', color: ICE_DIM }}>
                {isLoading ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} CANCEL
              </motion.button>
              <p className="nav-label text-[0.5rem] self-center ml-1" style={{ color: ICE_DIM }}>Awaiting a second admin</p>
            </>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────
function ApprovalsTab({ pending, history, currentUserId, onApprove, onReject, onCancel, loading, subTab, setSubTab }: {
  pending: ApprovalRequest[]; history: ApprovalRequest[]; currentUserId: string
  onApprove: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void
  loading: string | null; subTab: 'pending' | 'history'; setSubTab: (t: 'pending' | 'history') => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['pending', 'history'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className="px-4 py-2 rounded-sm nav-label text-[0.55rem] transition-all"
            style={{
              background: subTab === t ? 'rgba(201,168,76,0.12)' : 'transparent',
              border: `1px solid ${subTab === t ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.1)'}`,
              color: subTab === t ? GOLD : ICE_DIM,
            }}>
            {t.toUpperCase()} {t === 'pending' && pending.length > 0 && `(${pending.length})`}
          </button>
        ))}
      </div>
      {subTab === 'pending' && (
        pending.length === 0
          ? <div className="glass-card rounded-sm p-10 text-center"><CheckCircle size={28} className="mx-auto mb-3" style={{ color: GREEN }} /><p className="font-body text-sm" style={{ color: ICE_DIM }}>No pending approval requests.</p></div>
          : pending.map(r => <RequestCard key={r.id} req={r} currentUserId={currentUserId} onApprove={onApprove} onReject={onReject} onCancel={onCancel} loading={loading} />)
      )}
      {subTab === 'history' && (
        history.length === 0
          ? <div className="glass-card rounded-sm p-10 text-center"><p className="font-body text-sm" style={{ color: ICE_DIM }}>No approval history yet.</p></div>
          : history.map(r => <RequestCard key={r.id} req={r} currentUserId={currentUserId} onApprove={onApprove} onReject={onReject} onCancel={onCancel} loading={loading} />)
      )}
    </div>
  )
}

// ── Promotions Tab ────────────────────────────────────────────────────────────
function PromotionsTab({ users, onSubmit }: {
  users: GovernanceUser[]
  onSubmit: (userId: string, newRole: string, reason: string) => Promise<void>
}) {
  const [selectedUser, setSelectedUser] = useState('')
  const [newRole, setNewRole]           = useState('')
  const [reason, setReason]             = useState('')
  const [loading, setLoading]           = useState(false)
  const [localMsg, setLocalMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const activeUsers = users.filter(u => u.status === 'active')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser || !newRole) return
    setLoading(true)
    setLocalMsg(null)
    try {
      await onSubmit(selectedUser, newRole, reason)
      setLocalMsg({ ok: true, text: 'Promotion request submitted. Awaiting second admin approval.' })
      setSelectedUser(''); setNewRole(''); setReason('')
    } catch (err: unknown) {
      setLocalMsg({ ok: false, text: extractErrorMessage(err, 'Failed to submit promotion request.') })
    } finally {
      setLoading(false)
    }
  }

  const selectedUserObj = activeUsers.find(u => u.id === selectedUser)

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-sm p-5">
        <p className="nav-label text-[0.55rem] mb-1" style={{ color: `${GOLD}66` }}>ROLE PROMOTION / DEMOTION</p>
        <p className="font-body text-xs mb-4" style={{ color: ICE_DIM }}>
          Submits a governance approval request. A second CORE_ADMIN must approve before the role change takes effect.
          All historical data, scores, tasks, and audit logs are preserved.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">SELECT USER</label>
            <select className="uris-input w-full" value={selectedUser} onChange={e => setSelectedUser(e.target.value)} required>
              <option value="">Choose user...</option>
              {activeUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email} — {u.role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          {selectedUserObj && (
            <div className="p-3 rounded-sm" style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.12)' }}>
              <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>CURRENT ROLE</p>
              <RoleBadge role={selectedUserObj.role} />
              {selectedUserObj.teams.length > 0 && (
                <p className="nav-label text-[0.45rem] mt-1" style={{ color: ICE_DIM }}>Teams: {selectedUserObj.teams.join(', ')}</p>
              )}
            </div>
          )}
          <div>
            <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">NEW ROLE</label>
            <select className="uris-input w-full" value={newRole} onChange={e => setNewRole(e.target.value)} required>
              <option value="">Select new role...</option>
              {ALL_ROLES.filter(r => r !== selectedUserObj?.role).map(r => (
                <option key={r} value={r.toUpperCase()}>{r.replace(/_/g, ' ').toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">REASON (OPTIONAL)</label>
            <textarea className="uris-input resize-none w-full" rows={2} maxLength={500}
              placeholder="Justification for this role change..."
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {localMsg && <FeedbackBanner ok={localMsg.ok} text={localMsg.text} />}
          <motion.button type="submit" disabled={loading || !selectedUser || !newRole}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="btn-gold w-full py-3 rounded-sm text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            SUBMIT PROMOTION REQUEST
          </motion.button>
        </form>
      </div>
    </div>
  )
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({ users }: { users: GovernanceUser[] }) {
  const [filter, setFilter] = useState('')
  const filtered = users.filter(u =>
    !filter || u.status === filter
  )
  const statuses = ['active', 'inactive', 'archived', 'removed', 'pending', 'alumni']
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('')}
          className="px-3 py-1.5 rounded-sm nav-label text-[0.55rem] transition-all"
          style={{ background: !filter ? 'rgba(201,168,76,0.12)' : 'transparent', border: `1px solid ${!filter ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.1)'}`, color: !filter ? GOLD : ICE_DIM }}>
          ALL ({users.length})
        </button>
        {statuses.map(s => {
          const count = users.filter(u => u.status === s).length
          if (count === 0) return null
          return (
            <button key={s} onClick={() => setFilter(s)}
              className="px-3 py-1.5 rounded-sm nav-label text-[0.55rem] transition-all"
              style={{ background: filter === s ? 'rgba(201,168,76,0.12)' : 'transparent', border: `1px solid ${filter === s ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.1)'}`, color: filter === s ? GOLD : ICE_DIM }}>
              {s.toUpperCase()} ({count})
            </button>
          )
        })}
      </div>
      <div className="glass-card rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead><tr>
              <th className="text-left">Name</th>
              <th className="text-left">Email</th>
              <th className="text-center">Role</th>
              <th className="text-center">Status</th>
              <th className="text-left">Teams</th>
              <th className="text-center">Joined</th>
            </tr></thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td className="font-body text-sm text-frost/80">{u.name || '—'}</td>
                  <td className="font-body text-xs text-ice/50">{u.email}</td>
                  <td className="text-center"><RoleBadge role={u.role.toLowerCase()} /></td>
                  <td className="text-center"><StatusBadge status={u.status} /></td>
                  <td className="font-body text-xs text-ice/50">{u.teams.join(', ') || '—'}</td>
                  <td className="text-center font-mono text-xs text-ice/40">
                    {new Date(u.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Role History Tab ──────────────────────────────────────────────────────────
function RoleHistoryTab({ records }: { records: RoleHistoryRecord[] }) {
  if (records.length === 0) return (
    <div className="glass-card rounded-sm p-10 text-center">
      <p className="font-body text-sm" style={{ color: ICE_DIM }}>No role changes recorded yet.</p>
    </div>
  )
  return (
    <div className="glass-card rounded-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="uris-table w-full">
          <thead><tr>
            <th className="text-left">User</th>
            <th className="text-center">Previous Role</th>
            <th className="text-center">New Role</th>
            <th className="text-left">Changed By</th>
            <th className="text-left">Reason</th>
            <th className="text-center">Date</th>
          </tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td>
                  <p className="font-body text-sm text-frost/80">{r.user?.name || '—'}</p>
                  <p className="font-mono text-xs text-ice/40">{r.user?.email || r.userId.slice(0, 8) + '…'}</p>
                </td>
                <td className="text-center"><RoleBadge role={r.previousRole.toLowerCase()} /></td>
                <td className="text-center"><RoleBadge role={r.newRole.toLowerCase()} /></td>
                <td className="font-body text-sm text-ice/60">{r.changedBy?.name || 'System'}</td>
                <td className="font-body text-xs text-ice/50 max-w-[160px] truncate">{r.reason || '—'}</td>
                <td className="text-center font-mono text-xs text-ice/40">
                  {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Access Matrix Tab ─────────────────────────────────────────────────────────
function AccessMatrixTab({ matrix }: { matrix: AccessMatrixResponse | null }) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null)

  if (!matrix) return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: GOLD }} /></div>

  const roleData = selectedRole
    ? matrix.matrix.find(r => r.role === selectedRole)
    : null

  // Key permissions to show in the summary grid
  const KEY_PERMS = [
    'CAN_ASSIGN_TASKS', 'CAN_CREATE_TASKS', 'CAN_SUBMIT_REVIEW',
    'CAN_OVERRIDE_SCORE', 'CAN_ARCHIVE_USERS', 'CAN_CHANGE_USER_ROLE',
    'CAN_VIEW_NOTES', 'CAN_VIEW_ALL_INTERNS', 'CAN_MANAGE_APPROVALS',
    'CAN_VIEW_AUDIT_LOGS', 'CAN_MANAGE_IP_BLOCKS', 'CAN_VIEW_LOGIN_LOGS',
  ]

  return (
    <div className="space-y-6">
      {/* Role selector */}
      <div className="glass-card rounded-sm p-5">
        <p className="nav-label text-[0.55rem] mb-3" style={{ color: `${GOLD}66` }}>SELECT ROLE TO INSPECT</p>
        <div className="flex flex-wrap gap-2">
          {matrix.matrix.filter(r => r.role !== 'PAST_EMPLOYEE').map(r => (
            <button key={r.role} onClick={() => setSelectedRole(r.role === selectedRole ? null : r.role)}
              className="px-3 py-1.5 rounded-sm nav-label text-[0.55rem] transition-all"
              style={{
                background: selectedRole === r.role ? 'rgba(201,168,76,0.15)' : 'rgba(13,15,28,0.6)',
                border: `1px solid ${selectedRole === r.role ? 'rgba(201,168,76,0.4)' : 'rgba(201,168,76,0.1)'}`,
                color: selectedRole === r.role ? GOLD : ICE_DIM,
              }}>
              {r.role.replace(/_/g, ' ')}
              <span className="ml-1.5 opacity-60">({r.permissions.length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Role detail */}
      {roleData && (
        <div className="glass-card rounded-sm p-5">
          <div className="mb-4">
            <RoleBadge role={roleData.role.toLowerCase()} />
            <p className="font-body text-xs mt-2" style={{ color: ICE_DIM }}>
              {roleData.permissions.length} of {matrix.allPermissions.length} permissions granted
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {matrix.allPermissions.sort().map(p => {
              const has = roleData.permissions.includes(p)
              return (
                <div key={p} className="flex items-center gap-2 p-2 rounded-sm"
                  style={{ background: has ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.04)', border: `1px solid ${has ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.08)'}` }}>
                  {has
                    ? <CheckCircle size={11} style={{ color: GREEN, flexShrink: 0 }} />
                    : <X size={11} style={{ color: 'rgba(248,113,113,0.4)', flexShrink: 0 }} />}
                  <span className="nav-label text-[0.5rem]" style={{ color: has ? 'rgba(184,212,240,0.6)' : 'rgba(184,212,240,0.25)' }}>
                    {p.replace(/_/g, ' ')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary matrix — key permissions across all roles */}
      {!selectedRole && (
        <div className="glass-card rounded-sm p-5">
          <p className="nav-label text-[0.55rem] mb-4" style={{ color: `${GOLD}66` }}>KEY PERMISSIONS MATRIX</p>
          <div className="overflow-x-auto">
            <table className="uris-table w-full text-center">
              <thead>
                <tr>
                  <th className="text-left">Permission</th>
                  {matrix.matrix.filter(r => r.role !== 'PAST_EMPLOYEE').map(r => (
                    <th key={r.role} className="text-center">
                      <span className="nav-label text-[0.45rem]" style={{ color: ICE_DIM }}>
                        {r.role.replace(/_/g, ' ').split(' ').map(w => w[0]).join('')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KEY_PERMS.map(p => (
                  <tr key={p}>
                    <td className="text-left nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>{p.replace(/^CAN_/, '').replace(/_/g, ' ')}</td>
                    {matrix.matrix.filter(r => r.role !== 'PAST_EMPLOYEE').map(r => (
                      <td key={r.role}>
                        {r.permissions.includes(p)
                          ? <CheckCircle size={10} style={{ color: GREEN, margin: 'auto' }} />
                          : <span style={{ color: 'rgba(248,113,113,0.3)', fontSize: '0.6rem' }}>✕</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Security Tab ──────────────────────────────────────────────────────────────
function SecurityTab({ security }: { security: SecurityOverview | null }) {
  if (!security) return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: GOLD }} /></div>
  const { summary, blockedIPs, suspiciousIPs, recentFailedLogins } = security
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>FAILED LOGINS (24H)</p>
          <p className="font-display font-black text-2xl" style={{ color: summary.failedLogins24h > 10 ? RED : AMBER }}>{summary.failedLogins24h}</p>
        </div>
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>BLOCKED IPs</p>
          <p className="font-display font-black text-2xl" style={{ color: summary.blockedIPCount > 0 ? RED : GREEN }}>{summary.blockedIPCount}</p>
        </div>
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>SUSPICIOUS IPs</p>
          <p className="font-display font-black text-2xl" style={{ color: summary.suspiciousIPCount > 0 ? AMBER : GREEN }}>{summary.suspiciousIPCount}</p>
        </div>
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>INACTIVE / ARCHIVED</p>
          <p className="font-display font-black text-2xl" style={{ color: GOLD }}>{summary.inactiveUsers}</p>
        </div>
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>PENDING APPROVAL</p>
          <p className="font-display font-black text-2xl" style={{ color: summary.pendingUsers > 0 ? AMBER : GREEN }}>{summary.pendingUsers}</p>
        </div>
        <div className="glass-card rounded-sm p-4">
          <p className="nav-label text-[0.5rem] mb-1" style={{ color: ICE_DIM }}>SUCCESS LOGINS (24H)</p>
          <p className="font-display font-black text-2xl" style={{ color: GREEN }}>{summary.successLogins24h}</p>
        </div>
      </div>

      {suspiciousIPs.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <p className="nav-label text-[0.55rem] mb-3" style={{ color: `${GOLD}66` }}>SUSPICIOUS IPs (3+ FAILED LOGINS IN 7 DAYS)</p>
          <div className="space-y-2">
            {suspiciousIPs.map(s => (
              <div key={s.ip} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                <span className="font-mono text-sm text-frost/80">{s.ip}</span>
                <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: AMBER }}>
                  {s.failCount} FAILURES
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {blockedIPs.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <p className="nav-label text-[0.55rem] mb-3" style={{ color: `${GOLD}66` }}>BLOCKED IPs</p>
          <div className="overflow-x-auto">
            <table className="uris-table w-full">
              <thead><tr>
                <th className="text-left">IP Address</th>
                <th className="text-left">Reason</th>
                <th className="text-center">Blocked At</th>
                <th className="text-center">Expires</th>
                <th className="text-center">Status</th>
              </tr></thead>
              <tbody>
                {blockedIPs.map(b => (
                  <tr key={b.id}>
                    <td className="font-mono text-sm text-frost/80">{b.ipAddress}</td>
                    <td className="font-body text-xs text-ice/50">{b.reason || '—'}</td>
                    <td className="text-center font-mono text-xs text-ice/40">
                      {new Date(b.blockedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="text-center font-mono text-xs text-ice/40">
                      {b.expiresAt ? new Date(b.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Permanent'}
                    </td>
                    <td className="text-center">
                      <StatusBadge status={b.isExpired ? 'inactive' : 'active'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recentFailedLogins.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <p className="nav-label text-[0.55rem] mb-3" style={{ color: `${GOLD}66` }}>RECENT FAILED LOGINS</p>
          <div className="overflow-x-auto">
            <table className="uris-table w-full">
              <thead><tr>
                <th className="text-left">Email</th>
                <th className="text-left">IP Address</th>
                <th className="text-center">Time</th>
              </tr></thead>
              <tbody>
                {recentFailedLogins.map(l => (
                  <tr key={l.id}>
                    <td className="font-body text-sm text-frost/70">{l.email}</td>
                    <td className="font-mono text-xs text-ice/50">{l.ipAddress}</td>
                    <td className="text-center font-mono text-xs text-ice/40">
                      {new Date(l.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── My Permissions Tab ────────────────────────────────────────────────────────
function PermissionsTab({ perms }: { perms: PermissionsResponse | null }) {
  if (!perms) return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" style={{ color: GOLD }} /></div>
  return (
    <div className="glass-card rounded-sm p-5">
      <div className="mb-4">
        <p className="nav-label text-[0.55rem] mb-1" style={{ color: `${GOLD}66` }}>YOUR ROLE</p>
        <RoleBadge role={perms.role.toLowerCase()} />
        <div className="gold-rule w-10 mt-3" />
      </div>
      <p className="nav-label text-[0.55rem] mb-3" style={{ color: `${GOLD}66` }}>GRANTED PERMISSIONS ({perms.permissions.length})</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {perms.permissions.sort().map(p => (
          <div key={p} className="flex items-center gap-2 p-2 rounded-sm"
            style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)' }}>
            <CheckCircle size={11} style={{ color: GREEN, flexShrink: 0 }} />
            <span className="nav-label text-[0.5rem]" style={{ color: 'rgba(184,212,240,0.6)' }}>
              {p.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Governance() {
  const user    = useAuthStore(selectUser)
  const isAdmin = user?.role === ROLES.CORE_ADMIN || user?.role === 'core_admin'

  const [tab, setTab]         = useState<Tab>('approvals')
  const [approvalSubTab, setApprovalSubTab] = useState<'pending' | 'history'>('pending')
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [history, setHistory] = useState<ApprovalRequest[]>([])
  const [perms, setPerms]     = useState<PermissionsResponse | null>(null)
  const [users, setUsers]     = useState<GovernanceUser[]>([])
  const [roleHistory, setRoleHistory] = useState<RoleHistoryRecord[]>([])
  const [accessMatrix, setAccessMatrix] = useState<AccessMatrixResponse | null>(null)
  const [security, setSecurity] = useState<SecurityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const promises: Promise<unknown>[] = [
          listApprovals({ status: 'pending' }).then(d => setPending(d.requests)),
          listApprovals({ status: 'approved' }).then(d => setHistory(d.requests)),
          getMyPermissions().then(setPerms),
        ]
        if (isAdmin) {
          promises.push(
            getAllUsers({ limit: 200 }).then(d => setUsers(d.users)),
            getRoleHistory({ limit: 100 }).then(d => setRoleHistory(d.records)),
            getAccessMatrix().then(setAccessMatrix),
            getSecurityOverview().then(setSecurity),
          )
        }
        await Promise.all(promises)
      } catch (err) {
        setMsg({ ok: false, text: extractErrorMessage(err, 'Failed to load governance data.') })
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [isAdmin])

  async function handleApprove(id: string) {
    setActionLoading(id); setMsg(null)
    try {
      await approveRequest(id)
      setPending(prev => prev.filter(r => r.id !== id))
      setMsg({ ok: true, text: 'Request approved and action executed.' })
    } catch (err) { setMsg({ ok: false, text: extractErrorMessage(err, 'Approval failed.') }) }
    finally { setActionLoading(null) }
  }

  async function handleReject(id: string) {
    setActionLoading(id); setMsg(null)
    try {
      const updated = await rejectRequest(id)
      setPending(prev => prev.filter(r => r.id !== id))
      setHistory(prev => [updated, ...prev])
      setMsg({ ok: true, text: 'Request rejected.' })
    } catch (err) { setMsg({ ok: false, text: extractErrorMessage(err, 'Rejection failed.') }) }
    finally { setActionLoading(null) }
  }

  async function handleCancel(id: string) {
    setActionLoading(id); setMsg(null)
    try {
      await cancelApprovalRequest(id)
      setPending(prev => prev.filter(r => r.id !== id))
      setMsg({ ok: true, text: 'Request cancelled.' })
    } catch (err) { setMsg({ ok: false, text: extractErrorMessage(err, 'Cancel failed.') }) }
    finally { setActionLoading(null) }
  }

  async function handlePromotion(userId: string, newRole: string, reason: string) {
    await submitPromotionRequest({ targetUserId: userId, newRole, reason })
    const updated = await listApprovals({ status: 'pending' })
    setPending(updated.requests)
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
    { key: 'approvals',     label: 'APPROVALS',     icon: CheckCircle, },
    { key: 'promotions',    label: 'PROMOTIONS',     icon: TrendingUp,  adminOnly: true },
    { key: 'users',         label: 'USERS',          icon: Users,       adminOnly: true },
    { key: 'role-history',  label: 'ROLE HISTORY',   icon: Clock,       adminOnly: true },
    { key: 'access-matrix', label: 'ACCESS MATRIX',  icon: Lock,        adminOnly: true },
    { key: 'security',      label: 'SECURITY',       icon: Shield,      adminOnly: true },
    { key: 'permissions',   label: 'MY PERMISSIONS', icon: Key },
  ]

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin)

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <p className="nav-label text-[0.55rem] mb-1" style={{ color: `${GOLD}66`, letterSpacing: '0.4em' }}>PHASE 8</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Governance</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm mt-2" style={{ color: ICE_DIM }}>
              Promotions · Approvals · Access matrix · Security oversight · Role governance
            </p>
          </motion.div>

          {loading && <div className="flex items-center justify-center py-24"><Loader2 size={24} className="animate-spin" style={{ color: GOLD }} /></div>}

          {!loading && (
            <>
              {msg && <div className="mb-4"><FeedbackBanner ok={msg.ok} text={msg.text} /></div>}

              <div className="flex flex-wrap gap-1 mb-6 glass-card rounded-sm p-1 overflow-x-auto">
                {visibleTabs.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-sm nav-label text-[0.55rem] transition-all duration-200 whitespace-nowrap relative"
                    style={{
                      background:   tab === t.key ? 'rgba(201,168,76,0.12)' : 'transparent',
                      borderBottom: tab === t.key ? `2px solid ${GOLD}` : '2px solid transparent',
                      color:        tab === t.key ? GOLD : ICE_DIM,
                    }}>
                    <t.icon size={12} />
                    {t.label}
                    {t.key === 'approvals' && pending.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center nav-label text-[0.45rem]"
                        style={{ background: AMBER, color: '#000' }}>{pending.length}</span>
                    )}
                  </button>
                ))}
              </div>

              <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {tab === 'approvals'     && <ApprovalsTab pending={pending} history={history} currentUserId={user?.id ?? ''} onApprove={handleApprove} onReject={handleReject} onCancel={handleCancel} loading={actionLoading} subTab={approvalSubTab} setSubTab={setApprovalSubTab} />}
                {tab === 'promotions'    && <PromotionsTab users={users} onSubmit={handlePromotion} />}
                {tab === 'users'         && <UsersTab users={users} />}
                {tab === 'role-history'  && <RoleHistoryTab records={roleHistory} />}
                {tab === 'access-matrix' && <AccessMatrixTab matrix={accessMatrix} />}
                {tab === 'security'      && <SecurityTab security={security} />}
                {tab === 'permissions'   && <PermissionsTab perms={perms} />}
              </motion.div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
