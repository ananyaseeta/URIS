import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutDashboard, CalendarDays, ClipboardList, Star, Users, Bell, LogOut, ChevronRight, ShieldCheck, ScrollText, TrendingUp, Shield, Menu, X, UserCircle, Settings, Wifi, MessageSquare, AlertTriangle, BookOpen } from 'lucide-react'
import { useAuthStore, selectUser, selectIsAdmin } from '../store/authStore'
import { useAlertStore } from '../store/alertStore'
import { useRealtimeStore } from '../store/realtimeStore'
import TeamSwitcher from './TeamSwitcher'

import { getPermissions } from '../utils/permissions'
import { getPendingUsers } from '../services/admin.service'

// ── Nav item definitions ───────────────────────────────────────────────────────
// Labels are user-goal-facing (not backend/system names).
// Icons are unique per item — Portfolio uses BookOpen, not LayoutDashboard.
// Order here is the FALLBACK order; role-specific ordering is applied below.

const NAV_ITEM_MAP: Record<string, { icon: React.ElementType; label: string }> = {
  '/dashboard':     { icon: LayoutDashboard, label: 'Dashboard'        },
  '/availability':  { icon: CalendarDays,    label: 'My Schedule'      },
  '/tasks':         { icon: ClipboardList,   label: 'Tasks'            },
  '/notifications': { icon: Bell,            label: 'Notifications'    },
  '/chat':          { icon: MessageSquare,   label: 'Chat'             },
  '/review':        { icon: Star,            label: 'Reviews'          },
  '/team':          { icon: Users,           label: 'Team'             },
  '/alerts':        { icon: AlertTriangle,   label: 'Alerts'           },
  '/admin':         { icon: ShieldCheck,     label: 'Controls'         },
  '/intelligence':  { icon: TrendingUp,      label: 'Intelligence'     }, // overridden per role below
  '/governance':    { icon: Shield,          label: 'Rules & Policies' },
  '/audit-logs':    { icon: ScrollText,      label: 'Activity Log'     },
  '/integrations':  { icon: Wifi,            label: 'Integrations'     },
  '/portfolio-edit':{ icon: BookOpen,        label: 'My Portfolio'     },
  '/profile':       { icon: UserCircle,      label: 'Profile'          },
  '/settings':      { icon: Settings,        label: 'Settings'         },
}

// Route order per role — drives the menu sequence.
// Roles not listed fall back to the permissions modules array order.
const ROLE_ORDER: Record<string, string[]> = {
  // Intern
  technical_intern: [
    '/dashboard', '/availability', '/tasks', '/notifications',
    '/chat', '/portfolio-edit', '/profile', '/settings',
  ],
  operations_intern: [
    '/dashboard', '/availability', '/tasks', '/notifications',
    '/chat', '/portfolio-edit', '/profile', '/settings',
  ],
  research_intern: [
    '/dashboard', '/availability', '/tasks', '/notifications',
    '/chat', '/portfolio-edit', '/profile', '/settings',
  ],
  orenda_member: [
    '/dashboard', '/availability', '/tasks', '/notifications',
    '/chat', '/portfolio-edit', '/profile', '/settings',
  ],

  // Leads — Team promoted above Tasks per audit recommendation
  technical_lead: [
    '/dashboard', '/team', '/tasks', '/review',
    '/alerts', '/intelligence', '/chat', '/profile', '/settings',
  ],
  research_lead: [
    '/dashboard', '/team', '/tasks', '/review',
    '/alerts', '/intelligence', '/chat', '/profile', '/settings',
  ],
  operations_lead: [
    '/dashboard', '/team', '/tasks', '/alerts',
    '/intelligence', '/chat', '/profile', '/settings',
  ],
  operations_program_manager: [
    '/dashboard', '/team', '/tasks', '/review',
    '/alerts', '/intelligence', '/chat', '/profile', '/settings',
  ],
  observer_team_lead: [
    '/dashboard', '/team', '/tasks', '/alerts',
    '/chat', '/profile', '/settings',
  ],
  collaborator_lead: [
    '/dashboard', '/team', '/tasks', '/review',
    '/alerts', '/chat', '/profile', '/settings',
  ],

  // Core Admin
  core_admin: [
    '/dashboard', '/admin', '/tasks', '/alerts',
    '/team', '/intelligence', '/governance', '/audit-logs',
    '/integrations', '/chat', '/profile', '/settings',
  ],
}

// Per-role label overrides (Intelligence shows differently for leads vs admin)
const ROLE_LABEL_OVERRIDES: Record<string, Partial<Record<string, string>>> = {
  core_admin: {
    '/intelligence': 'System Health',
  },
  technical_lead:           { '/intelligence': 'Team Health' },
  research_lead:            { '/intelligence': 'Team Health' },
  operations_lead:          { '/intelligence': 'Team Health' },
  operations_program_manager: { '/intelligence': 'Team Health' },
  observer_team_lead:       { '/intelligence': 'Team Health' },
  collaborator_lead:        { '/intelligence': 'Team Health' },
}

