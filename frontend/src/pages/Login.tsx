import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Diamond, ArrowLeft } from 'lucide-react'
import Starfield from '../components/Starfield'
import { authAPI } from '../api/endpoints'
import { useAuthStore } from '../store/authStore'
import { extractErrorMessage } from '../services/error'

export default function Login() {
  const [showPw, setShowPw] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await authAPI.login(email, password)
      const { token, user } = res.data.data as { token: string; user: { id: string; name: string; email: string; role: string } }
      login(token, user as Parameters<typeof login>[1])
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Invalid credentials. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4 relative overflow-hidden">
      <Starfield />
      {/* Back to Home */}
      <Link to="/"
        className="absolute top-4 left-4 z-20 flex items-center gap-1.5 nav-label text-[0.6rem] text-ice/40 hover:text-gold transition-colors">
        <ArrowLeft size={12} />
        BACK TO HOME
      </Link>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,168,76,0.06) 0%, transparent 70%)' }} />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }}
            className="signal-badge inline-flex mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
            <Diamond size={8} className="text-gold" />
            <span className="nav-label text-[0.6rem] text-ice/60">SECURE ACCESS</span>
          </motion.div>
          <h1 className="font-display font-black text-5xl text-ice-gradient mb-2">URIS</h1>
          <div className="gold-rule w-20 mx-auto my-3" />
          <p className="nav-label text-[0.65rem] text-ice/40 tracking-widest">UNIFIED RESOURCE INTELLIGENCE SYSTEM</p>
        </div>

        <div className="glass-card rounded-sm p-8">
          <div className="mb-4">
            <p className="nav-label text-[0.65rem] text-ice/40 text-center tracking-widest">LOGIN TO YOUR ACCOUNT</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">EMAIL ADDRESS</label>
              <input type="email" className="uris-input" placeholder="you@company.com"
                value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                disabled={loading} required />
            </div>
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">PASSWORD</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className="uris-input pr-10" placeholder="••••••••"
                  value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
                  disabled={loading} required />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ice/30 hover:text-gold transition-colors">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="font-body text-sm text-red-400/80 text-center py-2 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                {error}
              </motion.p>
            )}

            <motion.button type="submit" disabled={loading || !email.trim() || !password}
              whileHover={!(loading || !email.trim() || !password) ? { scale: 1.02, boxShadow: '0 8px 28px rgba(201,168,76,0.3)' } : {}}
              whileTap={!(loading || !email.trim() || !password) ? { scale: 0.98 } : {}}
              className="btn-gold w-full py-3 rounded-sm mt-2 disabled:opacity-50">
              {loading ? 'AUTHENTICATING...' : 'ENTER SYSTEM'}
            </motion.button>
          </form>

          <div className="mt-6 text-center">
            <p className="font-body text-sm text-ice/30">
              New intern?{' '}
              <Link to="/register" className="text-gold/70 hover:text-gold transition-colors no-underline">Request access</Link>
            </p>
            <p className="font-body text-sm text-ice/20 mt-2">
              <Link to="/forgot-password" className="text-ice/40 hover:text-gold/70 transition-colors no-underline text-xs">
                Forgot your password?
              </Link>
            </p>
          </div>
        </div>
        <p className="text-center nav-label text-[0.5rem] text-ice/15 mt-6 tracking-ultra">
          SELF-HOSTED · PRIVACY-COMPLIANT · V3 ARCHITECTURE
        </p>
      </motion.div>
    </div>
  )
}
