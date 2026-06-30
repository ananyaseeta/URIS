import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, selectToken, selectUser } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { UserPlus, User, Search, X, UserCheck } from 'lucide-react'
import { motion } from 'framer-motion'

interface UserData {
  id: string
  name: string
  email: string
  role: string
}

interface FriendRequest {
  id: string
  senderId: string
  receiverId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
}

export default function ChatFindPage() {
  const token = useAuthStore(selectToken)
  const user  = useAuthStore(selectUser)
  const nav   = useNavigate()
  const [searchParams] = useSearchParams()

  const [users, setUsers]           = useState<UserData[]>([])
  const [friends, setFriends]       = useState<UserData[]>([])
  const [requests, setRequests]     = useState<FriendRequest[]>([])
  const [loading, setLoading]       = useState(true)
  const [searching, setSearching]   = useState(false)
  // HIGH-1: pre-populate search term from ?userId= param passed by the
  // Dashboard Chat shortcut when the target isn't yet a friend.
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('userId') ?? '')
  const [isGroupMode, setIsGroupMode] = useState(false)
  const [groupName, setGroupName]   = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [error, setError]           = useState('')
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!token) { nav('/login'); return }
    void loadData()
  }, [token, nav])

  const loadData = async () => {
    try {
      setLoading(true)
      const [usersRes, friendsRes, requestsRes] = await Promise.all([
        api.get('/chat/users').catch(() => ({ data: { data: [] } })),
        api.get('/chat/friends').catch(() => ({ data: { data: [] } })),
        api.get('/chat/friend-requests').catch(() => ({ data: { data: [] } })),
      ])
      setUsers(Array.isArray(usersRes.data?.data)    ? usersRes.data.data    : [])
      setFriends(Array.isArray(friendsRes.data?.data) ? friendsRes.data.data : [])
      setRequests(Array.isArray(requestsRes.data?.data) ? requestsRes.data.data : [])
    } catch (err) {
      setError('Failed to load users')
      console.error(err)
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }

  // Debounced live search
  const searchUsers = useCallback(async (q: string) => {
    try {
      setSearching(true)
      const res = await api.get(`/chat/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      setUsers(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (!initialized) return
    const timer = setTimeout(() => { void searchUsers(searchTerm) }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm, searchUsers, initialized])

  const handleSendFriendRequest = async (userId: string) => {
    try {
      await api.post('/chat/friend-requests', { receiverId: userId })
      // Optimistic — add a local pending entry
      setRequests(prev => [
        ...prev,
        { id: Date.now().toString(), senderId: user?.id || '', receiverId: userId, status: 'PENDING' },
      ])
    } catch (err) {
      setError('Failed to send friend request')
      console.error(err)
    }
  }

  // Navigate straight into the chat after creating it (Bug 6)
  const handleOpenChat = async (friendId: string) => {
    try {
      const res = await api.post<{ success: boolean; data: { id: string } }>(
        `/chat/private/${friendId}`
      )
      nav(`/chat/${res.data.data.id}`)
    } catch (err) {
      setError('Failed to open chat')
      console.error(err)
    }
  }

  // Group: only need 1 selected — backend adds current user (Bug 5 fix)
  const handleCreateGroup = async () => {
    if (selectedUsers.length < 1) {
      setError('Select at least 1 participant for the group')
      return
    }
    try {
      await api.post('/chat/group', {
        name:           groupName || 'New Group',
        participantIds: selectedUsers,
      })
      nav('/chat')
    } catch (err) {
      setError('Failed to create group')
      console.error(err)
    }
  }

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  const isFriend = (userId: string) => friends.some(f => f.id === userId)

  // True if current user sent a pending request TO this person
  const sentPendingTo = (userId: string) =>
    requests.some(r => r.senderId === user?.id && r.receiverId === userId && r.status === 'PENDING')

  // True if this person sent us a pending request (we should show ACCEPT, not REQUEST SENT — Bug 9)
  const receivedPendingFrom = (userId: string) =>
    requests.some(r => r.senderId === userId && r.receiverId === user?.id && r.status === 'PENDING')

  // Accept a received request directly from this page
  const handleAcceptRequest = async (userId: string) => {
    const req = requests.find(
      r => r.senderId === userId && r.receiverId === user?.id && r.status === 'PENDING'
    )
    if (!req) return
    try {
      await api.patch(`/chat/friend-requests/${req.id}/accept`)
      await loadData()
    } catch (err) {
      setError('Failed to accept request')
      console.error(err)
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">COMMUNICATION</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Find People</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm text-ice/40 mt-3">Search and connect with other users</p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">

            {/* ── Search / Mode panel ── */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="lg:col-span-1 glass-card rounded-sm p-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-3">SEARCH USERS</p>

              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ice/40 pointer-events-none z-10" />
                  <input type="text" placeholder="Search by name or email..."
                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="uris-input w-full" style={{ paddingLeft: '2.25rem' }} />
                  {searching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.5rem] text-gold/50 animate-pulse">...</span>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="nav-label text-[0.55rem] text-gold/40">MODE</p>
                  <div className="flex gap-2">
                    {(['private', 'group'] as const).map(mode => (
                      <button key={mode}
                        onClick={() => setIsGroupMode(mode === 'group')}
                        className="flex-1 py-2 rounded-sm text-[0.6rem] transition-all"
                        style={
                          (mode === 'group') === isGroupMode
                            ? { background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' }
                            : { background: 'rgba(13,15,28,0.5)', border: '1px solid rgba(201,168,76,0.1)', color: 'rgba(184,212,240,0.5)' }
                        }>
                        {mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {isGroupMode && (
                  <div className="space-y-2">
                    <p className="nav-label text-[0.55rem] text-gold/40">GROUP NAME</p>
                    <input type="text" placeholder="Enter group name..."
                      value={groupName} onChange={e => setGroupName(e.target.value)}
                      className="uris-input w-full" />
                  </div>
                )}

                {isGroupMode && selectedUsers.length > 0 && (
                  <div className="rounded-sm p-3"
                    style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.2)' }}>
                    <p className="nav-label text-[0.55rem] text-gold/60 mb-2">
                      SELECTED ({selectedUsers.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedUsers.map(uid => {
                        const u = users.find(x => x.id === uid)
                        return (
                          <span key={uid}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[0.5rem]"
                            style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c' }}>
                            {u?.name ?? uid.slice(0, 6)}
                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleUserSelection(uid)} />
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {isGroupMode && (
                  <button onClick={handleCreateGroup}
                    disabled={selectedUsers.length < 1}
                    className="btn-gold w-full py-2 rounded-sm text-[0.6rem] disabled:opacity-50">
                    CREATE GROUP CHAT
                  </button>
                )}

                {error && (
                  <p className="font-body text-xs text-red-400/80 py-1.5 px-2 rounded-sm"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    {error}
                  </p>
                )}
              </div>
            </motion.div>

            {/* ── Users list ── */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="lg:col-span-2 glass-card rounded-sm p-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-4">USERS ({users.filter(u => u.id !== user?.id).length})</p>

              {loading ? (
                <p className="text-sm text-ice/40">Loading users...</p>
              ) : users.filter(u => u.id !== user?.id).length === 0 ? (
                <p className="text-sm text-ice/40">No users found</p>
              ) : (
                <div className="space-y-3">
                  {users.filter(u => u.id !== user?.id).map(u => {
                    const alreadyFriend     = isFriend(u.id)
                    const sentPending       = sentPendingTo(u.id)
                    const receivedPending   = receivedPendingFrom(u.id)

                    return (
                      <div key={u.id}
                        className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 p-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full"
                            style={{ background: 'rgba(201,168,76,0.08)' }}>
                            <User className="h-5 w-5 text-gold/60" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-body font-semibold text-ice truncate">{u.name}</p>
                            <p className="text-[0.55rem] text-ice/40 truncate">{u.email}</p>
                            <p className="text-[0.5rem] text-gold/40 uppercase">{u.role.replace(/_/g, ' ')}</p>
                          </div>
                        </div>

                        <div className="flex-shrink-0 ml-3">
                          {/* Group mode — toggle selection */}
                          {isGroupMode ? (
                            <button onClick={() => toggleUserSelection(u.id)}
                              className="px-3 py-1.5 rounded-sm text-[0.55rem] transition-all"
                              style={
                                selectedUsers.includes(u.id)
                                  ? { background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' }
                                  : { background: 'rgba(13,15,28,0.5)', border: '1px solid rgba(201,168,76,0.15)', color: 'rgba(184,212,240,0.5)' }
                              }>
                              {selectedUsers.includes(u.id) ? '✓ SELECTED' : 'SELECT'}
                            </button>

                          ) : alreadyFriend ? (
                            // Already friends — go straight to chat (Bug 6 fixed)
                            <button onClick={() => void handleOpenChat(u.id)}
                              className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1">
                              <UserCheck size={12} />
                              CHAT
                            </button>

                          ) : receivedPending ? (
                            // They sent us a request — show ACCEPT (Bug 9 fixed)
                            <button onClick={() => void handleAcceptRequest(u.id)}
                              className="px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                              style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }}>
                              <UserPlus size={12} />
                              ACCEPT
                            </button>

                          ) : sentPending ? (
                            // We already sent — show pending state
                            <span className="rounded px-2 py-1 text-[0.55rem] font-medium"
                              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                              REQUEST SENT
                            </span>

                          ) : (
                            // No connection — send request
                            <button onClick={() => void handleSendFriendRequest(u.id)}
                              className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1">
                              <UserPlus size={12} />
                              ADD
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>

          </div>
        </div>
      </main>
    </div>
  )
}
