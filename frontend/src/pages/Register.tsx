import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Diamond } from 'lucide-react'
import Starfield from '../components/Starfield'
import { authAPI } from '../api/endpoints'
import { useAuthStore } from '../store/authStore'
import { extractErrorMessage } from '../services/error'

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'TECHNICAL_INTERN' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingApproval, setPendingApproval] = useState(false)
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await authAPI.register(form)
      const data = res.data.data as { pending?: boolean; token?: string; user: Parameters<typeof login>[1] }

      if (data.pending) {
        // Admin registration — awaiting approval, no token issued
        setPendingApproval(true)
        return
      }

      login(data.token!, data.user)
      navigate(data.user.role.includes('INTERN') ? '/availability' : '/dashboard')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Registration failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4 relative overflow-hidden">
        <Starfield />
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full max-w-md">
          <div className="glass-card rounded-sm p-10 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)' }}>
              <Diamond size={24} className="text-gold" />
            </motion.div>
            <h2 className="font-display font-black text-2xl text-ice-gradient mb-3">Access Requested</h2>
            <div className="gold-rule w-16 mx-auto mb-4" />
            <p className="font-body text-sm text-ice/50 mb-2">
              Your admin account has been created and is pending approval.
            </p>
            <p className="font-body text-sm text-ice/40 mb-8">
              An existing admin will review your request. You'll be able to log in once approved.
            </p>
            <Link to="/login">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="btn-outline px-8 py-3 rounded-sm text-sm">
                BACK TO LOGIN
              </motion.button>
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4 relative overflow-hidden">
      <Starfield />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,168,76,0.06) 0%, transparent 70%)' }} />

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }} className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <div className="signal-badge inline-flex mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse-slow" />
            <Diamond size={8} className="text-gold" />
            <span className="nav-label text-[0.6rem] text-ice/60">NEW REGISTRATION</span>
          </div>
          <h1 className="font-display font-black text-5xl text-ice-gradient mb-2">URIS</h1>
          <div className="gold-rule w-20 mx-auto my-3" />
          <p className="nav-label text-[0.65rem] text-ice/40 tracking-widest">CREATE YOUR ACCOUNT</p>
        </div>

        <div className="glass-card rounded-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {[
              { label: 'FULL NAME', key: 'name', type: 'text', placeholder: 'Your full name' },
              { label: 'EMAIL ADDRESS', key: 'email', type: 'email', placeholder: 'you@company.com' },
              { label: 'PASSWORD', key: 'password', type: 'password', placeholder: '••••••••' },
            ].map(f => (
              <div key={f.key}>
                <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">{f.label}</label>
                <input type={f.type} className="uris-input" placeholder={f.placeholder}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => update(f.key, e.target.value)} required />
              </div>
            ))}

            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">ROLE</label>
              <select
                className="uris-input w-full"
                value={form.role}
                onChange={e => update('role', e.target.value)}
              >
                <optgroup label="Admins">
                  <option value="CORE_ADMIN">Core Admin</option>
                </optgroup>
                <optgroup label="Leads & Managers">
                  <option value="OPERATIONS_PROGRAM_MANAGER">Operations Program Manager</option>
                  <option value="TECHNICAL_LEAD">Technical Lead</option>
                  <option value="OPERATIONS_LEAD">Operations Lead</option>
                  <option value="RESEARCH_LEAD">Research Lead</option>
                  <option value="OBSERVER_TEAM_LEAD">Observer Team Lead</option>
                  <option value="COLLABORATOR_LEAD">Collaborator Lead</option>
                </optgroup>
                <optgroup label="Interns">
                  <option value="TECHNICAL_INTERN">Technical Intern</option>
                  <option value="OPERATIONS_INTERN">Operations Intern</option>
                  <option value="RESEARCH_INTERN">Research Intern</option>
                  <option value="ORENDA_MEMBER">Orenda Member</option>
                </optgroup>
              </select>
            </div>

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="font-body text-sm text-red-400/80 text-center py-2 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                {error}
              </motion.p>
            )}

            <motion.button type="submit" disabled={loading}
              whileHover={!loading ? { scale: 1.02, boxShadow: '0 8px 28px rgba(201,168,76,0.3)' } : {}}
              whileTap={!loading ? { scale: 0.98 } : {}}
              className="btn-gold w-full py-3 rounded-sm mt-2 disabled:opacity-50">
              {loading ? 'REGISTERING...' : 'CREATE ACCOUNT'}
            </motion.button>
          </form>

          <div className="mt-6 text-center">
            <p className="font-body text-sm text-ice/30">
              Already have access?{' '}
              <Link to="/login" className="text-gold/70 hover:text-gold transition-colors no-underline">Sign in</Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
