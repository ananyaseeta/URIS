import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { UserPlus, UserX, User } from 'lucide-react'
import { motion } from 'framer-motion'

interface FriendRequest {
  id: string
  senderId: string
  receiverId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  createdAt: string
  sender: {
    id: string
    name: string
    email: string
    role: string
  }
}

type FilterType = 'all' | 'pending' | 'accepted' | 'rejected'

export default function ChatRequestsPage() {
  const token = useAuthStore(selectToken)
  const nav = useNavigate()

  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<FilterType>('pending')

  useEffect(() => {
    if (!token) {
      nav('/login')
      return
    }
    loadRequests()
  }, [token, nav])

  const loadRequests = async () => {
    try {
      setLoading(true)
      const res = await api.get('/chat/friend-requests').catch(() => ({ data: [] }))
      setRequests(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      setError('Failed to load friend requests')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async (id: string) => {
    try {
      await api.patch(`/chat/friend-requests/${id}/accept`)
      loadRequests()
    } catch (err) {
      setError('Failed to accept request')
      console.error(err)
    }
  }

  const handleReject = async (id: string) => {
    try {
      await api.patch(`/chat/friend-requests/${id}/reject`)
      loadRequests()
    } catch (err) {
      setError('Failed to reject request')
      console.error(err)
    }
  }

  const filteredRequests = requests.filter(req => {
    if (filter === 'all') return true
    return req.status === filter.toUpperCase()
  })

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">COMMUNICATION</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Friend Requests</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm text-ice/40 mt-3">
              Manage your incoming friend requests
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="glass-card rounded-sm p-6">
            
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="nav-label text-[0.6rem] text-gold/60 mb-1">MANAGE REQUESTS</p>
                <h2 className="font-display text-xl text-ice">Accept or reject friend requests</h2>
              </div>
              <div className="flex gap-2">
                {(['all', 'pending', 'accepted', 'rejected'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-sm text-[0.55rem] transition-all ${
                      filter === f
                        ? 'bg-gold/20 border border-gold/40 text-gold'
                        : 'bg-navy-900/50 border border-gold/10 text-ice/50'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-ice/40">Loading friend requests...</p>
            ) : error ? (
              <p className="text-sm text-red-400/70">{error}</p>
            ) : filteredRequests.length === 0 ? (
              <p className="text-sm text-ice/40">No {filter !== 'all' ? filter : ''} requests found</p>
            ) : (
              <div className="space-y-3">
                {filteredRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 text-gold">
                        <User className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-body font-semibold text-ice">{req.sender.name}</p>
                        <p className="text-[0.55rem] text-ice/40">{req.sender.email}</p>
                        <p className="text-[0.5rem] text-ice/30">
                          {new Date(req.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {req.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleAccept(req.id)}
                            className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                          >
                            <UserPlus size={12} />
                            ACCEPT
                          </button>
                          <button
                            onClick={() => handleReject(req.id)}
                            className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                          >
                            <UserX size={12} />
                            REJECT
                          </button>
                        </>
                      )}
                      {req.status === 'ACCEPTED' && (
                        <span className="rounded bg-signal/20 px-2 py-1 text-[0.55rem] text-signal font-medium">
                          FRIENDS
                        </span>
                      )}
                      {req.status === 'REJECTED' && (
                        <span className="rounded bg-red-500/20 px-2 py-1 text-[0.55rem] text-red-500/70 font-medium">
                          REJECTED
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  )
}
