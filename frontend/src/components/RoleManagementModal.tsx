import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Search, ShieldCheck, Loader2, Check } from 'lucide-react'
import { getAllUsers, changeUserRole, type AdminUser } from '../services/collaboration.service'
import { extractErrorMessage } from '../services/error'

const ALL_ROLES = [
  { value: 'TECHNICAL_INTERN',           label: 'Technical Intern' },
  { value: 'RESEARCH_INTERN',            label: 'Research Intern' },
  { value: 'OPERATIONS_INTERN',          label: 'Operations Intern' },
  { value: 'ORENDA_MEMBER',              label: 'Orenda Member' },
  { value: 'TECHNICAL_LEAD',             label: 'Technical Lead' },
  { value: 'RESEARCH_LEAD',              label: 'Research Lead' },
  { value: 'OPERATIONS_LEAD',            label: 'Operations Lead' },
  { value: 'OPERATIONS_PROGRAM_MANAGER', label: 'Operations Program Manager' },
  { value: 'OBSERVER_TEAM_LEAD',         label: 'Observer Team Lead' },
  { value: 'COLLABORATOR_LEAD',          label: 'Collaborator Lead' },
  { value: 'CORE_ADMIN',                 label: 'Core Admin' },
  { value: 'PAST_EMPLOYEE',              label: 'Past Employee' },
]

interface Props {
  onClose: () => void
}

export default function RoleManagementModal({ onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [newRole, setNewRole] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    getAllUsers()
      .then(u => setUsers(u))
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  )

  function selectUser(u: AdminUser) {
    setSelectedUser(u)
    setNewRole(u.role)
    setReason('')
    setError('')
    setSuccess('')
  }

  async function handleSave() {
    if (!selectedUser || !newRole) return
    if (newRole === selectedUser.role) {
      setError('User already has this role.')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await changeUserRole(selectedUser.id, newRole, reason || undefined)
      setSuccess(`Role updated to ${ALL_ROLES.find(r => r.value === newRole)?.label ?? newRole}.`)
      // Update local state
      setUsers(prev => prev.map(u =>
        u.id === selectedUser.id ? { ...u, role: newRole } : u
      ))
      setSelectedUser(prev => prev ? { ...prev, role: newRole } : prev)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update role.'))
    } finally {
      setSaving(false)
    }
  }

  const roleLabel = (role: string) =>
    ALL_ROLES.find(r => r.value === role.toUpperCase())?.label ?? role.replace(/_/g, ' ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        className="glass-card rounded-sm w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ border: '1px solid rgba(201,168,76,0.2)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid rgba(201,168,76,0.1)' }}>
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-gold" />
            <div>
              <p className="nav-label text-[0.55rem] text-gold/50">ADMIN</p>
              <p className="font-display font-bold text-sm text-frost/90">Role Management</p>
            </div>
          </div>
          <motion.button whileTap={{ scale: 0.95 }} onClick={onClose}
            className="text-ice/30 hover:text-ice/70 transition-colors p-1">
            <X size={16} />
          </motion.button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* User list */}
          <div className="w-1/2 flex flex-col"
            style={{ borderRight: '1px solid rgba(201,168,76,0.08)' }}>
            <div className="px-4 py-3"
              style={{ borderBottom: '1px solid rgba(201,168,76,0.08)' }}>
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ice/30" />
                <input
                  type="text"
                  className="uris-input pl-8 text-sm"
                  placeholder="Search users..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="text-gold animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="font-body text-xs text-ice/25 text-center py-8">No users found.</p>
              ) : (
                filtered.map(u => (
                  <motion.button key={u.id} type="button" whileTap={{ scale: 0.99 }}
                    onClick={() => selectUser(u)}
                    className="w-full text-left px-4 py-3 transition-all"
                    style={{
                      background: selectedUser?.id === u.id ? 'rgba(201,168,76,0.08)' : 'transparent',
                      borderBottom: '1px solid rgba(201,168,76,0.05)',
                    }}>
                    <p className="font-body text-sm text-frost/80 truncate">{u.name || u.email}</p>
                    <p className="nav-label text-[0.5rem] text-ice/30 truncate">{u.email}</p>
                    <p className="nav-label text-[0.5rem] mt-0.5"
                      style={{ color: u.status === 'active' ? '#4ade80' : u.status === 'pending' ? '#f59e0b' : '#f87171' }}>
                      {roleLabel(u.role)} · {u.status.toUpperCase()}
                    </p>
                  </motion.button>
                ))
              )}
            </div>
          </div>

          {/* Role editor */}
          <div className="w-1/2 flex flex-col p-5">
            {!selectedUser ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-body text-sm text-ice/25 text-center">Select a user to edit their role.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="nav-label text-[0.5rem] text-ice/30 mb-1">SELECTED USER</p>
                  <p className="font-body text-sm text-frost/90">{selectedUser.name || selectedUser.email}</p>
                  <p className="nav-label text-[0.5rem] text-ice/30">{selectedUser.email}</p>
                </div>

                <div>
                  <p className="nav-label text-[0.5rem] text-ice/30 mb-1">CURRENT ROLE</p>
                  <p className="font-body text-sm text-gold/70">{roleLabel(selectedUser.role)}</p>
                </div>

                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">NEW ROLE</label>
                  <select className="uris-input w-full text-sm" value={newRole}
                    onChange={e => setNewRole(e.target.value)}>
                    {ALL_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">
                    REASON <span className="text-ice/25">(OPTIONAL)</span>
                  </label>
                  <textarea rows={2} maxLength={500}
                    className="uris-input w-full resize-none text-sm"
                    placeholder="Reason for role change..."
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </div>

                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="font-body text-xs text-red-400/80 py-2 px-3 rounded-sm"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    {error}
                  </motion.p>
                )}

                {success && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex items-center gap-2 py-2 px-3 rounded-sm"
                    style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                    <Check size={12} className="text-signal" />
                    <p className="font-body text-xs text-signal">{success}</p>
                  </motion.div>
                )}

                <motion.button type="button" whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saving || newRole === selectedUser.role}
                  className="btn-gold w-full py-2.5 rounded-sm text-sm flex items-center justify-center gap-2 disabled:opacity-40">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  {saving ? 'UPDATING...' : 'UPDATE ROLE'}
                </motion.button>

                <p className="nav-label text-[0.5rem] text-ice/20 text-center">
                  Account, history, tasks, and scores are preserved.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
