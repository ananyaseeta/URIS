import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken, selectUser } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { ArrowLeft, Send, Loader2, MessageSquare, AlertTriangle, Search, X, Edit2, Trash2, Check, Settings, ShieldOff, Shield } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSocket } from '../services/socket.service'
import { useRealtimeStore } from '../store/realtimeStore'

// ── Draft persistence helpers (MED-3) ─────────────────────────────────────────
// Drafts are keyed by chatId so switching conversations never mixes content.
const DRAFT_PREFIX = 'uris_chat_draft_'
const getDraft  = (chatId: string) => localStorage.getItem(`${DRAFT_PREFIX}${chatId}`) ?? ''
const saveDraft = (chatId: string, text: string) => {
  if (text) localStorage.setItem(`${DRAFT_PREFIX}${chatId}`, text)
  else      localStorage.removeItem(`${DRAFT_PREFIX}${chatId}`)
}

interface Message {
  id: string
  chatId: string
  senderId: string
  content: string
  createdAt: string
  editedAt?: string | null
  isDeleted?: boolean
  sender: {
    id: string
    name: string
    email: string
    role: string
  }
}

interface Pagination {
  total: number
  page: number
  limit: number
  pages: number
}

// participantReadMap: userId → ISO string of their lastReadAt (or null if never read)
type ReadMap = Record<string, string | null>