/** Build the ordered, visible nav items for the current user's role. */
function buildNavItems(role: string, allowedModules: string[]) {
  const allowed = new Set(allowedModules)
  const order   = ROLE_ORDER[role] ?? allowedModules
  const labelOverrides = ROLE_LABEL_OVERRIDES[role] ?? {}

  // Ordered items that are both in the role's preferred order AND allowed by permissions
  const ordered = order
    .filter(route => allowed.has(route))
    .map(route => {
      const base = NAV_ITEM_MAP[route]
      return base
        ? { to: route, icon: base.icon, label: labelOverrides[route] ?? base.label }
        : null
    })
    .filter(Boolean) as { to: string; icon: React.ElementType; label: string }[]

  // Append any allowed routes not covered by the explicit ordering (safety net)
  const orderedSet = new Set(ordered.map(i => i.to))
  for (const route of allowedModules) {
    if (!orderedSet.has(route) && NAV_ITEM_MAP[route]) {
      const base = NAV_ITEM_MAP[route]
      ordered.push({ to: route, icon: base.icon, label: labelOverrides[route] ?? base.label })
    }
  }

  return ordered
}

export default function Sidebar() {
  const loc     = useLocation()
  const user    = useAuthStore(selectUser)
  const isAdmin = useAuthStore(selectIsAdmin)
  const logout  = useAuthStore(s => s.logout)
  const nav     = useNavigate()
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(true)

  // Pending approval badge — fetched once on mount for CORE_ADMIN only.
  // Non-admin roles never hit this endpoint; the result stays 0.
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    if (user?.role !== 'core_admin') return
    getPendingUsers()
      .then(users => setPendingCount(users.length))
      .catch(() => {}) // non-fatal — badge simply won't show
  }, [user?.role])

  // Read unread count from shared store — no local fetch
  const unread = useAlertStore(s => s.unread)

  // Realtime store — live socket status and critical alert count
  const { status: socketStatus, counters } = useRealtimeStore()
  const isLive = socketStatus === 'connected'

  const permissions = getPermissions(user?.role || '')
  const items = buildNavItems(user?.role || '', permissions.modules)

  const navItems = (
    <nav className="px-2 space-y-0.5">
      {items.map((item, i) => {
        const active    = loc.pathname === item.to
        const showBadge = (item.to === '/notifications' && !isAdmin && unread > 0)
                       || (item.to === '/alerts' && isAdmin && unread > 0)
        // Pending approval badge on Controls (/admin) — CORE_ADMIN only
        const showApprovalBadge = item.to === '/admin' && pendingCount > 0
        // Live pulse dot on Intelligence when socket is connected
        const showLiveDot = item.to === '/intelligence' && isLive
        // Critical alert pulse on Alerts/Notifications
        const showCritical = (item.to === '/alerts' || item.to === '/notifications') && counters.criticalAlerts > 0
        return (
          <motion.div key={item.to} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.12 + i * 0.05 }}>
            <Link to={item.to} className={`sidebar-item ${active ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
              <item.icon size={13} />
              {item.label}
              {showBadge && (
                <motion.span key={unread} initial={{ scale: 0.5 }} animate={{ scale: 1 }}
                  className="ml-auto flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full font-bold text-[0.46rem]"
                  style={{ background: showCritical ? '#f87171' : '#f59e0b', color: '#fff', boxShadow: `0 0 6px ${showCritical ? '#f8717166' : '#f59e0b66'}` }}>
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
              {showApprovalBadge && !showBadge && (
                <motion.span key={pendingCount} initial={{ scale: 0.5 }} animate={{ scale: 1 }}
                  className="ml-auto flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full font-bold text-[0.46rem]"
                  style={{ background: '#f87171', color: '#fff', boxShadow: '0 0 6px #f8717166' }}
                  title={`${pendingCount} pending approval${pendingCount !== 1 ? 's' : ''}`}>
                  {pendingCount > 9 ? '9+' : pendingCount}
                </motion.span>
              )}
              {showLiveDot && !showBadge && !showApprovalBadge && (
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: '#4ade80' }}
                  title="Live"
                />
              )}
              {active && !showBadge && !showLiveDot && !showApprovalBadge && (
                <ChevronRight size={9} style={{ marginLeft: 'auto', color: 'rgba(201,168,76,0.5)' }} />
              )}
            </Link>
          </motion.div>
        )
      })}
    </nav>
  )

  const bottomSection = (
    <div className="px-2">
      <div className="gold-rule mb-3 mx-2" />
      <TeamSwitcher />
      <div className="px-3 mb-3">
        <p className="nav-label text-[0.5rem] mb-0.5" style={{ color: 'rgba(184,212,240,0.25)' }}>SIGNED IN AS</p>
        <p className="font-display text-sm" style={{ color: 'rgba(232,240,251,0.8)' }}>{user?.name || 'User'}</p>
        <p className="nav-label text-[0.5rem] mt-0.5" style={{ color: 'rgba(201,168,76,0.45)' }}>
          {user?.role === 'core_admin'
            ? 'CORE ADMIN · FULL ACCESS'
            : isAdmin
              ? (user?.role ?? '').replace(/_/g, ' ').toUpperCase()
              : 'INTERN · LIMITED'}
        </p>
      </div>
      <button onClick={() => { logout(); nav('/') }} className="sidebar-item w-full" style={{ color: 'rgba(248,113,113,0.5)' }}>
        <LogOut size={13} />
        Sign Out
      </button>
    </div>
  )

  return (
    <>
      {/* Mobile hamburger — visible only below md */}
      <button
        className="fixed top-3 left-3 z-50 md:hidden flex items-center justify-center w-8 h-8 rounded-sm"
        style={{ background: 'rgba(7,8,15,0.9)', border: '1px solid rgba(201,168,76,0.2)' }}
        onClick={() => setMobileOpen(o => !o)}
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
      >
        {mobileOpen
          ? <X size={16} style={{ color: 'rgba(201,168,76,0.8)' }} />
          : <Menu size={16} style={{ color: 'rgba(201,168,76,0.8)' }} />}
      </button>

      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 md:hidden" style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setMobileOpen(false)} />
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside key="mobile-drawer" initial={{ x: -220 }} animate={{ x: 0 }} exit={{ x: -220 }}
            transition={{ type: 'tween', duration: 0.25 }}
            className="fixed left-0 top-0 bottom-0 z-50 w-[200px] md:hidden flex flex-col py-5"
            style={{ background: 'rgba(7,8,15,0.97)', borderRight: '1px solid rgba(201,168,76,0.09)', backdropFilter: 'blur(16px)' }}>
            {/* Scrollable nav area */}
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-5 mb-3 mt-10 flex-shrink-0">
                <p className="nav-label text-[0.5rem]" style={{ color: 'rgba(201,168,76,0.32)', letterSpacing: '0.45em' }}>NAVIGATION</p>
              </div>
              <div
                className="flex-1 overflow-y-auto min-h-0 pr-0.5"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(201,168,76,0.2) transparent',
                }}
              >
                {navItems}
              </div>
            </div>
            {/* Bottom section always visible */}
            <div className="flex-shrink-0 mt-2">
              {bottomSection}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop sidebar — always visible on md+ */}
      <motion.aside
        initial={{ x: -56, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.45, delay: 0.15 }}
        className="fixed left-0 top-[49px] bottom-0 z-40 hidden md:flex flex-col py-5"
        style={{
          width: desktopOpen ? '200px' : '0px',
          overflow: desktopOpen ? 'visible' : 'hidden',
          background: 'rgba(7,8,15,0.9)',
          borderRight: '1px solid rgba(201,168,76,0.09)',
          backdropFilter: 'blur(16px)',
          transition: 'width 0.25s ease'
        }}
      >
        {/* Scrollable nav area */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-5 mb-3 flex items-center justify-between flex-shrink-0">
            <p className="nav-label text-[0.5rem]" style={{ color: 'rgba(201,168,76,0.32)', letterSpacing: '0.45em' }}>NAVIGATION</p>
          </div>
          <div
            className="flex-1 overflow-y-auto min-h-0 pr-0.5"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(201,168,76,0.2) transparent',
            }}
          >
            {navItems}
          </div>
        </div>
        {/* Bottom section always visible */}
        <div className="flex-shrink-0 mt-2">
          {bottomSection}
        </div>
      </motion.aside>

      {/* Desktop toggle button */}
      <button
        className="fixed z-50 hidden md:flex items-center justify-center w-6 h-6 rounded-sm"
        style={{
          top: '60px',
          left: desktopOpen ? '188px' : '4px',
          background: 'rgba(7,8,15,0.95)',
          border: '1px solid rgba(201,168,76,0.25)',
          transition: 'left 0.25s ease'
        }}
        onClick={() => setDesktopOpen(o => !o)}
        aria-label={desktopOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {desktopOpen
          ? <X size={12} style={{ color: 'rgba(201,168,76,0.7)' }} />
          : <Menu size={12} style={{ color: 'rgba(201,168,76,0.7)' }} />}
      </button>
    </>
  )
}
