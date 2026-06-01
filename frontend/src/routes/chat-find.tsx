import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken, selectUser } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { UserPlus, User, Search, X } from 'lucide-react'
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
  const user = useAuthStore(selectUser)
  const nav = useNavigate()
  
  const [users, setUsers] = useState<UserData[]>([])
  const [friends, setFriends] = useState<UserData[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isGroupMode, setIsGroupMode] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      nav('/login')
      return
    }
    loadData()
  }, [token, nav])

  const loadData = async () => {
    try {
      setLoading(true)
      const [usersRes, friendsRes, requestsRes] = await Promise.all([
        api.get('/chat/users').catch(() => ({ data: [] })),
        api.get('/chat/friends').catch(() => ({ data: [] })),
        api.get('/chat/friend-requests').catch(() => ({ data: [] }))
      ])
      setUsers(usersRes.data || [])
      setFriends(friendsRes.data || [])
      setRequests(requestsRes.data || [])
    } catch (err) {
      setError('Failed to load users')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Debounced live search against backend
  const searchUsers = useCallback(async (q: string) => {
    try {
      setSearching(true)
      const res = await api.get(`/chat/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      setUsers(res.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      searchUsers(searchTerm)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm, searchUsers])

  const handleSendFriendRequest = async (userId: string) => {
    try {
      await api.post('/chat/friend-requests', { receiverId: userId })
      setRequests([...requests, { id: Date.now().toString(), senderId: user?.id || '', receiverId: userId, status: 'PENDING' }])
    } catch (err) {
      setError('Failed to send friend request')
      console.error(err)
    }
  }

  const handleCreateGroup = async () => {
    if (selectedUsers.length < 2) {
      setError('Group chat must have at least 2 participants')
      return
    }

    try {
      await api.post('/chat/group', {
        name: groupName || 'New Group',
        participantIds: selectedUsers
      })
      nav('/chat')
    } catch (err) {
      setError('Failed to create group')
      console.error(err)
    }
  }

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const filteredUsers = users

  const isFriend = (userId: string) => {
    return friends.some(f => f.id === userId)
  }

  const hasPendingRequest = (userId: string) => {
    return requests.some(r =>
      (r.senderId === user?.id && r.receiverId === userId && r.status === 'PENDING') ||
      (r.receiverId === user?.id && r.senderId === userId && r.status === 'PENDING')
    )
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
            <p className="font-body text-sm text-ice/40 mt-3">
              Search and connect with other users
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Search and Filter */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="lg:col-span-1 glass-card rounded-sm p-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-3">SEARCH USERS</p>

              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-ice/40" />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="uris-input pl-10 w-full"
                  />
                  {searching && (
                    <span className="absolute right-3 top-3 text-[0.5rem] text-gold/50 animate-pulse">SEARCHING...</span>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="nav-label text-[0.55rem] text-gold/40">MODE</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsGroupMode(false)}
                      className={`flex-1 py-2 rounded-sm text-[0.6rem] transition-all ${
                        !isGroupMode
                          ? 'bg-gold/20 border border-gold/40 text-gold'
                          : 'bg-navy-900/50 border border-gold/10 text-ice/50'
                      }`}
                    >
                      PRIVATE
                    </button>
                    <button
                      onClick={() => setIsGroupMode(true)}
                      className={`flex-1 py-2 rounded-sm text-[0.6rem] transition-all ${
                        isGroupMode
                          ? 'bg-gold/20 border border-gold/40 text-gold'
                          : 'bg-navy-900/50 border border-gold/10 text-ice/50'
                      }`}
                    >
                      GROUP
                    </button>
                  </div>
                </div>

                {isGroupMode && (
                  <div className="space-y-2">
                    <p className="nav-label text-[0.55rem] text-gold/40">GROUP NAME</p>
                    <input
                      type="text"
                      placeholder="Enter group name..."
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="uris-input w-full"
                    />
                  </div>
                )}

                {isGroupMode && selectedUsers.length > 0 && (
                  <div className="rounded-sm border border-gold/20 bg-gold/5 p-3">
                    <p className="text-[0.55rem] text-gold/60 mb-2">SELECTED ({selectedUsers.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedUsers.map(userId => {
                        const selectedUser = users.find(u => u.id === userId)
                        return (
                          <span key={userId} className="inline-flex items-center gap-1 rounded bg-gold/10 px-2 py-1 text-[0.5rem] text-gold">
                            {selectedUser?.name}
                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleUserSelection(userId)} />
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {isGroupMode && (
                  <button
                    onClick={handleCreateGroup}
                    disabled={selectedUsers.length < 2}
                    className="btn-gold w-full py-2 rounded-sm text-[0.6rem] disabled:opacity-50"
                  >
                    CREATE GROUP CHAT
                  </button>
                )}
              </div>
            </motion.div>

            {/* Users List */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="lg:col-span-2 glass-card rounded-sm p-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-4">USERS ({filteredUsers.length})</p>

              {loading ? (
                <p className="text-sm text-ice/40">Loading users...</p>
              ) : error ? (
                <p className="text-sm text-red-400/70">{error}</p>
              ) : filteredUsers.length === 0 ? (
                <p className="text-sm text-ice/40">No users found</p>
              ) : (
                <div className="space-y-3">
                  {filteredUsers.map(u => {
                    const isSelf = u.id === user?.id
                    const alreadyFriend = isFriend(u.id)
                    const hasPending = hasPendingRequest(u.id)

                    if (isSelf) return null

                    return (
                      <div key={u.id} className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 text-gold">
                            <User className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-body font-semibold text-ice">{u.name}</p>
                            <p className="text-[0.55rem] text-ice/40">{u.email}</p>
                            <p className="text-[0.5rem] text-gold/50 uppercase">{u.role.replace('_', ' ')}</p>
                          </div>
                        </div>
                        <div>
                          {alreadyFriend ? (
                            <button
                              onClick={() => nav('/chat')}
                              className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem]"
                            >
                              CHAT
                            </button>
                          ) : hasPending ? (
                            <span className="rounded bg-yellow-500/20 px-2 py-1 text-[0.55rem] text-yellow-500/70 font-medium">
                              REQUEST SENT
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSendFriendRequest(u.id)}
                              className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                            >
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
