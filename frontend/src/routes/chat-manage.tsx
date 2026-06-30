import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken, selectUser } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { ArrowLeft, Users, UserPlus, UserMinus, LogOut, Edit2, Check, X, Crown, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSocket } from '../services/socket.service'

interface Participant {
  userId: string
  joinedAt: string
  user: {
    id: string
    name: string
    email: string
    role: string
  }
}

interface ChatDetails {
  id: string
  type: 'PRIVATE' | 'GROUP'
  name: string | null
  createdById: string | null
  createdAt: string
  participants: Participant[]
}

interface Friend {
  id: string
  name: string
  email: string
  role: string
}

export default function ChatManagePage() {
  const { chatId } = useParams<{ chatId: string }>()
  const token = useAuthStore(selectToken)
  const user  = useAuthStore(selectUser)
  const nav   = useNavigate()

  const [chat, setChat]             = useState<ChatDetails | null>(null)
  const [friends, setFriends]       = useState<Friend[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [actionError, setActionError] = useState('')

  // Rename state
  const [renaming, setRenaming]     = useState(false)
  const [newName, setNewName]       = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  // Add participant state
  const [addLoading, setAddLoading] = useState<string | null>(null)  // userId being added

  // Remove / leave loading state
  const [removeLoading, setRemoveLoading] = useState<string | null>(null)
  const [leaveLoading, setLeaveLoading]   = useState(false)

  const isCreator = chat?.createdById === user?.id

  // ── Load chat details + friends list ───────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!chatId) return
    try {
      setLoading(true)
      const [chatRes, friendsRes] = await Promise.all([
        api.get<{ success: boolean; data: ChatDetails }>(`/chat/chats/${chatId}`),
        api.get<{ success: boolean; data: Friend[] }>('/chat/friends').catch(() => ({ data: { data: [] } })),
      ])

      const chatData = chatRes.data.data
      if (chatData.type !== 'GROUP') {
        // Not a group — redirect back to the conversation
        nav(`/chat/${chatId}`)
        return
      }

      setChat(chatData)
      setNewName(chatData.name ?? '')
      setFriends(Array.isArray(friendsRes.data?.data) ? friendsRes.data.data : [])
    } catch {
      setError('Failed to load group details')
    } finally {
      setLoading(false)
    }
  }, [chatId, nav])

  useEffect(() => {
    if (!token) { nav('/login'); return }
    void loadData()
  }, [token, nav, loadData])

  // ── Socket — listen for live participant changes ────────────────────────────
  useEffect(() => {
    if (!chatId) return
    const socket = getSocket()
    if (!socket) return

    socket.emit('chat:join', { chatId })

    const handleRenamed = (data: { chatId: string; name: string }) => {
      if (data.chatId !== chatId) return
      setChat(prev => prev ? { ...prev, name: data.name } : prev)
      setNewName(data.name)
    }

    const handleParticipantAdded = (data: { chatId: string; user: Friend }) => {
      if (data.chatId !== chatId) return
      void loadData()  // reload to get full participant record with joinedAt
    }

    const handleParticipantRemoved = (data: { chatId: string; userId: string; newCreatorId?: string }) => {
      if (data.chatId !== chatId) return
      // If the current user was removed or left, navigate away
      if (data.userId === user?.id) {
        nav('/chat')
        return
      }
      setChat(prev => {
        if (!prev) return prev
        const updated: ChatDetails = {
          ...prev,
          participants: prev.participants.filter(p => p.userId !== data.userId),
          createdById:  data.newCreatorId ?? prev.createdById,
        }
        return updated
      })
    }

    socket.on('chat:renamed',            handleRenamed)
    socket.on('chat:participant_added',  handleParticipantAdded)
    socket.on('chat:participant_removed', handleParticipantRemoved)

    return () => {
      socket.off('chat:renamed',            handleRenamed)
      socket.off('chat:participant_added',  handleParticipantAdded)
      socket.off('chat:participant_removed', handleParticipantRemoved)
      socket.emit('chat:leave', { chatId })
    }
  }, [chatId, user?.id, loadData, nav])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRename = async () => {
    if (!newName.trim() || !chatId) return
    setRenameLoading(true)
    setActionError('')
    try {
      await api.patch(`/chat/chats/${chatId}/name`, { name: newName.trim() })
      setChat(prev => prev ? { ...prev, name: newName.trim() } : prev)
      setRenaming(false)
    } catch {
      setActionError('Failed to rename group')
    } finally {
      setRenameLoading(false)
    }
  }

  const handleAddParticipant = async (friendId: string) => {
    if (!chatId) return
    setAddLoading(friendId)
    setActionError('')
    try {
      await api.post(`/chat/chats/${chatId}/participants`, { userId: friendId })
      // Socket event will trigger loadData() for full refresh
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setActionError(msg ?? 'Failed to add participant')
    } finally {
      setAddLoading(null)
    }
  }

  const handleRemoveParticipant = async (targetUserId: string) => {
    if (!chatId) return
    setRemoveLoading(targetUserId)
    setActionError('')
    try {
      await api.delete(`/chat/chats/${chatId}/participants/${targetUserId}`)
      // Socket event handles UI update
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setActionError(msg ?? 'Failed to remove participant')
    } finally {
      setRemoveLoading(null)
    }
  }

  const handleLeave = async () => {
    if (!chatId) return
    setLeaveLoading(true)
    setActionError('')
    try {
      await api.post(`/chat/chats/${chatId}/leave`)
      nav('/chat')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setActionError(msg ?? 'Failed to leave group')
      setLeaveLoading(false)
    }
  }

  // Friends not already in the chat
  const participantIds = new Set(chat?.participants.map(p => p.userId) ?? [])
  const addableFriends = friends.filter(f => !participantIds.has(f.id))

  const roleLabel = (role: string) =>
    role.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 text-frost flex items-center justify-center">
        <Starfield />
        <Loader2 size={24} className="text-gold animate-spin" />
      </div>
    )
  }

  if (error || !chat) {
    return (
      <div className="min-h-screen bg-navy-950 text-frost">
        <Starfield />
        <Sidebar />
        <main className="md:ml-52 pt-14 flex items-center justify-center min-h-screen">
          <p className="font-body text-sm text-red-400/70">{error || 'Group not found'}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <button onClick={() => nav(`/chat/${chatId}`)}
              className="flex items-center gap-2 mb-6 text-ice/40 hover:text-gold transition-colors">
              <ArrowLeft size={14} />
              <span className="nav-label text-[0.55rem]">BACK TO CHAT</span>
            </button>
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">GROUP SETTINGS</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                <Users size={16} className="text-gold" />
              </div>
              {renaming ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleRename(); if (e.key === 'Escape') setRenaming(false) }}
                    className="uris-input flex-1 font-display font-black text-xl"
                    autoFocus
                  />
                  <button onClick={() => void handleRename()} disabled={renameLoading || !newName.trim()}
                    className="p-2 rounded-sm text-signal/70 hover:text-signal transition-colors disabled:opacity-40"
                    style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                    {renameLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  </button>
                  <button onClick={() => { setRenaming(false); setNewName(chat.name ?? '') }}
                    className="p-2 rounded-sm text-ice/40 hover:text-ice/70 transition-colors"
                    style={{ background: 'rgba(184,212,240,0.05)', border: '1px solid rgba(184,212,240,0.1)' }}>
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="font-display font-black text-2xl text-ice-gradient">{chat.name ?? 'Group Chat'}</h1>
                  {isCreator && (
                    <button onClick={() => setRenaming(true)}
                      className="p-1.5 rounded-sm text-ice/30 hover:text-gold transition-colors"
                      style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.1)' }}
                      title="Rename group">
                      <Edit2 size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="gold-rule w-14 mt-3" />
            <p className="font-body text-xs text-ice/40 mt-2">
              {chat.participants.length} member{chat.participants.length !== 1 ? 's' : ''}
            </p>
          </motion.div>

          {/* Action error */}
          <AnimatePresence>
            {actionError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center justify-between mb-4 px-4 py-2.5 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                <p className="font-body text-xs text-red-400/80">{actionError}</p>
                <button onClick={() => setActionError('')} className="text-red-400/50 hover:text-red-400 ml-3">
                  <X size={12} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Members */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="glass-card rounded-sm p-6 mb-6">
            <p className="nav-label text-[0.6rem] text-gold/60 mb-4">MEMBERS</p>

            <div className="space-y-2">
              {chat.participants.map(p => {
                const isMe      = p.userId === user?.id
                const isMember  = true // everyone here is a member
                const isOwner   = p.userId === chat.createdById

                return (
                  <div key={p.userId}
                    className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full"
                        style={{ background: 'rgba(201,168,76,0.08)' }}>
                        {isOwner
                          ? <Crown size={13} className="text-gold" />
                          : <Users size={12} className="text-ice/40" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-body font-semibold text-sm text-ice truncate">
                          {p.user.name}
                          {isMe && <span className="ml-1.5 text-[0.5rem] text-gold/50">(you)</span>}
                        </p>
                        <p className="text-[0.5rem] text-ice/35 truncate">{roleLabel(p.user.role)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isOwner && (
                        <span className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
                          style={{ background: 'rgba(201,168,76,0.12)', color: '#c9a84c' }}>
                          CREATOR
                        </span>
                      )}
                      {/* Creator can remove non-creator members; members can't remove others */}
                      {!isMe && isCreator && !isOwner && (
                        <button
                          onClick={() => void handleRemoveParticipant(p.userId)}
                          disabled={removeLoading === p.userId}
                          className="p-1.5 rounded-sm text-red-400/50 hover:text-red-400 transition-colors disabled:opacity-40"
                          style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)' }}
                          title={`Remove ${p.user.name}`}>
                          {removeLoading === p.userId
                            ? <Loader2 size={11} className="animate-spin" />
                            : <UserMinus size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>

          {/* Add participants — creator only, only shows friends not already in chat */}
          {isCreator && addableFriends.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="glass-card rounded-sm p-6 mb-6">
              <p className="nav-label text-[0.6rem] text-gold/60 mb-4">ADD PEOPLE</p>
              <div className="space-y-2">
                {addableFriends.map(f => (
                  <div key={f.id}
                    className="flex items-center justify-between rounded-sm border border-gold/10 bg-navy-900/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-body font-semibold text-sm text-ice truncate">{f.name}</p>
                      <p className="text-[0.5rem] text-ice/35 truncate">{roleLabel(f.role)}</p>
                    </div>
                    <button
                      onClick={() => void handleAddParticipant(f.id)}
                      disabled={addLoading === f.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-all disabled:opacity-40"
                      style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c' }}>
                      {addLoading === f.id
                        ? <Loader2 size={11} className="animate-spin" />
                        : <UserPlus size={11} />}
                      <span className="nav-label text-[0.5rem]">ADD</span>
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Leave group */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="glass-card rounded-sm p-6">
            <p className="nav-label text-[0.6rem] text-gold/60 mb-3">DANGER ZONE</p>
            {isCreator && chat.participants.length > 1 && (
              <p className="font-body text-xs text-ice/40 mb-3">
                You are the group creator. Leaving will transfer ownership to the next member.
              </p>
            )}
            {isCreator && chat.participants.length === 1 && (
              <p className="font-body text-xs text-ice/40 mb-3">
                You are the only member. Leaving will permanently delete this group.
              </p>
            )}
            <button
              onClick={() => void handleLeave()}
              disabled={leaveLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-sm transition-all disabled:opacity-50"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
              {leaveLoading ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
              <span className="nav-label text-[0.55rem]">LEAVE GROUP</span>
            </button>
          </motion.div>

        </div>
      </main>
    </div>
  )
}
