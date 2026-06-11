import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts'
import {
  Activity, AlertTriangle, CheckCircle, Clock, Loader2,
  TrendingUp, Users, Zap, BarChart2, Target, Bell, TrendingDown, Globe, Cpu, FileText, Link2,
  Radio, ShieldAlert, RefreshCw, Wifi, WifiOff,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Starfield from '../components/Starfield'
import api from '../services/api'
import {
  getAnalyticsDashboard,
  getIntegrationIntelligence,
  getUnifiedIntelligence,
  type AnalyticsDashboard,
  type IntegrationIntelligenceData,
  type IntegrationIntelligenceRow,
  type UnifiedIntelligenceData,
} from '../services/analytics.service'
import { getGoogleIntelligence, type GoogleIntelligence } from '../services/google.service'
import { extractErrorMessage } from '../services/error'
import { useRealtimeStore, type LiveFeedEvent } from '../store/realtimeStore'

const GOLD    = '#c9a84c'
const ICE     = 'rgba(184,212,240,0.7)'
const ICE_DIM = 'rgba(184,212,240,0.25)'
const GREEN   = '#4ade80'
const AMBER   = '#f59e0b'
const RED     = '#f87171'
const BLUE    = '#60a5fa'
const NAVY    = 'rgba(13,15,28,0.8)'
const CHART_COLORS = { capacity: GOLD, credibility: BLUE, performance: GREEN }

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="nav-label text-[0.55rem] mb-0.5" style={{ color: `${GOLD}66`, letterSpacing: '0.4em' }}>{label}</p>
      <h2 className="font-display text-lg text-frost">{title}</h2>
      <div className="gold-rule w-10 mt-1" />
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color = GOLD }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-sm p-4 flex items-start gap-3">
      <div className="p-2 rounded-sm flex-shrink-0" style={{ background: `${color}18` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="nav-label text-[0.5rem] mb-0.5" style={{ color: ICE_DIM }}>{label}</p>
        <p className="font-display font-black text-xl" style={{ color }}>{value}</p>
        {sub && <p className="font-body text-xs mt-0.5" style={{ color: ICE_DIM }}>{sub}</p>}
      </div>
    </motion.div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    critical: { bg: 'rgba(248,113,113,0.15)', color: RED },
    high:     { bg: 'rgba(245,158,11,0.15)',  color: AMBER },
    medium:   { bg: 'rgba(201,168,76,0.15)',  color: GOLD },
    low:      { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM },
  }
  const s = map[severity] ?? map.low
  return (
    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {severity.toUpperCase()}
    </span>
  )
}

