import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Globe, Save, CheckCircle2, User, Phone, Briefcase, Plus, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import { extractErrorMessage } from '../services/error'
import { useAuthStore } from '../store/authStore'

interface PortfolioData {
  slug: string
  bio: string
  profilePic: string
  contactNumber: string
  linkedinUrl: string
  skills: string[]
}

export default function PortfolioEdit() {
  const user = useAuthStore(s => s.user)
  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newSkill, setNewSkill] = useState('')

  const fetchPortfolio = async () => {
    setLoading(true)
    try {
      // We'll use the profile endpoint or a specific portfolio/me endpoint
      const res = await api.get('/portfolio/me')
      if (res.data.success) {
        setData(res.data.data)
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load portfolio data.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchPortfolio() }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.patch('/portfolio/me', data)
      if (res.data.success) {
        setSuccess('Portfolio updated successfully!')
        setTimeout(() => setSuccess(''), 3000)
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save portfolio.'))
    } finally {
      setSaving(false)
    }
  }

  const addSkill = () => {
    if (!newSkill.trim() || !data) return
    if (data.skills.includes(newSkill.trim())) return
    setData({ ...data, skills: [...data.skills, newSkill.trim()] })
    setNewSkill('')
  }

  const removeSkill = (skill: string) => {
    if (!data) return
    setData({ ...data, skills: data.skills.filter(s => s !== skill) })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center">
        <Loader2 className="text-gold animate-spin" />
      </div>
    )
  }

  const portfolioUrl = data?.slug
    ? `${window.location.origin}/portfolio/${data.slug}`
    : null

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <p className="nav-label text-[0.55rem] text-gold/40 tracking-ultra mb-1">PERSONAL BRANDING</p>
            <h1 className="font-display font-black text-3xl text-ice-gradient">Public Portfolio</h1>
            <div className="gold-rule w-14 mt-2" />
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Form Column */}
            <div className="md:col-span-2 space-y-6">
              <form onSubmit={handleSave} className="glass-card rounded-sm p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">DISPLAY NAME</label>
                    <input className="uris-input opacity-60" value={user?.name} disabled />
                  </div>
                  <div>
                    <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">PORTFOLIO SLUG</label>
                    <input className="uris-input opacity-60" value={data?.slug} disabled />
                  </div>
                </div>

                <div>
                  <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">PROFILE PICTURE URL</label>
                  <div className="relative">
                    <User size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ice/30 pointer-events-none" />
                    <input className="uris-input" style={{ paddingLeft: '2.25rem' }} placeholder="https://..." value={data?.profilePic || ''}
                      onChange={e => setData(d => d ? { ...d, profilePic: e.target.value } : null)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">LINKEDIN URL</label>
                    <div className="relative">
                      <Globe size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ice/30 pointer-events-none" />
                      <input className="uris-input" style={{ paddingLeft: '2.25rem' }} placeholder="linkedin.com/in/..." value={data?.linkedinUrl || ''}
                        onChange={e => setData(d => d ? { ...d, linkedinUrl: e.target.value } : null)} />
                    </div>
                  </div>
                  <div>
                    <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">CONTACT NUMBER</label>
                    <div className="relative">
                      <Phone size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ice/30 pointer-events-none" />
                      <input className="uris-input" style={{ paddingLeft: '2.25rem' }} placeholder="+1..." value={data?.contactNumber || ''}
                        onChange={e => setData(d => d ? { ...d, contactNumber: e.target.value } : null)} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">PROFESSIONAL BIO</label>
                  <textarea rows={4} className="uris-input resize-none" placeholder="Tell the world about your experience at STEMONEF..."
                    value={data?.bio || ''} onChange={e => setData(d => d ? { ...d, bio: e.target.value } : null)} />
                </div>

                <div>
                  <label className="nav-label text-[0.55rem] text-gold/60 block mb-1.5">SKILLS & TECHNOLOGIES</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {data?.skills.map(s => (
                      <span key={s} className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-gold/10 border border-gold/20 text-gold text-[0.65rem]">
                        {s}
                        <button type="button" onClick={() => removeSkill(s)} className="hover:text-white transition-colors">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input className="uris-input flex-1 text-xs" placeholder="Add a skill (e.g. React, Python)..."
                      value={newSkill} onChange={e => setNewSkill(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill())} />
                    <button type="button" onClick={addSkill} className="btn-outline px-3 rounded-sm">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {error && <p className="text-red-400 text-xs italic">{error}</p>}
                {success && <p className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 size={12} /> {success}</p>}

                <motion.button type="submit" disabled={saving} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="btn-gold w-full py-3 rounded-sm flex items-center justify-center gap-2">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'SAVING...' : 'SAVE PORTFOLIO'}
                </motion.button>
              </form>
            </div>

            {/* Preview Column */}
            <div className="space-y-6">
              <div className="glass-card rounded-sm p-6 text-center">
                <p className="nav-label text-[0.55rem] text-gold/40 mb-4 uppercase">Your QR Code</p>
                {portfolioUrl ? (
                  <>
                    <div className="bg-white p-4 rounded-sm inline-block mb-4 shadow-xl shadow-gold/5">
                      <QRCodeSVG value={portfolioUrl} size={150} level="H" />
                    </div>
                    <p className="font-body text-xs text-ice/40 px-4 mb-4">Scan this to view your professional portfolio from any device.</p>
                    <a href={portfolioUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 text-gold hover:text-white transition-all text-xs font-bold">
                      <Globe size={12} /> VIEW PUBLIC PAGE
                    </a>
                  </>
                ) : (
                  <p className="font-body text-xs text-ice/30 px-4">Save your portfolio to generate a public link.</p>
                )}
              </div>

              <div className="glass-card rounded-sm p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-sm bg-gold/10 flex items-center justify-center">
                    <Briefcase size={18} className="text-gold" />
                  </div>
                  <div>
                    <p className="nav-label text-[0.5rem] text-gold/40 uppercase">Task History</p>
                    <p className="font-display text-sm text-frost">Automatic Showcase</p>
                  </div>
                </div>
                <p className="font-body text-[0.7rem] text-ice/40 leading-relaxed">
                  Your public portfolio automatically displays all completed tasks you've worked on during your internship. This helps verify your experience to future employers.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center gap-4 opacity-40">
            <div className="h-[1px] w-12 bg-gold/20" />
            <span className="font-display font-black text-xs tracking-[0.4em] text-ice-gradient">STEMONEF</span>
          </div>
        </div>
      </main>
    </div>
  )
}