export default function ChatViewPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const token = useAuthStore(selectToken)
  const user  = useAuthStore(selectUser)
  const nav   = useNavigate()

  const [messages, setMessages]       = useState<Message[]>([])
  const [pagination, setPagination]   = useState<Pagination | null>(null)
  // participantReadMap tracks each participant's lastReadAt so we can compute
  // per-message seen status without a separate read-receipt table.
  const [readMap, setReadMap]         = useState<ReadMap>({})
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sending, setSending]         = useState(false)
  const [content, setContent]         = useState(() => (chatId ? getDraft(chatId) : ''))
  const [error, setError]             = useState('')
  const [chatName, setChatName]       = useState('')
  const [chatType, setChatType]       = useState<'PRIVATE' | 'GROUP' | null>(null)
  // FEAT-S4: online presence for the other participant in PRIVATE chats
  const [otherUserId, setOtherUserId]         = useState<string | null>(null)
  const [otherUserOnline, setOtherUserOnline] = useState(false)
  // FEAT-S2: block status — true if current user has blocked the other participant
  const [isBlocked, setIsBlocked]     = useState(false)
  const [blockLoading, setBlockLoading] = useState(false)
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({})

  // ── Search state ──────────────────────────────────────────────────────────
  const [showSearch, setShowSearch]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState('')
  const [searchResults, setSearchResults]   = useState<Message[] | null>(null)
  const [searchLoading, setSearchLoading]   = useState(false)

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const bottomRef        = useRef<HTMLDivElement>(null)
  const inputRef         = useRef<HTMLTextAreaElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // LOW-3: track mount state so the debounced stop_typing callback never fires
  // after the component has unmounted and the chat room has been left.
  // Using a ref (not state) avoids triggering a re-render on unmount.
  const mountedRef       = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // MED-2: track the page the user has explicitly loaded, independent of the
  // server's pagination snapshot. Real-time messages appended via socket do not
  // change this counter, so "Load older messages" always requests the correct
  // next historical page rather than skipping rows that arrived after load.
  const loadedPageRef    = useRef(1)
  // MED-2: whether there are more historical pages to fetch. Stored as both a
  // ref (for use inside callbacks without stale closure) and state (to drive
  // the "Load older messages" button visibility reactively).
  const hasMorePagesRef  = useRef(false)
  const [hasMorePages, setHasMorePages] = useState(false)

  // Session expiry detection — if the socket was rejected due to an expired token,
  // show a visible banner prompting re-login (SEC-7).
  const socketStatus = useRealtimeStore(s => s.status)
  const isSessionExpired = socketStatus === 'auth_expired'

  // ── Load messages ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (page = 1, append = false) => {
    if (!chatId) return
    const LIMIT = 50
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true)
      const res = await api.get<{
        success: boolean
        data: { messages: Message[]; pagination: Pagination; participantReadMap: ReadMap }
      }>(`/chat/chats/${chatId}/messages?page=${page}&limit=${LIMIT}`)

      const { messages: msgs, pagination: pg, participantReadMap } = res.data.data
      // Messages come back newest-first — reverse for display
      const ordered = [...msgs].reverse()
      setMessages(prev => append ? [...ordered, ...prev] : ordered)
      setPagination(pg)
      // Always replace the read map with the freshest snapshot from the server
      if (participantReadMap) setReadMap(participantReadMap)

      // MED-2: update the independent page tracker and the "has more" flag.
      // We consider there to be more pages only when the server returned a full
      // page — this stays correct even as real-time messages inflate pg.total.
      loadedPageRef.current   = page
      hasMorePagesRef.current = msgs.length === LIMIT
      setHasMorePages(msgs.length === LIMIT)
    } catch {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [chatId])

  // ── Load chat name + type from chats list ─────────────────────────────────
  useEffect(() => {
    if (!chatId) return
    api.get<{ success: boolean; data: { chats?: Array<{
      id: string; type: string; name?: string
      otherParticipant?: { id: string; name: string; email: string } | null
    }>; onlineUserIds?: string[] } | Array<{
      id: string; type: string; name?: string
      otherParticipant?: { id: string; name: string; email: string } | null
    }> }>('/chat/chats')
      .then(res => {
        const raw = res.data.data
        const chats = Array.isArray(raw) ? raw : (raw?.chats ?? [])
        const online = Array.isArray(raw) ? [] : (raw?.onlineUserIds ?? [])
        const chat = chats.find(c => c.id === chatId)
        if (!chat) { setChatName('Chat'); return }
        setChatType(chat.type as 'PRIVATE' | 'GROUP')
        if (chat.type === 'PRIVATE') {
          setChatName(chat.otherParticipant?.name ?? chat.otherParticipant?.email ?? 'Private Chat')
          setOtherUserId(chat.otherParticipant?.id ?? null)
          setOtherUserOnline(online.includes(chat.otherParticipant?.id ?? ''))
        } else {
          setChatName(chat.name ?? 'Group Chat')
        }
      })
      .catch(() => setChatName('Chat'))
  }, [chatId])

  // ── Socket — reuse the singleton from socket.service (no second connection) ──
  // The realtimeStore already holds an authenticated socket created at login.
  // We join the chat room on that socket and leave when leaving the view.
  // This eliminates the duplicate connection that previously existed (BUG-C2).
  useEffect(() => {
    if (!chatId) return

    const socket = getSocket()
    if (!socket) return

    // Join the chat room on the shared socket.
    // The server validates ChatParticipant membership before allowing the join.
    socket.emit('chat:join', { chatId })

    // HIGH-1 fix: on reconnect, re-join the room (Socket.IO rooms are server-side
    // state — a reconnected socket starts with no rooms) and re-fetch page 1 to
    // recover any messages that arrived during the disconnection window.
    const handleReconnect = () => {
      socket.emit('chat:join', { chatId })
      void loadMessages(1, false)
    }

    // Update the header name live when a group is renamed from the manage page
    const handleRenamed = (data: { chatId: string; name: string }) => {
      if (data.chatId !== chatId) return
      setChatName(data.name)
    }

    // If this user is removed from the group or the group is deleted, go back to chat list
    const handleParticipantRemoved = (data: { chatId: string; userId: string }) => {
      if (data.chatId !== chatId) return
      if (data.userId === user?.id) nav('/chat')
    }

    // FEAT-S1: update the read map when a participant marks the chat as read,
    // so the sender's tick indicators switch from sent → seen in real-time.
    const handleChatRead = (data: { chatId: string; userId: string; lastReadAt: string }) => {
      if (data.chatId !== chatId) return
      setReadMap(prev => ({ ...prev, [data.userId]: data.lastReadAt }))
    }
    const handleNewMessage = (data: { message: Message; chatId: string }) => {
      if (data.chatId !== chatId) return
      // Skip if already appended optimistically by the sender (BUG-C1 fix)
      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) return prev
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        return [...prev, data.message]
      })
    }

    // CRIT-2 fix: apply edits broadcast by the server to the local message list.
    // Without this handler, edits made by other participants are invisible until reload.
    const handleMessageEdited = (data: { message: Message; chatId: string }) => {
      if (data.chatId !== chatId) return
      setMessages(prev =>
        prev.map(m => m.id === data.message.id ? { ...m, content: data.message.content, editedAt: data.message.editedAt } : m)
      )
    }

    // CRIT-2 fix: apply soft-deletes broadcast by the server to the local message list.
    // Without this handler, deletes made by other participants are invisible until reload.
    const handleMessageDeleted = (data: { messageId: string; chatId: string }) => {
      if (data.chatId !== chatId) return
      setMessages(prev =>
        prev.map(m => m.id === data.messageId ? { ...m, isDeleted: true } : m)
      )
    }

    // Typing indicator — add the typing user to the map
    const handleUserTyping = (data: { chatId: string; userId: string; userName: string }) => {
      if (data.chatId !== chatId || data.userId === user?.id) return
      setTypingUsers(prev => ({ ...prev, [data.userId]: data.userName || 'Someone' }))
    }

    // Stop typing — remove the user from the map
    const handleUserStopTyping = (data: { chatId: string; userId: string }) => {
      if (data.chatId !== chatId) return
      setTypingUsers(prev => {
        const next = { ...prev }
        delete next[data.userId]
        return next
      })
    }

    // 'connect' fires on the initial connection AND on every successful reconnect.
    // We only want the reconnect behaviour (re-join + re-fetch), not on first mount
    // (the initial load useEffect already handles that). Socket.IO sets
    // socket.recovered=true when the connection was restored transparently, but
    // we can't rely on that across all transports, so we always re-fetch.
    // The newMessage deduplication by id prevents double-rendering.
    socket.on('connect', handleReconnect)
    socket.on('newMessage', handleNewMessage)
    socket.on('messageEdited', handleMessageEdited)
    socket.on('messageDeleted', handleMessageDeleted)
    socket.on('chat:user_typing', handleUserTyping)
    socket.on('chat:user_stop_typing', handleUserStopTyping)
    socket.on('chat:renamed', handleRenamed)
    socket.on('chat:participant_removed', handleParticipantRemoved)
    socket.on('chat:read', handleChatRead)

    return () => {
      socket.off('connect', handleReconnect)
      socket.off('newMessage', handleNewMessage)
      socket.off('messageEdited', handleMessageEdited)
      socket.off('messageDeleted', handleMessageDeleted)
      socket.off('chat:user_typing', handleUserTyping)
      socket.off('chat:user_stop_typing', handleUserStopTyping)
      socket.off('chat:renamed', handleRenamed)
      socket.off('chat:participant_removed', handleParticipantRemoved)
      socket.off('chat:read', handleChatRead)
      socket.emit('chat:leave', { chatId })
      // Clear any pending typing timeout
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [chatId, user?.id, loadMessages, nav])

  // ── Initial load + scroll to bottom ───────────────────────────────────────
  useEffect(() => {
    if (!token) { nav('/login'); return }
    void loadMessages(1, false)
    if (chatId) {
      api.patch(`/chat/chats/${chatId}/read`).catch(() => {})
    }
    // FEAT-S2: load the current user's block list to know if other participant is blocked
    api.get<{ success: boolean; data: { blockedId: string }[] }>('/chat/blocks')
      .then(res => {
        const blocked = new Set((res.data.data ?? []).map((b: { blockedId: string }) => b.blockedId))
        if (otherUserId) setIsBlocked(blocked.has(otherUserId))
      })
      .catch(() => {})
  }, [token, nav, loadMessages, chatId, otherUserId])

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [loading])

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = content.trim()
    if (!text || !chatId || sending) return

    setSending(true)
    setContent('')
    // MED-3: clear the draft immediately on send attempt
    if (chatId) saveDraft(chatId, '')
    emitStopTyping()

    // MED-3: attempt the POST, retry once on failure before giving up
    const attemptSend = async (): Promise<Message> => {
      const res = await api.post<{ success: boolean; data: Message }>(
        `/chat/chats/${chatId}/messages`,
        { content: text }
      )
      return res.data.data
    }

    try {
      let message: Message
      try {
        message = await attemptSend()
      } catch {
        // First attempt failed — wait 800 ms then retry once
        await new Promise(resolve => setTimeout(resolve, 800))
        message = await attemptSend()
      }
      // Optimistically append (socket will also fire for other participants)
      setMessages(prev => [...prev, message])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch {
      // Both attempts failed — restore draft so the user doesn't lose their text
      setError('Failed to send message. Your text has been restored.')
      setContent(text)
      if (chatId) saveDraft(chatId, text)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ── Typing indicator emit ─────────────────────────────────────────────────
  // Emit 'chat:typing' on each keystroke, then debounce 'chat:stop_typing'
  // after 2 seconds of inactivity. Also emit stop on send/blur.
  //
  // LOW-3: the debounce callback checks mountedRef before emitting so it
  // never sends stop_typing to a room the user has already left (the race
  // where the 2s timer fires after the useEffect cleanup has run).
  const emitTyping = () => {
    const socket = getSocket()
    if (!socket || !chatId) return
    socket.emit('chat:typing', { chatId })
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return   // LOW-3: component already unmounted
      const s = getSocket()
      if (s) s.emit('chat:stop_typing', { chatId })
    }, 2000)
  }

  const emitStopTyping = () => {
    const socket = getSocket()
    if (!socket || !chatId) return
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    socket.emit('chat:stop_typing', { chatId })
  }

  // ── FEAT-S2: Block / unblock the other participant ───────────────────────
  const handleToggleBlock = async () => {
    if (!otherUserId || blockLoading) return
    setBlockLoading(true)
    try {
      if (isBlocked) {
        await api.delete(`/chat/blocks/${otherUserId}`)
        setIsBlocked(false)
      } else {
        await api.post(`/chat/blocks/${otherUserId}`)
        setIsBlocked(true)
      }
    } catch {
      // non-fatal — leave current state
    } finally {
      setBlockLoading(false)
    }
  }

  // ── Load older messages ───────────────────────────────────────────────────
  // MED-2: use loadedPageRef (client-controlled) instead of pagination.page
  // (server snapshot). hasMorePagesRef is set true only when the last fetch
  // returned a full page, so it stays correct even as real-time messages arrive.
  const handleLoadMore = () => {
    if (!hasMorePagesRef.current || loadingMore) return
    void loadMessages(loadedPageRef.current + 1, true)
  }

  // FEAT-S1: derive seen status for the sender's own messages.
  // A message is "seen" when every other participant's lastReadAt >= message.createdAt.
  // Returns 'seen' | 'sent' — only called for messages the current user sent.
  const getReadStatus = (msg: Message): 'seen' | 'sent' => {
    const msgTime = new Date(msg.createdAt).getTime()
    const others  = Object.entries(readMap).filter(([uid]) => uid !== user?.id)
    if (others.length === 0) return 'sent'
    const allSeen = others.every(([, ts]) => ts !== null && new Date(ts).getTime() >= msgTime)
    return allSeen ? 'seen' : 'sent'
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    return isToday
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
          ' ' +
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10 flex flex-col">
        <div className="flex flex-col flex-1 max-w-3xl w-full mx-auto px-4 md:px-8 py-4"
          style={{ height: 'calc(100vh - 3.5rem)' }}>

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-4 py-3 border-b border-gold/10 flex-shrink-0">
            <button onClick={() => nav('/chat')}
              className="p-2 rounded-sm text-ice/40 hover:text-gold transition-colors"
              style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)' }}>
              <ArrowLeft size={14} />
            </button>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {/* Avatar — relative so the online dot can anchor to it */}
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-sm flex items-center justify-center"
                  style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                  <MessageSquare size={13} className="text-gold" />
                </div>
                {/* FEAT-S4: green online dot for PRIVATE chats when other user is connected */}
                {chatType === 'PRIVATE' && otherUserOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-navy-950"
                    style={{ background: '#4ade80' }} title="Online" />
                )}
              </div>
              <div className="min-w-0">
                <p className="nav-label text-[0.55rem] text-gold/40 leading-none mb-0.5">CONVERSATION</p>
                <p className="font-display font-bold text-sm text-frost/90 truncate">{chatName}</p>
              </div>
            </div>

            {/* FEAT-S2: Block/unblock button — only for PRIVATE chats */}
            {chatType === 'PRIVATE' && otherUserId && (
              <button
                onClick={() => void handleToggleBlock()}
                disabled={blockLoading}
                className="flex-shrink-0 p-2 rounded-sm transition-colors disabled:opacity-40"
                style={isBlocked
                  ? { background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }
                  : { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', color: 'rgba(184,212,240,0.4)' }
                }
                title={isBlocked ? 'Unblock user' : 'Block user'}>
                {isBlocked ? <ShieldOff size={14} /> : <Shield size={14} />}
              </button>
            )}

            {/* Group manage button — only visible for GROUP chats */}
            {chatType === 'GROUP' && (
              <button
                onClick={() => nav(`/chat/${chatId}/manage`)}
                className="flex-shrink-0 p-2 rounded-sm text-ice/40 hover:text-gold transition-colors"
                style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)' }}
                title="Group settings">
                <Settings size={14} />
              </button>
            )}
          </motion.div>

          {/* Session expired banner — shown when socket token was rejected (SEC-7) */}
          {isSessionExpired && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-sm flex-shrink-0"
              style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }}>
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
              <p className="font-body text-xs text-red-400/90 flex-1">
                Your session has expired. Real-time messaging is paused.
              </p>
              <button
                onClick={() => { useAuthStore.getState().logout(); nav('/login') }}
                className="nav-label text-[0.55rem] px-3 py-1 rounded-sm transition-all flex-shrink-0"
                style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                RE-LOGIN
              </button>
            </motion.div>
          )}

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto space-y-3 pb-2 pr-1"
            style={{ minHeight: 0 }}>

            {/* Load more — MED-2: driven by hasMorePages state, not stale pagination.pages */}
            {hasMorePages && (
              <div className="text-center pt-2">
                <button onClick={handleLoadMore} disabled={loadingMore}
                  className="nav-label text-[0.55rem] px-4 py-1.5 rounded-sm transition-all disabled:opacity-50"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                  {loadingMore ? 'Loading...' : 'Load older messages'}
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={22} className="text-gold animate-spin" />
              </div>
            ) : error ? (
              <p className="text-center font-body text-sm text-red-400/70 py-10">{error}</p>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <MessageSquare size={32} className="text-ice/20 mb-3" />
                <p className="font-body text-sm text-ice/40">No messages yet.</p>
                <p className="font-body text-xs text-ice/25 mt-1">Be the first to say something.</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => {
                  const isMe = msg.senderId === user?.id
                  const showName =
                    !isMe &&
                    (i === 0 || messages[i - 1]?.senderId !== msg.senderId)

                  return (
                    <motion.div key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      {showName && (
                        <p className="nav-label text-[0.5rem] text-ice/40 mb-1 ml-1">
                          {msg.sender.name}
                        </p>
                      )}
                      <div className={`max-w-[75%] rounded-sm px-4 py-2.5 ${
                        isMe
                          ? 'rounded-br-none'
                          : 'rounded-bl-none'
                      }`}
                        style={isMe
                          ? { background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.25)' }
                          : { background: 'rgba(13,15,28,0.8)', border: '1px solid rgba(184,212,240,0.08)' }
                        }>
                        {msg.isDeleted ? (
                          <p className="font-body text-sm leading-snug italic"
                            style={{ color: isMe ? 'rgba(201,168,76,0.35)' : 'rgba(184,212,240,0.3)' }}>
                            Message deleted
                          </p>
                        ) : (
                          <p className="font-body text-sm leading-snug"
                            style={{ color: isMe ? '#e2c76e' : 'rgba(232,240,251,0.85)' }}>
                            {msg.content}
                          </p>
                        )}
                        <p className="nav-label text-[0.44rem] mt-1 flex items-center gap-1"
                          style={{ color: isMe ? 'rgba(201,168,76,0.5)' : 'rgba(184,212,240,0.25)' }}>
                          {formatTime(msg.createdAt)}
                          {msg.editedAt && !msg.isDeleted && (
                            <span className="italic opacity-70">(edited)</span>
                          )}
                          {/* FEAT-S1: read receipt ticks — only on sender's own messages */}
                          {isMe && !msg.isDeleted && (() => {
                            const status = getReadStatus(msg)
                            return (
                              <span title={status === 'seen' ? 'Seen' : 'Sent'}
                                style={{ color: status === 'seen' ? '#c9a84c' : 'rgba(201,168,76,0.35)', letterSpacing: '-0.05em' }}>
                                {status === 'seen' ? '✓✓' : '✓'}
                              </span>
                            )
                          })()}
                        </p>
                        </p>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="flex-shrink-0 pt-3 border-t border-gold/10">
            {/* Typing indicator */}
            {Object.keys(typingUsers).length > 0 && (
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                {/* Animated dots */}
                <span className="flex gap-0.5 items-end">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="w-1 h-1 rounded-full bg-ice/30"
                      style={{ animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                </span>
                <p className="nav-label text-[0.5rem] text-ice/35 italic">
                  {Object.values(typingUsers).join(', ')}
                  {Object.keys(typingUsers).length === 1 ? ' is typing…' : ' are typing…'}
                </p>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={content}
                onChange={e => {
                  setContent(e.target.value)
                  emitTyping()
                  // MED-3: persist draft on every keystroke so content survives
                  // accidental navigation, refresh, or a failed send.
                  if (chatId) saveDraft(chatId, e.target.value)
                }}
                onKeyDown={handleKeyDown}
                onBlur={emitStopTyping}
                placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                rows={1}
                className="uris-input flex-1 resize-none"
                style={{ minHeight: '2.75rem', maxHeight: '8rem', overflowY: 'auto' }}
                onInput={e => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 128) + 'px'
                }}
              />
              <motion.button
                onClick={() => void handleSend()}
                disabled={!content.trim() || sending}
                whileHover={content.trim() && !sending ? { scale: 1.05 } : {}}
                whileTap={content.trim() && !sending ? { scale: 0.95 } : {}}
                className="flex-shrink-0 w-11 h-11 rounded-sm flex items-center justify-center disabled:opacity-40 transition-all"
                style={{ background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.35)' }}>
                {sending
                  ? <Loader2 size={15} className="text-gold animate-spin" />
                  : <Send size={15} className="text-gold" />}
              </motion.button>
            </div>
            <p className="nav-label text-[0.45rem] text-ice/20 mt-1.5 text-right">
              Enter to send · Shift+Enter for new line
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