function LoadBandBadge({ tli, isOverloaded }: { tli: number; isOverloaded?: boolean }) {
  const band = isOverloaded || tli > 12 ? 'RED' : tli > 6 ? 'AMBER' : 'GREEN'
  const map: Record<string, { bg: string; color: string; label: string }> = {
    RED:   { bg: 'rgba(248,113,113,0.12)', color: RED, label: 'OVERLOADED' },
    AMBER: { bg: 'rgba(245,158,11,0.12)',  color: AMBER, label: 'HIGH LOAD' },
    GREEN: { bg: 'rgba(74,222,128,0.10)',  color: GREEN, label: 'NORMAL LOAD' },
  }
  const s = map[band] ?? map.GREEN
  return (
    <span
      className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    healthy:  { bg: 'rgba(74,222,128,0.12)',  color: GREEN },
    moderate: { bg: 'rgba(245,158,11,0.12)',  color: AMBER },
    low:      { bg: 'rgba(248,113,113,0.12)', color: RED },
    critical: { bg: 'rgba(248,113,113,0.12)', color: RED },
    open:     { bg: 'rgba(245,158,11,0.12)',  color: AMBER },
    in_progress: { bg: 'rgba(96,165,250,0.12)', color: BLUE },
    ready:    { bg: 'rgba(74,222,128,0.12)',  color: GREEN },
    available_with_caution: { bg: 'rgba(245,158,11,0.12)', color: AMBER },
    do_not_assign: { bg: 'rgba(248,113,113,0.12)', color: RED },
    low_availability: { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM },
    declining_fast: { bg: 'rgba(248,113,113,0.12)', color: RED },
    declining:  { bg: 'rgba(245,158,11,0.12)', color: AMBER },
    stable:     { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM },
    improving:  { bg: 'rgba(74,222,128,0.12)', color: GREEN },
  }
  const s = map[status] ?? { bg: 'rgba(184,212,240,0.08)', color: ICE_DIM }
  return (
    <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color }}>
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-sm px-3 py-2 text-xs" style={{ background: NAVY, border: `1px solid ${GOLD}33` }}>
      <p className="nav-label text-[0.5rem] mb-1" style={{ color: GOLD }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

type Tab = 'overview' | 'risks' | 'assignment' | 'workload' | 'trends' | 'alerts' | 'teams' | 'digest' | 'google' | 'integration' | 'presence' | 'presence'

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview',     label: 'OVERVIEW',     icon: BarChart2 },
  { key: 'risks',        label: 'TASK RISKS',   icon: AlertTriangle },
  { key: 'assignment',   label: 'ASSIGNMENT',   icon: Target },
  { key: 'workload',     label: 'WORKLOAD',     icon: Activity },
  { key: 'trends',       label: 'TRENDS',       icon: TrendingUp },
  { key: 'alerts',       label: 'ALERTS',       icon: Bell },
  { key: 'teams',        label: 'TEAMS',        icon: Users },
  { key: 'digest',       label: 'DIGEST',       icon: Zap },
  { key: 'google',       label: 'GOOGLE',       icon: Globe },
  { key: 'integration',  label: 'INTEGRATION',  icon: Cpu },
  { key: 'presence',     label: 'PRESENCE',     icon: Radio },
]

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: AnalyticsDashboard }) {
  const { workload, sla, support, teamHealth, taskRisks, assignmentReadiness } = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users}         label="TOTAL INTERNS"    value={workload.summary.total}        color={GOLD} />
        <StatCard icon={AlertTriangle} label="OVERLOADED"       value={workload.summary.overloaded}   color={RED} />
        <StatCard icon={Target}        label="READY TO ASSIGN"  value={assignmentReadiness.summary.ready} color={GREEN} />
        <StatCard icon={CheckCircle}   label="HEALTHY"          value={workload.summary.healthy}      color={GREEN} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={AlertTriangle} label="CRITICAL RISKS"   value={taskRisks.counts.critical}     color={RED} />
        <StatCard icon={Clock}         label="HIGH RISKS"       value={taskRisks.counts.high}         color={AMBER} />
        <StatCard icon={AlertTriangle} label="SLA BREACHES"     value={sla.counts.staleTasks + sla.counts.overdueTasks} color={RED} />
        <StatCard icon={Activity}      label="SUPPORT OPEN"     value={support.total}                 sub={`${support.slaBreachCount} breaching SLA`} color={AMBER} />
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="TEAM HEALTH" title="Team Capacity Overview" />
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead><tr>
              <th className="text-left">Team</th>
              <th className="text-center">Members</th>
              <th className="text-center">Avg Capacity</th>
              <th className="text-center">Avg RPI</th>
              <th className="text-center">Active Tasks</th>
              <th className="text-center">Status</th>
            </tr></thead>
            <tbody>
              {teamHealth.teams.slice(0, 8).map(t => (
                <tr key={t.id}>
                  <td className="font-body text-sm text-frost/80">{t.name}</td>
                  <td className="text-center font-mono text-sm">{t.internCount}</td>
                  <td className="text-center font-mono text-sm" style={{ color: t.avgCapacity >= 60 ? GREEN : t.avgCapacity >= 35 ? AMBER : RED }}>{t.avgCapacity}</td>
                  <td className="text-center font-mono text-sm">{t.avgRpi.toFixed(1)}</td>
                  <td className="text-center font-mono text-sm">{t.activeTasks}</td>
                  <td className="text-center"><StatusBadge status={t.healthStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Task Risks Tab ────────────────────────────────────────────────────────────
function RisksTab({ data }: { data: AnalyticsDashboard }) {
  const { taskRisks } = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={AlertTriangle} label="CRITICAL"  value={taskRisks.counts.critical} color={RED} />
        <StatCard icon={AlertTriangle} label="HIGH"      value={taskRisks.counts.high}     color={AMBER} />
        <StatCard icon={Clock}         label="MEDIUM"    value={taskRisks.counts.medium}   color={GOLD} />
        <StatCard icon={Activity}      label="TOTAL AT RISK" value={taskRisks.counts.total} color={ICE} />
      </div>
      {taskRisks.risks.length === 0 ? (
        <div className="glass-card rounded-sm p-10 text-center">
          <CheckCircle size={28} className="mx-auto mb-3" style={{ color: GREEN }} />
          <p className="font-body text-sm" style={{ color: ICE_DIM }}>No at-risk tasks detected.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {taskRisks.risks.map(risk => (
            <motion.div key={risk.taskId} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-sm p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <SeverityBadge severity={risk.severity} />
                    <p className="font-body text-sm text-frost/90 font-medium truncate">{risk.title}</p>
                  </div>
                  <p className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>
                    {risk.internName} · Complexity {risk.complexity} · {risk.progressPct}% done
                    {risk.deadline && ` · Due ${new Date(risk.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {risk.riskFactors.map((f, i) => (
                  <span key={i} className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
                    style={{ background: 'rgba(248,113,113,0.08)', color: 'rgba(248,113,113,0.7)', border: '1px solid rgba(248,113,113,0.15)' }}>
                    {f.factor.replace(/_/g, ' ')}: {f.detail}
                  </span>
                ))}
              </div>
              <p className="font-body text-xs" style={{ color: AMBER }}>
                → {risk.suggestedAction}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Assignment Readiness Tab ──────────────────────────────────────────────────
function AssignmentTab({ data }: { data: AnalyticsDashboard }) {
  const { assignmentReadiness } = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={CheckCircle}   label="READY"              value={assignmentReadiness.summary.ready}               color={GREEN} />
        <StatCard icon={Clock}         label="WITH CAUTION"       value={assignmentReadiness.summary.availableWithCaution} color={AMBER} />
        <StatCard icon={AlertTriangle} label="DO NOT ASSIGN"      value={assignmentReadiness.summary.doNotAssign}         color={RED} />
        <StatCard icon={Activity}      label="NO AVAILABILITY"    value={assignmentReadiness.summary.noAvailability}      color={ICE_DIM} />
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="ASSIGNMENT READINESS" title="Ranked by Readiness Score" />
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead><tr>
              <th className="text-left">Intern</th>
              <th className="text-center">Readiness</th>
              <th className="text-center">Capacity</th>
              <th className="text-center">Cred.</th>
              <th className="text-center">TLI</th>
              <th className="text-center">Active</th>
              <th className="text-center">Avail.</th>
              <th className="text-center">Recommendation</th>
            </tr></thead>
            <tbody>
              {assignmentReadiness.interns.map(i => (
                <tr key={i.internId}>
                  <td>
                    <p className="font-body text-sm text-frost/80">{i.name}</p>
                    <p className="nav-label text-[0.45rem] mt-0.5" style={{ color: ICE_DIM }}>
                      {i.reasons.slice(0, 2).join(' · ')}
                    </p>
                  </td>
                  <td className="text-center">
                    <span className="font-display font-black text-lg"
                      style={{ color: i.readinessScore >= 65 ? GREEN : i.readinessScore >= 40 ? AMBER : RED }}>
                      {i.readinessScore}
                    </span>
                  </td>
                  <td className="text-center font-mono text-sm" style={{ color: i.capacityScore >= 60 ? GREEN : i.capacityScore >= 30 ? AMBER : RED }}>{i.capacityScore}</td>
                  <td className="text-center font-mono text-sm" style={{ color: i.credScore >= 60 ? GREEN : i.credScore >= 40 ? AMBER : RED }}>{i.credScore}</td>
                  <td className="text-center">
                    <div className="inline-flex items-center gap-2 justify-center">
                      <span className="font-mono text-sm" style={{ color: i.tli > 12 ? RED : i.tli > 6 ? AMBER : ICE_DIM }}>{i.tli.toFixed(1)}</span>
                      <LoadBandBadge tli={i.tli} isOverloaded={i.tli > 12} />
                    </div>
                  </td>
                  <td className="text-center font-mono text-sm">{i.activeTasks}</td>

                  <td className="text-center">
                    {i.submittedThisWeek
                      ? <CheckCircle size={12} style={{ color: GREEN, margin: 'auto' }} />
                      : <Clock size={12} style={{ color: AMBER, margin: 'auto' }} />}
                  </td>
                  <td className="text-center"><StatusBadge status={i.recommendation} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Workload Tab ──────────────────────────────────────────────────────────────
function WorkloadTab({ data }: { data: AnalyticsDashboard }) {
  const { workload } = data
  const chartData = workload.interns.map(i => ({
    name:     i.name.split(' ')[0],
    capacity: i.capacityScore,
    rawTli:   i.tli,
    active:   i.activeTasks,
    loadBand: i.isOverloaded ? 'RED' : i.tli > 6 ? 'AMBER' : 'GREEN',
  }))


  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon={Users}         label="OVERLOADED (TLI>12)"  value={workload.summary.overloaded}   color={RED} />
        <StatCard icon={AlertTriangle} label="LOW CAPACITY (<30)"   value={workload.summary.lowCapacity}  color={AMBER} />
        <StatCard icon={Activity}      label="WITH BLOCKERS"        value={workload.summary.withBlockers} color={AMBER} />
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="CAPACITY DISTRIBUTION" title="Intern Capacity Scores" />
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,168,76,0.08)" />
            <XAxis dataKey="name" tick={{ fill: ICE_DIM, fontSize: 10 }} />
            <YAxis tick={{ fill: ICE_DIM, fontSize: 10 }} domain={[0, 100]} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="capacity" name="Capacity" fill={GOLD} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="INTERN WORKLOAD" title="Workload Distribution" />
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead><tr>
              <th className="text-left">Intern</th>
              <th className="text-center">Capacity</th>
              <th className="text-center">TLI</th>
              <th className="text-center">Active</th>
              <th className="text-center">Stale</th>
              <th className="text-center">Blocked</th>
              <th className="text-center">Status</th>
            </tr></thead>
            <tbody>
              {workload.interns.sort((a, b) => a.capacityScore - b.capacityScore).map(i => (
                <tr key={i.internId}>
                  <td className="font-body text-sm text-frost/80">{i.name}</td>
                  <td className="text-center font-mono text-sm" style={{ color: i.capacityScore >= 60 ? GREEN : i.capacityScore >= 30 ? AMBER : RED }}>{i.capacityScore}</td>
                  <td className="text-center font-mono text-sm" style={{ color: i.tli > 12 ? RED : i.tli > 6 ? AMBER : ICE }}>{i.tli.toFixed(1)}</td>
                  <td className="text-center font-mono text-sm">{i.activeTasks}</td>
                  <td className="text-center font-mono text-sm" style={{ color: i.staleTasks > 0 ? AMBER : ICE_DIM }}>{i.staleTasks}</td>
                  <td className="text-center font-mono text-sm" style={{ color: i.blockedTasks > 0 ? RED : ICE_DIM }}>{i.blockedTasks}</td>
                  <td className="text-center"><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Trends Tab ────────────────────────────────────────────────────────────────
function TrendsTab({ data }: { data: AnalyticsDashboard }) {
  const { scoreTrends, workloadTrend, performanceTrends } = data
  const scoreChartData = scoreTrends.weeks.map(w => ({
    week: w.week.slice(5),
    capacity: w.capacity.avg,
    credibility: w.credibility.avg,
    performance: w.performance.avg,
  }))
  const workloadChartData = workloadTrend.weeks.map(w => ({
    week: w.week.slice(5),
    active: w.totalActiveTasks,
    density: w.assignmentDensity,
  }))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={TrendingDown}  label="DECLINING FAST" value={performanceTrends.summary.decliningFast} color={RED} />
        <StatCard icon={TrendingDown}  label="DECLINING"      value={performanceTrends.summary.declining}     color={AMBER} />
        <StatCard icon={TrendingUp}    label="IMPROVING"      value={performanceTrends.summary.improving}     color={GREEN} />
        <StatCard icon={AlertTriangle} label="LOW RELIABILITY" value={performanceTrends.summary.lowReliability} color={AMBER} />
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="SCORE TRENDS" title="Capacity · Credibility · Performance (8-week avg)" />
        {scoreChartData.length === 0 ? (
          <p className="font-body text-sm text-center py-8" style={{ color: ICE_DIM }}>
            No digest data yet. Trends populate after the first weekly digest runs.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={scoreChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,168,76,0.08)" />
              <XAxis dataKey="week" tick={{ fill: ICE_DIM, fontSize: 10 }} />
              <YAxis tick={{ fill: ICE_DIM, fontSize: 10 }} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10, color: ICE_DIM }} />
              <Line type="monotone" dataKey="capacity"    name="Capacity"    stroke={CHART_COLORS.capacity}    strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="credibility" name="Credibility" stroke={CHART_COLORS.credibility} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="performance" name="Performance" stroke={CHART_COLORS.performance} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="WORKLOAD GROWTH" title="Active Tasks & Assignment Density" />
        {workloadChartData.length === 0 ? (
          <p className="font-body text-sm text-center py-8" style={{ color: ICE_DIM }}>No workload trend data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={workloadChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={GOLD} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,168,76,0.08)" />
              <XAxis dataKey="week" tick={{ fill: ICE_DIM, fontSize: 10 }} />
              <YAxis tick={{ fill: ICE_DIM, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10, color: ICE_DIM }} />
              <Area type="monotone" dataKey="active"  name="Active Tasks"  stroke={GOLD}  fill="url(#activeGrad)" strokeWidth={2} />
              <Line type="monotone" dataKey="density" name="Tasks/Intern"  stroke={AMBER} strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {performanceTrends.trends.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="PER-INTERN TRENDS" title="Performance & Credibility Trends" />
          <div className="overflow-x-auto">
            <table className="uris-table w-full">
              <thead><tr>
                <th className="text-left">Intern</th>
                <th className="text-center">Recent Avg</th>
                <th className="text-center">Prior Avg</th>
                <th className="text-center">Delta</th>
                <th className="text-center">Trend</th>
                <th className="text-center">Cred.</th>
                <th className="text-center">Update Freq</th>
                <th className="text-center">Deadline Adh.</th>
              </tr></thead>
              <tbody>
                {performanceTrends.trends.map(t => (
                  <tr key={t.internId}>
                    <td className="font-body text-sm text-frost/80">{t.name}</td>
                    <td className="text-center font-mono text-sm">{t.recentAvg}</td>
                    <td className="text-center font-mono text-sm text-ice/50">{t.priorAvg}</td>
                    <td className="text-center font-mono text-sm font-bold"
                      style={{ color: t.delta > 0 ? GREEN : t.delta < -5 ? RED : AMBER }}>
                      {t.delta > 0 ? '+' : ''}{t.delta}
                    </td>
                    <td className="text-center"><StatusBadge status={t.trend} /></td>
                    <td className="text-center font-mono text-sm" style={{ color: (t.credScore ?? 0) >= 60 ? GREEN : (t.credScore ?? 0) >= 40 ? AMBER : RED }}>
                      {t.credScore ?? '—'}
                    </td>
                    <td className="text-center font-mono text-sm">{t.updateFreq != null ? `${t.updateFreq}%` : '—'}</td>
                    <td className="text-center font-mono text-sm">{t.deadlineAdh != null ? `${t.deadlineAdh}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Alert Intelligence Tab ────────────────────────────────────────────────────
function AlertsTab({ data }: { data: AnalyticsDashboard }) {
  const { alertIntelligence } = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Bell}          label="TOTAL ALERTS"    value={alertIntelligence.summary.total}    color={GOLD} />
        <StatCard icon={AlertTriangle} label="CRITICAL"        value={alertIntelligence.summary.critical} color={RED} />
        <StatCard icon={Clock}         label="WARNING"         value={alertIntelligence.summary.warning}  color={AMBER} />
        <StatCard icon={Activity}      label="ALERT TYPES"     value={alertIntelligence.summary.types}    color={ICE_DIM} />
      </div>
      {alertIntelligence.groups.length === 0 ? (
        <div className="glass-card rounded-sm p-10 text-center">
          <CheckCircle size={28} className="mx-auto mb-3" style={{ color: GREEN }} />
          <p className="font-body text-sm" style={{ color: ICE_DIM }}>No active alerts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alertIntelligence.groups.map(g => (
            <motion.div key={g.type} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <SeverityBadge severity={g.priority} />
                    <p className="font-body text-sm text-frost/90 font-medium">{g.label}</p>
                    {g.isEscalation && (
                      <span className="nav-label text-[0.45rem] px-1.5 py-0.5 rounded-sm"
                        style={{ background: 'rgba(248,113,113,0.12)', color: RED, border: '1px solid rgba(248,113,113,0.2)' }}>
                        ESCALATION
                      </span>
                    )}
                  </div>
                  <p className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>
                    {g.count} alert{g.count !== 1 ? 's' : ''} · {g.affectedInterns} intern{g.affectedInterns !== 1 ? 's' : ''} affected
                    {g.critical > 0 && ` · ${g.critical} critical`}
                  </p>
                  <p className="font-body text-xs mt-1.5" style={{ color: AMBER }}>→ {g.suggestedAction}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display font-black text-2xl" style={{ color: g.priority === 'critical' ? RED : g.priority === 'high' ? AMBER : GOLD }}>{g.count}</p>
                  <p className="nav-label text-[0.45rem]" style={{ color: ICE_DIM }}>
                    since {new Date(g.oldestAlert).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {alertIntelligence.recurringIssues.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="RECURRING ISSUES" title="Interns with 3+ Unresolved Alerts" />
          <div className="space-y-2">
            {alertIntelligence.recurringIssues.map(i => (
              <div key={i.internId} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.12)' }}>
                <p className="font-body text-sm text-frost/80">{i.name}</p>
                <span className="font-display font-black text-lg" style={{ color: RED }}>{i.alertCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Teams Tab ─────────────────────────────────────────────────────────────────
function TeamsTab({ data }: { data: AnalyticsDashboard }) {
  const { teamHealth } = data
  const chartData = teamHealth.teams.map(t => ({
    name:     t.name.length > 12 ? t.name.slice(0, 12) + '…' : t.name,
    capacity: t.avgCapacity,
    rpi:      t.avgRpi,
  }))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users}         label="TOTAL TEAMS"    value={teamHealth.summary.totalTeams}      color={GOLD} />
        <StatCard icon={CheckCircle}   label="HEALTHY"        value={teamHealth.summary.healthyTeams}    color={GREEN} />
        <StatCard icon={AlertTriangle} label="CRITICAL"       value={teamHealth.summary.criticalTeams}   color={RED} />
        <StatCard icon={Clock}         label="INACTIVE TEAMS" value={teamHealth.summary.inactiveTeams}   color={AMBER} />
      </div>
      {chartData.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="TEAM CAPACITY" title="Average Capacity by Team" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,168,76,0.08)" />
              <XAxis dataKey="name" tick={{ fill: ICE_DIM, fontSize: 10 }} />
              <YAxis tick={{ fill: ICE_DIM, fontSize: 10 }} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10, color: ICE_DIM }} />
              <Bar dataKey="capacity" name="Avg Capacity" fill={GOLD}  radius={[2, 2, 0, 0]} />
              <Bar dataKey="rpi"      name="Avg RPI"      fill={GREEN} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="TEAM DETAILS" title="Team Health Breakdown" />
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead><tr>
              <th className="text-left">Team</th>
              <th className="text-center">Members</th>
              <th className="text-center">Avg Cap</th>
              <th className="text-center">Avg RPI</th>
              <th className="text-center">Overloaded</th>
              <th className="text-center">Low Cap</th>
              <th className="text-center">Health</th>
            </tr></thead>
            <tbody>
              {teamHealth.teams.map(t => (
                <tr key={t.id}>
                  <td className="font-body text-sm text-frost/80">
                    {t.name}
                    {t.isInactive && <span className="ml-2 nav-label text-[0.45rem] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: AMBER }}>INACTIVE</span>}
                  </td>
                  <td className="text-center font-mono text-sm">{t.internCount}</td>
                  <td className="text-center font-mono text-sm" style={{ color: t.avgCapacity >= 60 ? GREEN : t.avgCapacity >= 35 ? AMBER : RED }}>{t.avgCapacity}</td>
                  <td className="text-center font-mono text-sm">{t.avgRpi.toFixed(1)}</td>
                  <td className="text-center font-mono text-sm" style={{ color: t.overloadedCount > 0 ? RED : ICE_DIM }}>{t.overloadedCount}</td>
                  <td className="text-center font-mono text-sm" style={{ color: t.lowCapacityCount > 0 ? AMBER : ICE_DIM }}>{t.lowCapacityCount}</td>
                  <td className="text-center"><StatusBadge status={t.healthStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Digest Tab ────────────────────────────────────────────────────────────────
function DigestTab({ data }: { data: AnalyticsDashboard }) {
  const { digest } = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={AlertTriangle} label="LOW CREDIBILITY"  value={digest.counts.lowCredibilityInterns} color={RED} />
        <StatCard icon={Clock}         label="INACTIVE TASKS"   value={digest.counts.inactiveTasks}         color={AMBER} />
        <StatCard icon={Clock}         label="OVERDUE REQUESTS" value={digest.counts.overdueRequests}       color={RED} />
      </div>
      {digest.lowCredibilityInterns.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="CREDIBILITY WATCH" title="Low Credibility Interns" />
          <div className="space-y-2">
            {digest.lowCredibilityInterns.map(i => (
              <div key={i.internId} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.12)' }}>
                <p className="font-body text-sm text-frost/80">{i.name}</p>
                <span className="font-mono text-sm font-bold" style={{ color: RED }}>{i.credibilityScore}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {digest.inactiveTasks.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="INACTIVE TASKS" title="No Progress in 7+ Days" />
          <div className="overflow-x-auto">
            <table className="uris-table w-full">
              <thead><tr>
                <th className="text-left">Task</th><th className="text-left">Intern</th>
                <th className="text-center">Progress</th><th className="text-center">Days Idle</th>
              </tr></thead>
              <tbody>
                {digest.inactiveTasks.map(t => (
                  <tr key={t.id}>
                    <td className="font-body text-sm text-frost/80 max-w-[200px] truncate">{t.title}</td>
                    <td className="font-body text-sm text-ice/60">{t.internName}</td>
                    <td className="text-center font-mono text-sm">{t.progressPct}%</td>
                    <td className="text-center font-mono text-sm" style={{ color: t.daysSinceUpdate > 14 ? RED : AMBER }}>{t.daysSinceUpdate}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {digest.counts.lowCredibilityInterns === 0 && digest.counts.inactiveTasks === 0 && digest.counts.overdueRequests === 0 && (
        <div className="glass-card rounded-sm p-10 text-center">
          <CheckCircle size={28} className="mx-auto mb-3" style={{ color: GREEN }} />
          <p className="font-body text-sm" style={{ color: ICE_DIM }}>No operational issues detected this week.</p>
        </div>
      )}
    </div>
  )
}

// ── Google Intelligence Tab ───────────────────────────────────────────────────
function GoogleTab({ data }: { data: GoogleIntelligence }) {
  const { summary, staleWorklogs, noWorklog, notConnected, activeWorklogs } = data

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users}         label="TOTAL INTERNS"      value={summary.totalInterns}        color={GOLD} />
        <StatCard icon={CheckCircle}   label="GOOGLE CONNECTED"   value={summary.connectedToGoogle}   color={GREEN} />
        <StatCard icon={AlertTriangle} label="STALE WORKLOGS"     value={summary.staleWorklogCount}   color={AMBER} sub={`>${summary.staleDaysThreshold}d no update`} />
        <StatCard icon={AlertTriangle} label="NO WORKLOG SET"     value={summary.noWorklogCount}      color={RED} />
      </div>

      {/* Stale worklogs */}
      {staleWorklogs.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="WORKLOG INTELLIGENCE" title="Stale Work Logs" />
          <div className="overflow-x-auto">
            <table className="uris-table w-full">
              <thead><tr>
                <th className="text-left">Intern</th>
                <th className="text-center">Last Updated</th>
                <th className="text-center">Days Stale</th>
                <th className="text-center">Google</th>
                <th className="text-center">Status</th>
              </tr></thead>
              <tbody>
                {staleWorklogs.map(w => (
                  <tr key={w.internId}>
                    <td className="font-body text-sm text-frost/80">{w.name}</td>
                    <td className="text-center font-mono text-xs text-ice/50">
                      {w.lastModified
                        ? new Date(w.lastModified).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="text-center font-mono text-sm" style={{ color: (w.daysSinceUpdate ?? 0) > 7 ? RED : AMBER }}>
                      {w.daysSinceUpdate != null ? `${w.daysSinceUpdate}d` : '—'}
                    </td>
                    <td className="text-center">
                      {w.isConnected
                        ? <CheckCircle size={12} style={{ color: GREEN, margin: 'auto' }} />
                        : <AlertTriangle size={12} style={{ color: AMBER, margin: 'auto' }} />}
                    </td>
                    <td className="text-center">
                      <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,158,11,0.12)', color: AMBER }}>
                        STALE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Not connected to Google */}
      {notConnected.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="CONNECTION STATUS" title="Interns Not Connected to Google" />
          <div className="space-y-2">
            {notConnected.map(i => (
              <div key={i.internId} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(184,212,240,0.04)', border: '1px solid rgba(184,212,240,0.08)' }}>
                <p className="font-body text-sm text-frost/70">{i.name}</p>
                <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(184,212,240,0.08)', color: ICE_DIM }}>
                  {i.hasGdoc ? 'HAS GDOC · NOT CONNECTED' : 'NO GDOC · NOT CONNECTED'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No worklog set */}
      {noWorklog.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="WORKLOG GAPS" title="Interns Without Work Log URL" />
          <div className="space-y-2">
            {noWorklog.map(i => (
              <div key={i.internId} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.1)' }}>
                <p className="font-body text-sm text-frost/70">{i.name}</p>
                <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(248,113,113,0.1)', color: RED }}>
                  NO WORKLOG
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active worklogs */}
      {activeWorklogs.length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="ACTIVE WORKLOGS" title="Up-to-Date Work Logs" />
          <div className="space-y-2">
            {activeWorklogs.map(i => (
              <div key={i.internId} className="flex items-center justify-between p-3 rounded-sm"
                style={{ background: 'rgba(74,222,128,0.04)', border: '1px solid rgba(74,222,128,0.1)' }}>
                <p className="font-body text-sm text-frost/70">{i.name}</p>
                <div className="flex items-center gap-2">
                  {i.lastModified && (
                    <span className="nav-label text-[0.48rem] text-ice/30">
                      {new Date(i.lastModified).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                  <span className="nav-label text-[0.5rem] px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(74,222,128,0.1)', color: GREEN }}>
                    ACTIVE
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {staleWorklogs.length === 0 && notConnected.length === 0 && noWorklog.length === 0 && (
        <div className="glass-card rounded-sm p-10 text-center">
          <CheckCircle size={28} className="mx-auto mb-3" style={{ color: GREEN }} />
          <p className="font-body text-sm" style={{ color: ICE_DIM }}>All work logs are active and up to date.</p>
        </div>
      )}
    </div>
  )
}

// ── Presence Intelligence Tab ─────────────────────────────────────────────────
function PresenceIntelligenceTab() {
  const [data, setData]   = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/analytics/presence')
      .then(r => setData((r.data as any).data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: GOLD }} />
      </div>
    )
  }

  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className="glass-card rounded-sm p-10 text-center">
        <Radio size={28} className="mx-auto mb-3" style={{ color: ICE_DIM }} />
        <p className="font-body text-sm mb-1" style={{ color: ICE_DIM }}>
          No presence data yet.
        </p>
        <p className="font-body text-xs" style={{ color: `${ICE_DIM}88` }}>
          Interns need to use the Check In / Check Out widget on their dashboard to generate data.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon={Users}         label="INTERNS WITH DATA"   value={data.rows.length}                         color={GOLD}  />
        <StatCard icon={Activity}      label="AVG CONSISTENCY"     value={`${data.summary?.avgConsistency ?? 0}%`}  color={GREEN} />
        <StatCard icon={AlertTriangle} label="MISSED WINDOWS"      value={data.summary?.totalMissedWindows ?? 0}    color={AMBER} />
      </div>

      {/* Per-intern table */}
      <div className="glass-card rounded-sm p-5">
        <SectionHeader label="PRESENCE INTELLIGENCE" title={`Daily Attendance — Last ${data.windowDays} Days`} />
        <div className="overflow-x-auto">
          <table className="uris-table w-full">
            <thead>
              <tr>
                <th className="text-left">Intern</th>
                <th className="text-center">Check-In Days</th>
                <th className="text-center">Avg Session</th>
                <th className="text-center">Consistency</th>
                <th className="text-center">Declared Windows</th>
                <th className="text-center">Missed Windows</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.internId}>
                  <td className="font-body text-sm text-frost/80">{r.name}</td>
                  <td className="text-center font-mono text-sm">{r.checkInDays}</td>
                  <td className="text-center font-mono text-sm">
                    {r.avgSessionDurationMinutes > 0 ? `${r.avgSessionDurationMinutes}m` : '—'}
                  </td>
                  <td className="text-center">
                    <span className="font-display font-black text-base"
                      style={{ color: r.consistencyRate >= 70 ? GREEN : r.consistencyRate >= 40 ? AMBER : RED }}>
                      {r.consistencyRate}%
                    </span>
                  </td>
                  <td className="text-center font-mono text-sm" style={{ color: ICE_DIM }}>{r.declaredWindows}</td>
                  <td className="text-center font-mono text-sm"
                    style={{ color: r.missedWindows > 0 ? AMBER : ICE_DIM }}>
                    {r.missedWindows}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────────────
// ── Integration Intelligence Tab ──────────────────────────────────────────────
function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(184,212,240,0.08)' }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full" style={{ background: color }} />
      </div>
      <span className="font-mono text-xs flex-shrink-0" style={{ color, minWidth: '2.5rem', textAlign: 'right' }}>{score}</span>
    </div>
  )
}

function IntegrationRiskBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    high:    { bg: 'rgba(248,113,113,0.15)', color: RED },
    warning: { bg: 'rgba(245,158,11,0.15)',  color: AMBER },
    info:    { bg: 'rgba(74,222,128,0.10)',  color: GREEN },
  }
  const s = map[severity] ?? map.info
  return (
    <span className="nav-label text-[0.45rem] px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {severity.toUpperCase()}
    </span>
  )
}

function IntegrationTab({ data }: { data: IntegrationIntelligenceData }) {
  const { rows, summary } = data

  const avgII  = summary.avgIntegrationScore ?? 0
  const avgDoc = summary.avgDocActivityScore ?? 0

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Cpu}           label="AVG INT. SCORE"   value={avgII}            color={GOLD}  sub="integration intelligence" />
        <StatCard icon={FileText}      label="AVG DOC ACTIVITY" value={avgDoc}           color={BLUE}  sub="google docs signal" />
        <StatCard icon={AlertTriangle} label="HIGH RISK"        value={summary.highRisk} color={RED}   sub="doc activity < 35" />
        <StatCard icon={Clock}         label="WARNING"          value={summary.warningRisk} color={AMBER} sub="doc activity < 45" />
      </div>

      {/* Neutral signals notice */}
      <div className="glass-card rounded-sm p-4 flex items-start gap-3"
        style={{ border: '1px solid rgba(201,168,76,0.15)', background: 'rgba(201,168,76,0.04)' }}>
        <Link2 size={14} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
        <div>
          <p className="nav-label text-[0.55rem] mb-1" style={{ color: GOLD }}>INTEGRATION SIGNAL STATUS</p>
          <p className="font-body text-xs" style={{ color: ICE_DIM }}>
            Google Docs activity is fully implemented. Calendar load, collaboration, delivery reliability, and communication responsiveness
            are at neutral baseline (50) until their signal sources are persisted. Scores will auto-update as integrations come online.
          </p>
        </div>
      </div>

      {/* Per-intern table */}
      {rows.length === 0 ? (
        <div className="glass-card rounded-sm p-10 text-center">
          <Cpu size={28} className="mx-auto mb-3" style={{ color: ICE_DIM }} />
          <p className="font-body text-sm" style={{ color: ICE_DIM }}>No integration intelligence data available.</p>
        </div>
      ) : (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="INTEGRATION INTELLIGENCE" title="Per-Intern Signal Analysis" />
          <div className="overflow-x-auto">
            <table className="uris-table w-full" style={{ minWidth: '700px' }}>
              <thead>
                <tr>
                  <th className="text-left">Intern</th>
                  <th className="text-center" style={{ minWidth: '90px' }}>Int. Score</th>
                  <th className="text-left"   style={{ minWidth: '140px' }}>Doc Activity</th>
                  <th className="text-center" style={{ minWidth: '80px' }}>Collab.</th>
                  <th className="text-center" style={{ minWidth: '80px' }}>Delivery</th>
                  <th className="text-center" style={{ minWidth: '80px' }}>Cal. Load</th>
                  <th className="text-center" style={{ minWidth: '80px' }}>Comms.</th>
                  <th className="text-center">Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort((a, b) => a.integrationIntelligenceScore - b.integrationIntelligenceScore)
                  .map((row: IntegrationIntelligenceRow) => {
                    const iiScore  = row.integrationIntelligenceScore
                    const docScore = row.documentActivityScore
                    const iiColor  = iiScore >= 65 ? GREEN : iiScore >= 40 ? AMBER : RED
                    const docColor = docScore >= 65 ? GREEN : docScore >= 40 ? AMBER : RED

                    return (
                      <tr key={row.internId}>
                        <td>
                          <p className="font-mono text-xs text-frost/60">{row.internId.slice(0, 8)}…</p>
                          {row.documentActivity?.staleDocumentationRisk && (
                            <span className="nav-label text-[0.45rem] px-1.5 py-0.5 rounded-sm mt-0.5 inline-block"
                              style={{ background: 'rgba(248,113,113,0.1)', color: RED, border: '1px solid rgba(248,113,113,0.2)' }}>
                              STALE DOCS
                            </span>
                          )}
                        </td>
                        <td className="text-center">
                          <span className="font-display font-black text-lg" style={{ color: iiColor }}>{iiScore}</span>
                        </td>
                        <td>
                          <ScoreBar score={docScore} color={docColor} />
                          {row.documentActivity?.inactivityDurationDays != null && (
                            <p className="nav-label text-[0.45rem] mt-0.5" style={{ color: ICE_DIM }}>
                              {row.documentActivity.inactivityDurationDays}d inactive
                            </p>
                          )}
                        </td>
                        <td className="text-center">
                          <span className="font-mono text-xs" style={{ color: ICE_DIM }}>{row.collaborationScore}</span>
                          <p className="nav-label text-[0.4rem]" style={{ color: `${ICE_DIM}88` }}>neutral</p>
                        </td>
                        <td className="text-center">
                          <span className="font-mono text-xs" style={{ color: ICE_DIM }}>{row.deliveryReliabilityScore}</span>
                          <p className="nav-label text-[0.4rem]" style={{ color: `${ICE_DIM}88` }}>neutral</p>
                        </td>
                        <td className="text-center">
                          <span className="font-mono text-xs" style={{ color: ICE_DIM }}>{row.calendarLoadScore}</span>
                          <p className="nav-label text-[0.4rem]" style={{ color: `${ICE_DIM}88` }}>neutral</p>
                        </td>
                        <td className="text-center">
                          <span className="font-mono text-xs" style={{ color: ICE_DIM }}>{row.communicationResponsivenessScore}</span>
                          <p className="nav-label text-[0.4rem]" style={{ color: `${ICE_DIM}88` }}>neutral</p>
                        </td>
                        <td className="text-center">
                          <IntegrationRiskBadge severity={row.risk?.severity ?? 'info'} />
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Operational impact explainability */}
      {rows.filter(r => r.risk?.severity !== 'info').length > 0 && (
        <div className="glass-card rounded-sm p-5">
          <SectionHeader label="OPERATIONAL IMPACT" title="Flagged Interns" />
          <div className="space-y-3">
            {rows
              .filter(r => r.risk?.severity !== 'info')
              .sort((a, _b) => (a.risk?.severity === 'high' ? -1 : 1))
              .map(row => (
                <motion.div key={row.internId} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-sm"
                  style={{ background: row.risk?.severity === 'high' ? 'rgba(248,113,113,0.05)' : 'rgba(245,158,11,0.05)', border: `1px solid ${row.risk?.severity === 'high' ? 'rgba(248,113,113,0.15)' : 'rgba(245,158,11,0.15)'}` }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <IntegrationRiskBadge severity={row.risk?.severity ?? 'info'} />
                      <span className="font-mono text-xs text-frost/60">{row.internId.slice(0, 8)}…</span>
                      <span className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>
                        Doc Activity: {row.documentActivityScore} · Int. Score: {row.integrationIntelligenceScore}
                      </span>
                    </div>
                  </div>
                  <p className="font-body text-xs" style={{ color: AMBER }}>
                    → {row.explain?.integrationIntelligence?.operationalImpact ?? 'Review integration signals.'}
                  </p>
                  {(row.explain?.integrationIntelligence?.detectedPatterns?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {row.explain.integrationIntelligence.detectedPatterns.map((p: string) => (
                        <span key={p} className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
                          style={{ background: 'rgba(248,113,113,0.08)', color: 'rgba(248,113,113,0.7)', border: '1px solid rgba(248,113,113,0.15)' }}>
                          {p.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Enterprise Score Card ─────────────────────────────────────────────────────
function EnterpriseScoreCard({
  label, score, statusLabel, color, icon: Icon, detail, invertColor,
}: {
  label: string; score: number; statusLabel: string; color: string
  icon: React.ElementType; detail?: string; invertColor?: boolean
}) {
  // For risk: lower is better, so bar fills from right
  const barWidth = invertColor ? 100 - score : score
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-sm p-4 flex flex-col gap-2"
      style={{ border: `1px solid ${color}22` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-sm" style={{ background: `${color}15` }}>
            <Icon size={12} style={{ color }} />
          </div>
          <p className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>{label}</p>
        </div>
        <span className="nav-label text-[0.45rem] px-2 py-0.5 rounded-full"
          style={{ background: `${color}15`, color }}>
          {statusLabel.toUpperCase()}
        </span>
      </div>
      <div className="flex items-end gap-3">
        <p className="font-display font-black text-3xl leading-none" style={{ color }}>{score}</p>
        <div className="flex-1 pb-1">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(184,212,240,0.08)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${barWidth}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: color }}
            />
          </div>
        </div>
      </div>
      {detail && (
        <p className="nav-label text-[0.45rem] leading-relaxed" style={{ color: ICE_DIM }}>{detail}</p>
      )}
    </motion.div>
  )
}

// ── Live Counter ──────────────────────────────────────────────────────────────
function LiveCounter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass-card rounded-sm px-3 py-2 flex items-center justify-between gap-2"
      style={{ border: value > 0 ? `1px solid ${color}22` : '1px solid rgba(184,212,240,0.06)' }}>
      <p className="nav-label text-[0.45rem]" style={{ color: ICE_DIM }}>{label}</p>
      <span className="font-display font-black text-base" style={{ color: value > 0 ? color : ICE_DIM }}>
        {value}
      </span>
    </div>
  )
}

// ── Live Feed Panel ───────────────────────────────────────────────────────────
const FEED_SEVERITY_COLORS: Record<string, string> = {
  critical: '#f87171',
  high:     '#f87171',
  warning:  '#f59e0b',
  info:     'rgba(184,212,240,0.4)',
}

const FEED_TYPE_LABELS: Record<string, string> = {
  alert_update:         'ALERT',
  blocker_escalation:   'BLOCKER ESC.',
  stale_task:           'STALE TASKS',
  reassignment_rec:     'REASSIGNMENT',
  workload_update:      'WORKLOAD',
  integration_change:   'INTEGRATION',
  reservation_update:   'RESERVATION',
  enterprise_health:    'HEALTH UPDATE',
  operational_pulse:    'PULSE',
}

function LiveFeedPanel({ feed }: { feed: LiveFeedEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? feed : feed.slice(0, 5)
  const critCount = feed.filter(e => e.severity === 'critical').length

  return (
    <div className="glass-card rounded-sm p-4" style={{ border: '1px solid rgba(201,168,76,0.1)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: critCount > 0 ? '#f87171' : GOLD }} />
          <p className="nav-label text-[0.5rem]" style={{ color: GOLD }}>LIVE OPERATIONAL FEED</p>
          <span className="nav-label text-[0.45rem] px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(201,168,76,0.1)', color: GOLD }}>
            {feed.length}
          </span>
        </div>
        {feed.length > 5 && (
          <button onClick={() => setExpanded(e => !e)}
            className="nav-label text-[0.45rem] transition-colors"
            style={{ color: ICE_DIM }}>
            {expanded ? 'SHOW LESS' : `+${feed.length - 5} MORE`}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {visible.map(event => {
          const c = FEED_SEVERITY_COLORS[event.severity] ?? ICE_DIM
          return (
            <motion.div key={event.id}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-2.5 px-3 py-2 rounded-sm"
              style={{ background: `${c}08`, border: `1px solid ${c}18` }}>
              <span className="w-1 h-1 rounded-full flex-shrink-0 mt-1.5" style={{ background: c }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="nav-label text-[0.45rem] px-1.5 py-0.5 rounded-sm"
                    style={{ background: `${c}15`, color: c }}>
                    {FEED_TYPE_LABELS[event.type] ?? event.type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <p className="font-body text-xs flex-1 min-w-0 truncate" style={{ color: 'rgba(184,212,240,0.7)' }}>
                    {event.operationalImpact}
                  </p>
                </div>
              </div>
              <span className="nav-label text-[0.42rem] flex-shrink-0" style={{ color: ICE_DIM }}>
                {new Date(event.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export default function Intelligence() {
  const [data, setData]       = useState<AnalyticsDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tab, setTab]         = useState<Tab>('overview')
  const [googleData, setGoogleData]             = useState<GoogleIntelligence | null>(null)
  const [googleLoading, setGoogleLoading]       = useState(false)
  const [integrationData, setIntegrationData]   = useState<IntegrationIntelligenceData | null>(null)
  const [integrationLoading, setIntegrationLoading] = useState(false)
  const [unifiedData, setUnifiedData]           = useState<UnifiedIntelligenceData | null>(null)
  const [unifiedLoading, setUnifiedLoading]     = useState(false)

  // Realtime store
  const { status: socketStatus, counters, scores: liveScores, feed } = useRealtimeStore()
  const isLive = socketStatus === 'connected'

  // Refresh unified intelligence (called on mount + after live health event)
  const refreshUnified = useCallback(() => {
    setUnifiedLoading(true)
    getUnifiedIntelligence()
      .then(setUnifiedData)
      .catch(() => {})
      .finally(() => setUnifiedLoading(false))
  }, [])

  useEffect(() => { refreshUnified() }, [refreshUnified])

  useEffect(() => {
    if (tab !== 'google' || googleData) return
    setGoogleLoading(true)
    getGoogleIntelligence()
      .then(d => setGoogleData(d))
      .catch(() => setGoogleData(null))
      .finally(() => setGoogleLoading(false))
  }, [tab])

  useEffect(() => {
    if (tab !== 'integration' || integrationData) return
    setIntegrationLoading(true)
    getIntegrationIntelligence()
      .then(d => setIntegrationData(d))
      .catch(() => setIntegrationData(null))
      .finally(() => setIntegrationLoading(false))
  }, [tab])

  useEffect(() => {
    getAnalyticsDashboard()
      .then(setData)
      .catch(err => setError(extractErrorMessage(err, 'Failed to load analytics data.')))
      .finally(() => setLoading(false))
  }, [])

  // Merge live scores into unified display: prefer live socket scores when available
  const displayScores = liveScores ?? (unifiedData ? {
    enterpriseHealth: { score: unifiedData.enterpriseHealth.score, label: unifiedData.enterpriseHealth.label },
    operationalRisk:  { score: unifiedData.operationalRisk.score,  label: unifiedData.operationalRisk.label  },
    teamStability:    { score: unifiedData.teamStability.score,    label: unifiedData.teamStability.label    },
    liveSignals:      unifiedData.liveSignals,
  } : null)

  return (
    <div className="min-h-screen bg-navy-950 text-frost">
      <Starfield />
      <Sidebar />
      <main className="md:ml-52 pt-14 min-h-screen relative z-10">
        <div className="px-4 md:px-8 py-8">

          {/* ── Header ── */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="nav-label text-[0.55rem] mb-1" style={{ color: `${GOLD}66`, letterSpacing: '0.4em' }}>PHASE 7</p>
                <h1 className="font-display font-black text-3xl text-ice-gradient">Operational Intelligence</h1>
                <div className="gold-rule w-14 mt-2" />
                <p className="font-body text-sm mt-2" style={{ color: ICE_DIM }}>
                  Workload · Task risks · Assignment readiness · Trends · Alert intelligence
                </p>
              </div>
              {/* Live connection indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm"
                style={{ background: isLive ? 'rgba(74,222,128,0.08)' : 'rgba(184,212,240,0.05)', border: `1px solid ${isLive ? 'rgba(74,222,128,0.2)' : 'rgba(184,212,240,0.1)'}` }}>
                {isLive
                  ? <><motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" /><Wifi size={11} style={{ color: GREEN }} /><span className="nav-label text-[0.5rem]" style={{ color: GREEN }}>LIVE</span></>
                  : <><WifiOff size={11} style={{ color: ICE_DIM }} /><span className="nav-label text-[0.5rem]" style={{ color: ICE_DIM }}>OFFLINE</span></>
                }
              </div>
            </div>
          </motion.div>

          {/* ── Enterprise Health Cards (always visible) ── */}
          {(displayScores || unifiedLoading) && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Radio size={12} style={{ color: GOLD }} />
                <p className="nav-label text-[0.5rem]" style={{ color: `${GOLD}88` }}>ENTERPRISE INTELLIGENCE</p>
                {isLive && <motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-1 h-1 rounded-full bg-green-400" />}
                {unifiedLoading && <Loader2 size={10} className="animate-spin" style={{ color: ICE_DIM }} />}
                <button onClick={refreshUnified} className="ml-auto p-1 rounded-sm transition-colors hover:bg-white/5" title="Refresh">
                  <RefreshCw size={10} style={{ color: ICE_DIM }} />
                </button>
              </div>
              {displayScores ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <EnterpriseScoreCard
                    label="ENTERPRISE HEALTH"
                    score={displayScores.enterpriseHealth.score}
                    statusLabel={displayScores.enterpriseHealth.label}
                    color={displayScores.enterpriseHealth.score >= 75 ? GREEN : displayScores.enterpriseHealth.score >= 50 ? AMBER : RED}
                    icon={Activity}
                    detail={unifiedData?.enterpriseHealth.explainability.workloadReasoning}
                  />
                  <EnterpriseScoreCard
                    label="OPERATIONAL RISK"
                    score={displayScores.operationalRisk.score}
                    statusLabel={displayScores.operationalRisk.label}
                    color={displayScores.operationalRisk.score >= 70 ? RED : displayScores.operationalRisk.score >= 45 ? AMBER : GREEN}
                    icon={ShieldAlert}
                    detail={unifiedData?.operationalRisk.explainability.workloadReasoning}
                    invertColor
                  />
                  <EnterpriseScoreCard
                    label="TEAM STABILITY"
                    score={displayScores.teamStability.score}
                    statusLabel={displayScores.teamStability.label}
                    color={displayScores.teamStability.score >= 75 ? GREEN : displayScores.teamStability.score >= 50 ? AMBER : RED}
                    icon={Users}
                    detail={unifiedData?.teamStability.explainability.workloadReasoning}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="glass-card rounded-sm p-4 animate-pulse" style={{ height: 88 }} />
                  ))}
                </div>
              )}

              {/* Live signal counters row */}
              {(displayScores?.liveSignals || counters.unresolvedAlerts > 0) && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <LiveCounter label="UNRESOLVED ALERTS" value={counters.unresolvedAlerts || displayScores?.liveSignals?.totalUnresolvedAlerts || 0} color={counters.criticalAlerts > 0 ? RED : AMBER} />
                  <LiveCounter label="CRITICAL ALERTS"   value={counters.criticalAlerts   || displayScores?.liveSignals?.unresolvedEscalations || 0} color={RED} />
                  <LiveCounter label="STALE TASKS"       value={counters.staleTasks       || displayScores?.liveSignals?.staleTaskWarnings || 0}     color={AMBER} />
                  <LiveCounter label="BLOCKED TASKS"     value={counters.blockedTasks     || 0}                                                       color={AMBER} />
                  <LiveCounter label="OVERLOAD WARNINGS" value={displayScores?.liveSignals?.overloadWarnings || 0}                                    color={RED} />
                  <LiveCounter label="INTEGRATION RISK"  value={displayScores?.liveSignals?.integrationRiskCount || 0}                               color={GOLD} />
                </div>
              )}

              {/* Executive summary */}
              {unifiedData?.executiveSummary && (
                <div className="mt-3 glass-card rounded-sm p-4" style={{ border: '1px solid rgba(201,168,76,0.12)' }}>
                  <p className="nav-label text-[0.5rem] mb-1" style={{ color: `${GOLD}66` }}>EXECUTIVE SUMMARY</p>
                  <p className="font-body text-sm" style={{ color: ICE_DIM }}>{unifiedData.executiveSummary.headline}</p>
                  {unifiedData.executiveSummary.urgentActions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {unifiedData.executiveSummary.urgentActions.slice(0, 3).map((a, i) => (
                        <span key={i} className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
                          style={{ background: 'rgba(248,113,113,0.08)', color: RED, border: '1px solid rgba(248,113,113,0.15)' }}>
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {unifiedData.executiveSummary.crossSystemWarnings.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {unifiedData.executiveSummary.crossSystemWarnings.map((w, i) => (
                        <span key={i} className="nav-label text-[0.45rem] px-2 py-0.5 rounded-sm"
                          style={{ background: 'rgba(245,158,11,0.08)', color: AMBER, border: '1px solid rgba(245,158,11,0.15)' }}>
                          ⚠ {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Live Operational Feed (shown when events exist) ── */}
          {feed.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
              <LiveFeedPanel feed={feed} />
            </motion.div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={24} className="animate-spin" style={{ color: GOLD }} />
            </div>
          )}

          {!loading && error && (
            <div className="glass-card rounded-sm p-8 text-center max-w-md mx-auto">
              <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: RED }} />
              <p className="font-body text-sm" style={{ color: ICE_DIM }}>{error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <>
              <div className="flex flex-wrap gap-1 mb-6 glass-card rounded-sm p-1 overflow-x-auto">
                {TABS.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-sm nav-label text-[0.55rem] transition-all duration-200 whitespace-nowrap"
                    style={{
                      background:   tab === t.key ? 'rgba(201,168,76,0.12)' : 'transparent',
                      borderBottom: tab === t.key ? `2px solid ${GOLD}` : '2px solid transparent',
                      color:        tab === t.key ? GOLD : ICE_DIM,
                    }}>
                    <t.icon size={12} />
                    {t.label}
                  </button>
                ))}
              </div>

              <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {tab === 'overview'   && <OverviewTab   data={data} />}
                {tab === 'risks'      && <RisksTab      data={data} />}
                {tab === 'assignment' && <AssignmentTab data={data} />}
                {tab === 'workload'   && <WorkloadTab   data={data} />}
                {tab === 'trends'     && <TrendsTab     data={data} />}
                {tab === 'alerts'     && <AlertsTab     data={data} />}
                {tab === 'teams'      && <TeamsTab      data={data} />}
                {tab === 'digest'     && <DigestTab     data={data} />}
                {tab === 'google'     && (
                  googleLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="text-gold animate-spin" />
                    </div>
                  ) : googleData ? (
                    <GoogleTab data={googleData} />
                  ) : (
                    <div className="glass-card rounded-sm p-10 text-center">
                      <p className="font-body text-sm text-ice/30">Google intelligence data unavailable.</p>
                    </div>
                  )
                )}
                {tab === 'integration' && (
                  integrationLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="text-gold animate-spin" />
                    </div>
                  ) : integrationData ? (
                    <IntegrationTab data={integrationData} />
                  ) : (
                    <div className="glass-card rounded-sm p-10 text-center">
                      <Cpu size={28} className="mx-auto mb-3" style={{ color: ICE_DIM }} />
                      <p className="font-body text-sm text-ice/30">Integration intelligence data unavailable.</p>
                    </div>
                  )
                )}
                {tab === 'presence' && <PresenceIntelligenceTab />}
              </motion.div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}