import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, selectToken } from '../store/authStore'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { Search, ArrowLeft, MessageSquare, Users, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface SearchResult {
  id: string
  chatId: string
  senderId: string
  content: string
  createdAt: string
  sender: { id: string; name: string }
  chat:   { id: string; type: string; name: string | null }
}

export default function ChatSearchPage() {
  const token = useAuthStore(selectToken)
  const nav   = useNavigate()

  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!token) nav('/login')
  }, [token, nav])

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError('')
    setSearched(false)
    try {
      const res = await api.get<{
        success: boolean
        data: { results: SearchResult[]; query: string; count: number }
      }>(`/chat/search?q=${encodeURIComponent(q)}`)
      setResults(res.data.data.results ?? [])
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSearch()
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Highlight matching query text in message content
  const highlight = (text: string, q: string) => {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'rgba(201,168,76,0.35)', color: '#e2c76e', borderRadius: '2px', padding: '0 2px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  // Group results by chat
  const byChat = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.chatId]) acc[r.chatId] = []
    acc[r.chatId].push(r)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">

          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <button onClick={() => nav('/chat')}
              className="flex items-center gap-2 mb-4 text-ice/40 hover:text-gold transition-colors">
              <ArrowLeft size={14} />
              <span className="nav-label text-[0.55rem]">BACK TO CHAT</span>
            </button>
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">COMMUNICATION</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Search Messages</h1>
            <div className="gold-rule w-14 mt-2" />
            <p className="font-body text-sm text-ice/40 mt-3">Search across all your conversations</p>
          </motion.div>

          {/* Search bar */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="glass-card rounded-sm p-4 mb-6">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ice/40 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search all conversations..."
                  className="uris-input w-full"
                  style={{ paddingLeft: '2.25rem' }}
                  autoFocus
                />
              </div>
              <button
                onClick={() => void handleSearch()}
                disabled={!query.trim() || loading}
                className="flex items-center gap-2 px-4 py-2 rounded-sm transition-all disabled:opacity-40"
                style={{ background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c' }}>
                {loading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Search size={14} />}
                <span className="nav-label text-[0.55rem]">SEARCH</span>
              </button>
            </div>
          </motion.div>

          {/* Results */}
          {error && (
            <p className="text-sm text-red-400/70 text-center py-4">{error}</p>
          )}

          {searched && !loading && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search size={32} className="text-ice/20 mb-3" />
              <p className="font-body text-sm text-ice/40">No messages found for "{query}"</p>
            </div>
          )}

          <AnimatePresence>
            {Object.entries(byChat).map(([chatId, msgs]) => {
              const firstMsg = msgs[0]
              const chatLabel = firstMsg.chat.type === 'PRIVATE'
                ? firstMsg.sender.name
                : (firstMsg.chat.name ?? 'Group Chat')

              return (
                <motion.div
                  key={chatId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card rounded-sm p-5 mb-4">

                  {/* Chat header */}
                  <button
                    onClick={() => nav(`/chat/${chatId}`)}
                    className="flex items-center gap-2 mb-3 w-full text-left group">
                    <div className="w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                      {firstMsg.chat.type === 'PRIVATE'
                        ? <MessageSquare size={11} className="text-gold" />
                        : <Users size={11} className="text-gold" />}
                    </div>
                    <span className="font-display font-bold text-sm text-ice group-hover:text-gold transition-colors">
                      {chatLabel}
                    </span>
                    <span className="nav-label text-[0.45rem] text-ice/30 ml-auto">
                      {msgs.length} result{msgs.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Matching messages */}
                  <div className="space-y-2">
                    {msgs.map(msg => (
                      <button
                        key={msg.id}
                        onClick={() => nav(`/chat/${chatId}`)}
                        className="w-full text-left rounded-sm px-3 py-2.5 transition-colors"
                        style={{ background: 'rgba(13,15,28,0.6)', border: '1px solid rgba(184,212,240,0.06)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="nav-label text-[0.5rem] text-gold/60">{msg.sender.name}</p>
                          <p className="nav-label text-[0.44rem] text-ice/30">{formatTime(msg.createdAt)}</p>
                        </div>
                        <p className="font-body text-xs text-ice/70 leading-snug line-clamp-3">
                          {highlight(msg.content, query.trim())}
                        </p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

        </div>
      </main>
    </div>
  )
}
