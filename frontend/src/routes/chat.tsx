import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { MessageSquare, Users, Plus, Search, MoreVertical } from 'lucide-react'
import { motion } from 'framer-motion'

interface Chat {
  id: string
  type: 'PRIVATE' | 'GROUP'
  name?: string
  createdAt: string
  lastMessage?: {
    content: string
    senderId: string
    senderName?: string
    createdAt: string
  }
}

interface Friend {
  id: string
  name: string
  email: string
}

export default function ChatPage() {
  const token = useAuthStore(selectToken)
  const nav = useNavigate()

  const [chats, setChats] = useState<Chat[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
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
      const [chatsRes, friendsRes] = await Promise.all([
        api.get('/chat/chats').catch(() => ({ data: [] })),
        api.get('/chat/friends').catch(() => ({ data: [] }))
      ])
      setChats(Array.isArray(chatsRes.data) ? chatsRes.data : [])
      setFriends(Array.isArray(friendsRes.data) ? friendsRes.data : [])
    } catch (err) {
      setError('Failed to load chats')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePrivateChat = async (friendId: string) => {
    try {
      await api.post(`/chat/private/${friendId}`)
      loadData()
    } catch (err) {
      setError('Failed to create chat')
      console.error(err)
    }
  }

  const filteredChats = chats.filter(chat => {
    if (!searchTerm) return true
    const chatName = chat.name?.toLowerCase() || ''
    const lastMessage = chat.lastMessage?.content?.toLowerCase() || ''
    return chatName.includes(searchTerm.toLowerCase()) || lastMessage.includes(searchTerm.toLowerCase())
  })

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">COMMUNICATION</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Chat</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm text-ice/40 mt-3">
              Private messages and group conversations
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Chat List */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="lg:col-span-2 glass-card rounded-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="nav-label text-[0.6rem] text-gold/60 mb-1">CONVERSATIONS</p>
                  <h2 className="font-display text-xl text-ice">Your active chats</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => nav('/chat/find')}
                    className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                  >
                    <Search size={12} />
                    FIND PEOPLE
                  </button>
                  <button
                    onClick={() => nav('/chat/requests')}
                    className="btn-outline px-3 py-1.5 rounded-sm text-[0.55rem] flex items-center gap-1"
                  >
                    <MessageSquare size={12} />
                    REQUESTS {friends.length > 0 && <span className="ml-1 rounded-full bg-gold/20 px-1.5 text-[0.45rem] text-gold">{friends.length}</span>}
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="uris-input w-full"
                />
              </div>

              {loading ? (
                <p className="text-sm text-ice/40">Loading chats...</p>
              ) : error ? (
                <p className="text-sm text-red-400/70">{error}</p>
              ) : filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageSquare className="mb-4 h-12 w-12 text-ice/30" />
                  <p className="text-sm text-ice/40">No conversations yet</p>
                  <p className="mt-2 text-xs text-ice/30">Start by finding people to chat with</p>
                  <button
                    onClick={() => nav('/chat/find')}
                    className="btn-outline px-4 py-1.5 rounded-sm text-[0.55rem] mt-4"
                  >
                    FIND PEOPLE
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredChats.map(chat => (
                    <div key={chat.id} className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 p-4 hover:bg-navy-900/60 transition-colors">
                      <div className="flex items-center gap-3">
                        {chat.type === 'PRIVATE' ? (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 text-gold">
                            <MessageSquare className="h-5 w-5" />
                          </div>
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 text-gold">
                            <Users className="h-5 w-5" />
                          </div>
                        )}
                        <div>
                          <p className="font-body font-semibold text-ice">
                            {chat.type === 'PRIVATE' ? 'Private Chat' : chat.name}
                          </p>
                          {chat.lastMessage && (
                            <p className="text-[0.55rem] text-ice/40 truncate max-w-[200px]">
                              {chat.lastMessage.senderName}: {chat.lastMessage.content}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[0.5rem] text-ice/30">
                          {chat.lastMessage
                            ? new Date(chat.lastMessage.createdAt).toLocaleDateString()
                            : new Date(chat.createdAt).toLocaleDateString()}
                        </span>
                        <button className="p-1 hover:bg-gold/10 rounded">
                          <MoreVertical className="h-4 w-4 text-ice/40" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Quick Actions */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="lg:col-span-1 glass-card rounded-sm p-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-4">QUICK ACTIONS</p>

              <div className="space-y-4">
                <div className="space-y-3">
                  <p className="nav-label text-[0.55rem] text-gold/40">START PRIVATE CHAT</p>
                  {loading ? (
                    <p className="text-sm text-ice/40">Loading friends...</p>
                  ) : friends.length === 0 ? (
                    <p className="text-sm text-ice/40">No friends yet. Add people to chat.</p>
                  ) : (
                    <div className="space-y-2">
                      {friends.map(friend => (
                        <button
                          key={friend.id}
                          onClick={() => handleCreatePrivateChat(friend.id)}
                          className="btn-outline w-full px-3 py-2 rounded-sm text-[0.55rem] flex items-center gap-2 text-left"
                        >
                          <MessageSquare size={12} />
                          {friend.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t border-gold/10">
                  <p className="nav-label text-[0.55rem] text-gold/40">CREATE GROUP CHAT</p>
                  <button
                    onClick={() => nav('/chat/find')}
                    className="btn-outline w-full px-3 py-2 rounded-sm text-[0.55rem] flex items-center gap-2 justify-center"
                  >
                    <Plus size={12} />
                    CREATE GROUP
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  )
}
