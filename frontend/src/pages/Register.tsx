import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Diamond, ArrowLeft, Camera, User, Eye, EyeOff, Check } from 'lucide-react'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { extractErrorMessage } from '../services/error'

const GDOC_PREFIX = 'https://docs.google.com/document/d/'
const INTERN_ROLES = new Set(['TECHNICAL_INTERN', 'RESEARCH_INTERN'])

export default function Register() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'TECHNICAL_INTERN',
    dateOfBirth: '',
    joiningDate: '',
    gdocUrl: '',
  })
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [profilePicture, setProfilePicture] = useState<File | null>(null)
  const [picturePreview, setPicturePreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{ name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)

  const update = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setError('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile picture must be under 5 MB.')
      return
    }
    setProfilePicture(file)
    setPicturePreview(URL.createObjectURL(file))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    // Validate password meets all checklist requirements
    const password = form.password
    const hasMinLength = password.length >= 8
    const hasUppercase = /[A-Z]/.test(password)
    const hasLowercase = /[a-z]/.test(password)
    const hasNumber = /[0-9]/.test(password)
    const hasSpecial = /[^A-Za-z0-9]/.test(password)
    if (!hasMinLength || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      setError('Password must meet all checklist requirements.')
      return
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    // Validate profile picture required
    if (!profilePicture) {
      setError('A profile picture is required.')
      return
    }

    // Validate DOB is in the past
    if (form.dateOfBirth) {
      const dob = new Date(form.dateOfBirth)
      if (dob >= new Date()) {
        setError('Date of birth must be in the past.')
        return
      }
    }

    // Validate GDoc URL for intern roles
    if (INTERN_ROLES.has(form.role) && form.gdocUrl) {
      if (!form.gdocUrl.startsWith(GDOC_PREFIX)) {
        setError('Google Docs URL must begin with https://docs.google.com/document/d/')
        return
      }
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('name', form.name)
      formData.append('email', form.email)
      formData.append('password', form.password)
      formData.append('role', form.role)
      if (form.dateOfBirth) formData.append('dateOfBirth', form.dateOfBirth)
      if (form.joiningDate) formData.append('joiningDate', form.joiningDate)
      if (INTERN_ROLES.has(form.role) && form.gdocUrl) formData.append('gdocUrl', form.gdocUrl)
      formData.append('profilePicture', profilePicture)

      const res = await api.post('/auth/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data = res.data.data as { pending?: boolean; token?: string; user: Parameters<typeof login>[1] & { name: string } }

      if (data.pending) {
        setPendingApproval({ name: data.user.name || form.name })
        return
      }

      login(data.token!, data.user)
      navigate('/dashboard')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Registration failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const metCount = [
    form.password.length >= 8,
    /[A-Z]/.test(form.password),
    /[a-z]/.test(form.password),
    /[0-9]/.test(form.password),
    /[^A-Za-z0-9]/.test(form.password)
  ].filter(Boolean).length

  const isSubmitDisabled =
    loading ||
    !form.name.trim() ||
    !form.email.trim() ||
    !form.password ||
    !confirmPassword ||
    !profilePicture ||
    form.password !== confirmPassword ||
    metCount < 5

  // ── Pending approval screen ───────────────────────────────────────────────
  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4 relative overflow-hidden">
        <Starfield />
        <Link to="/"
          className="absolute top-4 left-4 z-20 flex items-center gap-1.5 nav-label text-[0.6rem] text-ice/40 hover:text-gold transition-colors">
          <ArrowLeft size={12} />
          BACK TO HOME
        </Link>
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
              Welcome, {pendingApproval.name}. Your account is pending approval.
            </p>
            <p className="font-body text-sm text-ice/40 mb-8">
              An admin or lead will review your request. You'll be able to log in once approved.
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

  // ── Registration form ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center px-4 relative overflow-hidden">
      <Starfield />
      <Link to="/"
        className="absolute top-4 left-4 z-20 flex items-center gap-1.5 nav-label text-[0.6rem] text-ice/40 hover:text-gold transition-colors">
        <ArrowLeft size={12} />
        BACK TO HOME
      </Link>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201,168,76,0.06) 0%, transparent 70%)' }} />

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }} className="relative z-10 w-full max-w-md my-8">
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

            {/* Full Name */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">FULL NAME</label>
              <input type="text" className="uris-input" placeholder="Your full name"
                value={form.name} onChange={e => update('name', e.target.value)}
                disabled={loading} required />
            </div>

            {/* Email */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">EMAIL ADDRESS</label>
              <input type="email" className="uris-input" placeholder="you@company.com"
                value={form.email} onChange={e => update('email', e.target.value)}
                disabled={loading} required />
            </div>

            {/* Password */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">PASSWORD</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className="uris-input pr-10" placeholder="Min. 8 characters"
                  value={form.password} onChange={e => update('password', e.target.value)}
                  disabled={loading} required />
                <button type="button" onClick={() => setShowPw(!showPw)} disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ice/30 hover:text-gold transition-colors">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              {/* Password strength & checklist */}
              {form.password.length > 0 && (
                <>
                  {/* Strength indicator */}
                  <div className="mt-2.5 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="nav-label text-[0.55rem] text-ice/40">PASSWORD STRENGTH</span>
                      <span className={`nav-label text-[0.55rem] font-bold ${
                        metCount <= 2 ? 'text-red-400' :
                        metCount === 3 ? 'text-amber-500' :
                        metCount === 4 ? 'text-gold/80' : 'text-gold'
                      }`}>
                        {metCount <= 2 ? 'WEAK' :
                         metCount === 3 ? 'MEDIUM' :
                         metCount === 4 ? 'STRONG' : 'VERY STRONG'}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[1, 2, 3, 4].map(idx => {
                        const activeSegments = metCount <= 2 ? 1 : metCount === 3 ? 2 : metCount === 4 ? 3 : 4;
                        const barColor = metCount <= 2 ? 'bg-red-500' : metCount === 3 ? 'bg-amber-500' : metCount === 4 ? 'bg-gold/80' : 'bg-gold';
                        return (
                          <div
                            key={idx}
                            className={`h-1 rounded-sm transition-all duration-300 ${
                              idx <= activeSegments ? barColor : 'bg-navy-900/50'
                            }`}
                            style={{ border: '1px solid rgba(201,168,76,0.05)' }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {[
                      { label: '8+ characters', met: form.password.length >= 8 },
                      { label: 'Uppercase letter', met: /[A-Z]/.test(form.password) },
                      { label: 'Lowercase letter', met: /[a-z]/.test(form.password) },
                      { label: 'Number', met: /[0-9]/.test(form.password) },
                      { label: 'Special character', met: /[^A-Za-z0-9]/.test(form.password) },
                    ].map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        {c.met ? (
                          <Check size={10} className="text-gold shrink-0" />
                        ) : (
                          <span className="w-2.5 h-2.5 flex items-center justify-center shrink-0">
                            <span className="w-1 h-1 rounded-full bg-ice/20" />
                          </span>
                        )}
                        <span className={`font-body text-[0.65rem] transition-colors ${c.met ? 'text-gold/80' : 'text-ice/40'}`}>
                          {c.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">CONFIRM PASSWORD</label>
              <div className="relative">
                <input type={showConfirmPw ? 'text' : 'password'} className="uris-input pr-10" placeholder="Re-enter password"
                  value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                  disabled={loading} required />
                <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ice/30 hover:text-gold transition-colors">
                  {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {confirmPassword && (
                <p className={`nav-label text-[0.55rem] mt-1.5 flex items-center gap-1 ${
                  form.password === confirmPassword ? 'text-gold/80' : 'text-red-400/80'
                }`}>
                  {form.password === confirmPassword ? (
                    <>
                      <Check size={10} className="shrink-0" /> PASSWORDS MATCH
                    </>
                  ) : (
                    'PASSWORDS DO NOT MATCH'
                  )}
                </p>
              )}
            </div>

            {/* Role — restricted to TECHNICAL_INTERN and RESEARCH_INTERN */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">ROLE</label>
              <select className="uris-input w-full" value={form.role}
                onChange={e => update('role', e.target.value)} disabled={loading}>
                <option value="TECHNICAL_INTERN">Technical Intern</option>
                <option value="RESEARCH_INTERN">Research Intern</option>
              </select>
              <p className="nav-label text-[0.5rem] text-ice/25 mt-1.5">
                Admin and lead accounts are created internally by Core Admin.
              </p>
            </div>

            {/* Date of Birth */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">DATE OF BIRTH</label>
              <input type="date" className="uris-input"
                value={form.dateOfBirth}
                onChange={e => update('dateOfBirth', e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                disabled={loading}
              />
            </div>

            {/* Joining Date */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">JOINING DATE</label>
              <input type="date" className="uris-input"
                value={form.joiningDate}
                onChange={e => update('joiningDate', e.target.value)}
                disabled={loading}
              />
            </div>

            {/* GDoc URL — only for intern roles */}
            {INTERN_ROLES.has(form.role) && (
              <div>
                <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">GOOGLE DOCS WORK LOG URL</label>
                <input type="url" className="uris-input"
                  placeholder="https://docs.google.com/document/d/..."
                  value={form.gdocUrl}
                  onChange={e => update('gdocUrl', e.target.value)}
                  disabled={loading}
                />
                <p className="nav-label text-[0.5rem] text-ice/25 mt-1.5">
                  Link to your Google Docs work log document.
                </p>
              </div>
            )}

            {/* Profile Picture — required */}
            <div>
              <label className="nav-label text-[0.6rem] text-gold/60 block mb-2">
                PROFILE PICTURE <span className="text-red-400/70">*</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileChange}
                disabled={loading}
              />
              <div className="flex items-center gap-4">
                {/* Preview */}
                <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}>
                  {picturePreview ? (
                    <img src={picturePreview} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <User size={24} className="text-gold/30" />
                  )}
                </div>
                <div className="flex-1">
                  <motion.button type="button" whileHover={!loading ? { scale: 1.02 } : {}} whileTap={!loading ? { scale: 0.98 } : {}}
                    onClick={() => fileInputRef.current?.click()} disabled={loading}
                    className="flex items-center gap-2 btn-outline px-4 py-2 rounded-sm text-sm w-full justify-center">
                    <Camera size={13} />
                    {profilePicture ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'}
                  </motion.button>
                  <p className="nav-label text-[0.5rem] text-ice/25 mt-1.5 text-center">
                    JPEG, PNG, WebP · Max 5 MB · Required
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="font-body text-sm text-red-400/80 text-center py-2 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                {error}
              </motion.p>
            )}

            <motion.button type="submit" disabled={isSubmitDisabled}
              whileHover={!isSubmitDisabled ? { scale: 1.02, boxShadow: '0 8px 28px rgba(201,168,76,0.3)' } : {}}
              whileTap={!isSubmitDisabled ? { scale: 0.98 } : {}}
              className="btn-gold w-full py-3 rounded-sm mt-2 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
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
