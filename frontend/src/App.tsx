import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import ErrorBoundary      from './components/ErrorBoundary'
import ProtectedRoute     from './routes/ProtectedRoute'
import SessionGuard       from './components/SessionGuard'
import FloatingAlertBell  from './components/FloatingAlertBell'
import Landing            from './pages/Landing'
import Login              from './pages/Login'
import Register           from './pages/Register'
import Dashboard          from './pages/Dashboard'
import Availability       from './pages/Availability'
import Tasks              from './pages/Tasks'
import Review             from './pages/Review'
import Team               from './pages/Team'
import Alerts             from './pages/Alerts'
import AdminOverview      from './pages/AdminOverview'
import Intelligence       from './pages/Intelligence'
import Governance         from './pages/Governance'
import AuditLogs          from './features/admin/AuditLogs'
import Notifications      from './pages/Notifications'
import Portfolio          from './pages/Portfolio'
import PortfolioEdit      from './pages/PortfolioEdit'
import Profile            from './pages/Profile'
import Settings           from './pages/Settings'
import ForgotPassword     from './pages/ForgotPassword'
import ResetPassword      from './pages/ResetPassword'
import Integrations       from './pages/Integrations'
import ChatPage           from './routes/chat'
import ChatFindPage       from './routes/chat-find'
import ChatRequestsPage   from './routes/chat-requests'
import ChatViewPage       from './routes/chat-view'
import ChatManagePage     from './routes/chat-manage'
import ChatSearchPage     from './routes/chat-search'
import { useAuthStore, selectIsAuthenticated, selectIsAdmin } from './store/authStore'
import { useAlertStore } from './store/alertStore'
import { ROLES } from './constants/roles'

// ── Role sets for route-level access control ──────────────────────────────────
// Only CORE_ADMIN can access admin-only pages (overview, governance, audit logs).
const CORE_ADMIN_ONLY = [ROLES.CORE_ADMIN]

// Leads + CORE_ADMIN can access operational pages (review, team, alerts, intelligence).
const LEAD_AND_ADMIN_ROLES = [
  ROLES.CORE_ADMIN,
  ROLES.TECHNICAL_LEAD,
  ROLES.OPERATIONS_LEAD,
  ROLES.RESEARCH_LEAD,
  ROLES.OPERATIONS_PROGRAM_MANAGER,
  ROLES.OBSERVER_TEAM_LEAD,
  ROLES.COLLABORATOR_LEAD,
]

function AlertPollingManager() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const isAdmin         = useAuthStore(selectIsAdmin)
  const { startPolling, stopPolling } = useAlertStore()

  useEffect(() => {
    if (isAuthenticated) {
      // Always restart with the current role — ensures admin gets /alerts, intern gets /alerts/my
      startPolling(isAdmin)
    } else {
      stopPolling()
    }
    // Cleanup on unmount or role/auth change
    return () => stopPolling()
  }, [isAuthenticated, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SessionGuard />
        <AlertPollingManager />
        <FloatingAlertBell />

        <Routes>
          {/* Public routes */}
          <Route path="/"                element={<Landing />} />
          <Route path="/login"           element={<Login />} />
          <Route path="/register"        element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />
          <Route path="/portfolio/:slug" element={<Portfolio />} />

          {/* Protected — any authenticated user */}
          <Route path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/availability"
            element={<ProtectedRoute><Availability /></ProtectedRoute>} />
          <Route path="/tasks"
            element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
          <Route path="/notifications"
            element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/portfolio-edit"
            element={<ProtectedRoute><PortfolioEdit /></ProtectedRoute>} />

          {/* Protected — any authenticated user (new) */}
          <Route path="/profile"
            element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/settings"
            element={<ProtectedRoute><Settings /></ProtectedRoute>} />

          {/* Protected — chat routes (any authenticated user) */}
          <Route path="/chat"
            element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/chat/find"
            element={<ProtectedRoute><ChatFindPage /></ProtectedRoute>} />
          <Route path="/chat/requests"
            element={<ProtectedRoute><ChatRequestsPage /></ProtectedRoute>} />
          <Route path="/chat/search"
            element={<ProtectedRoute><ChatSearchPage /></ProtectedRoute>} />
          <Route path="/chat/:chatId"
            element={<ProtectedRoute><ChatViewPage /></ProtectedRoute>} />
          <Route path="/chat/:chatId/manage"
            element={<ProtectedRoute><ChatManagePage /></ProtectedRoute>} />

          {/* Protected — leads + CORE_ADMIN (operational pages) */}
          <Route path="/review"
            element={<ProtectedRoute allowRoles={LEAD_AND_ADMIN_ROLES}><Review /></ProtectedRoute>} />
          <Route path="/team"
            element={<ProtectedRoute allowRoles={LEAD_AND_ADMIN_ROLES}><Team /></ProtectedRoute>} />
          <Route path="/alerts"
            element={<ProtectedRoute allowRoles={LEAD_AND_ADMIN_ROLES}><Alerts /></ProtectedRoute>} />
          <Route path="/intelligence"
            element={<ProtectedRoute allowRoles={LEAD_AND_ADMIN_ROLES}><Intelligence /></ProtectedRoute>} />

          {/* Protected — CORE_ADMIN only */}
          <Route path="/admin"
            element={<ProtectedRoute allowRoles={CORE_ADMIN_ONLY}><AdminOverview /></ProtectedRoute>} />
          <Route path="/governance"
            element={<ProtectedRoute allowRoles={CORE_ADMIN_ONLY}><Governance /></ProtectedRoute>} />
          <Route path="/audit-logs"
            element={<ProtectedRoute allowRoles={CORE_ADMIN_ONLY}><AuditLogs /></ProtectedRoute>} />
          <Route path="/integrations"
            element={<ProtectedRoute allowRoles={CORE_ADMIN_ONLY}><Integrations /></ProtectedRoute>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
