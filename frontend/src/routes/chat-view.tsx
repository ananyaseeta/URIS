import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken, selectUser } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { ArrowLeft, Send, Loader2, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
// Use the existing singleton socket from socket.service — no second connection.
// The realtimeStore already connects this socket on login.
import { getSocket } from '../services/socket.service'

interface Message {
  id: string
  chatId: string
  senderId: string
  content: string
  createdAt: string
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

export default function ChatViewPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const token = useAuthStore(selectToken)
  const user  = useAuthStore(selectUser)
  const nav   = useNavigate()

  const [messages, setMessages]   = useState<Message[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sending, setSending]     = useState(false)
  const [content, setContent]     = useState('')
  const [error, setError]         = useState('')
  const [chatName, setChatName]   = useState('')

  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)

  // ── Load messages ──────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (page = 1, append = false) => {
    if (!chatId) return
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true)
      const res = await api.get<{
        success: boolean
        data: { messages: Message[]; pagination: Pagination }
      }>(`/chat/chats/${chatId}/messages?page=${page}&limit=50`)

      const { messages: msgs, pagination: pg } = res.data.data
      // Messages come back newest-first — reverse for display
      const ordered = [...msgs].reverse()
      setMessages(prev => append ? [...ordered, ...prev] : ordered)
      setPagination(pg)
    } catch {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [chatId])

  // ── Load chat name from chats list ─────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return
    api.get<{ success: boolean; data: { id: string; type: string; name?: string }[] }>('/chat/chats')
      .then(res => {
        const chat = (res.data.data ?? []).find(c => c.id === chatId)
        setChatName(chat?.name ?? (chat?.type === 'PRIVATE' ? 'Private Chat' : 'Group Chat'))
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

    // Join the chat room on the shared socket
    // The server validates ChatParticipant membership before allowing the join
    socket.emit('chat:join', { chatId })

    const handleNewMessage = (data: { message: Message; chatId: string }) => {
      if (data.chatId !== chatId) return
      // Skip if already appended optimistically by the sender (BUG-C1 fix)
      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) return prev
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        return [...prev, data.message]
      })
    }

    socket.on('newMessage', handleNewMessage)

    return () => {
      socket.off('newMessage', handleNewMessage)
      socket.emit('chat:leave', { chatId })
    }
  }, [chatId])

  // ── Initial load + scroll to bottom ───────────────────────────────────────
  useEffect(() => {
    if (!token) { nav('/login'); return }
    void loadMessages(1, false)
  }, [token, nav, loadMessages])

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
    try {
      const res = await api.post<{ success: boolean; data: Message }>(
        `/chat/chats/${chatId}/messages`,
        { content: text }
      )
      // Optimistically append (socket will also fire for other participants)
      setMessages(prev => [...prev, res.data.data])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch {
      setError('Failed to send message')
      setContent(text) // restore on failure
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

  // ── Load older messages ───────────────────────────────────────────────────
  const handleLoadMore = () => {
    if (!pagination || pagination.page >= pagination.pages) return
    void loadMessages(pagination.page + 1, true)
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
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-sm flex items-center justify-center"
                style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                <MessageSquare size={13} className="text-gold" />
              </div>
              <div>
                <p className="nav-label text-[0.55rem] text-gold/40 leading-none mb-0.5">CONVERSATION</p>
                <p className="font-display font-bold text-sm text-frost/90">{chatName}</p>
              </div>
            </div>
          </motion.div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto space-y-3 pb-2 pr-1"
            style={{ minHeight: 0 }}>

            {/* Load more */}
            {pagination && pagination.page < pagination.pages && (
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
                        <p className="font-body text-sm leading-snug"
                          style={{ color: isMe ? '#e2c76e' : 'rgba(232,240,251,0.85)' }}>
                          {msg.content}
                        </p>
                        <p className="nav-label text-[0.44rem] mt-1"
                          style={{ color: isMe ? 'rgba(201,168,76,0.5)' : 'rgba(184,212,240,0.25)' }}>
                          {formatTime(msg.createdAt)}
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
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
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
