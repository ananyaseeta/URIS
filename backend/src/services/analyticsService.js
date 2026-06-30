'use strict';

/**
 * analyticsService.js — Phase 7 Operational Intelligence Layer
 *
 * All aggregation queries for the operational analytics dashboard.
 * Every function is pure DB → data; no HTTP concerns here.
 *
 * Sections:
 *   1. Workload analytics
 *   2. Trend analytics (capacity / performance / workload growth)
 *   3. SLA monitoring
 *   4. Team health overview
 *   5. Weekly operational digest summary
 */

const prisma = require('../utils/prisma');
const { getRpiWindowStart } = require('./performanceEngine');
const {
  calculateTaskTLI,
  calculateInternTLI,
  calculateEffectiveTLI,
  determineLoadBand,
} = require('./tliEngine');
const { generateReassignmentRecommendation } = require('./reassignmentEngine');

// Reassignment recommendation-only payload for the Intelligence dashboard.
// Note: This is derived on-the-fly from existing tables/signals.
async function getReassignmentRecommendations() {
  // Candidate pool: all interns (filtering is handled by reassignmentEngine).
  const interns = await prisma.intern.findMany({
    include: {
      user: { select: { name: true, email: true } },
      tasks: {
        where: { status: { notIn: ['completed', 'cancelled'] } },
        select: { status: true, hasBlocker: true, blockerType: true, lastUpdatedAt: true, deadline: true },
      },
      scoreHistory: {
        where: { type: 'capacity' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { score: true },
      },
      credibility: { select: { score: true } },
      // Include reviews within the RPI window so performanceScore is real.
      // Source: Review table — quality/timeliness/initiative ratings submitted by admins.
      reviews: {
        where: { createdAt: { gte: getRpiWindowStart() } },
        select: { quality: true, timeliness: true, initiative: true },
      },
    },
  });

  const now = new Date();
  const nowMs = now.getTime();

  // Precompute owner contexts from interns.
  const ownerContexts = interns.map(intern => {
    const capacityScore = intern.scoreHistory[0] ? Math.round(intern.scoreHistory[0].score) : 0;
    const credScore = intern.credibility ? Math.round(intern.credibility.score * 100) : 50;

    const activeTasks = intern.tasks.filter(t => t.status === 'active');
    const rawTli = calculateInternTLI(activeTasks);
    const effectiveTli = calculateEffectiveTLI(rawTli, capacityScore, credScore);

    // stale/blocker signals are per-intern proxy: max across tasks
    const staleDays = activeTasks.length
      ? Math.max(
          ...activeTasks.map(t => Math.floor((nowMs - new Date(t.lastUpdatedAt).getTime()) / (24 * 60 * 60 * 1000)))
        )
      : 0;

    // blocker escalation proxy: hours since last updated for blocked tasks
    const blockedTasks = activeTasks.filter(t => t.hasBlocker);
    const blockerEscalationHours = blockedTasks.length
      ? Math.max(...blockedTasks.map(t => (nowMs - new Date(t.lastUpdatedAt).getTime()) / (1000 * 60 * 60)))
      : 0;

    const unresolvedAlertCount = 0; // derived later from Alert table if available

    const owner = {
      internId: intern.id,
      name: intern.user?.name || intern.user?.email?.split('@')[0] || intern.id,
      capacityScore,
      effectiveTli,
      credibilityScore: credScore,
      blockerEscalationHours,
      unresolvedAlertCount,
      // status/inactive/blocked fields are derived from existing signals
      status: 'active',
      hasBlocker: blockedTasks.length > 0,
      blockerType: blockedTasks[0]?.blockerType,
    };

    return { owner, ownerTask: { id: `owner-${intern.id}` , staleDays } };
  });

  // If alert table exists, compute unresolved alert counts per intern.
  // (Schema has Alert model in the repo; this is still wrapped for safety.)
  let alerts = [];
  try {
    alerts = await prisma.alert.findMany({ where: { resolved: false }, select: { internId: true } });
  } catch {
    alerts = [];
  }
  const alertsByIntern = {};
  for (const a of alerts) {
    alertsByIntern[a.internId] = (alertsByIntern[a.internId] || 0) + 1;
  }

  // Candidate pool for replacements.
  // We enrich candidates with availability/creditability/performance approximations.
  // AvailabilityScore: reuse capacity score bucket scaled to 0..100.
  const candidates = interns.map(intern => {
    const capacityScore = intern.scoreHistory[0] ? Math.round(intern.scoreHistory[0].score) : 0;
    const credScore = intern.credibility ? Math.round(intern.credibility.score * 100) : 50;

    const activeTasks = intern.tasks.filter(t => t.status === 'active');
    const rawTli = calculateInternTLI(activeTasks);
    const effectiveTli = calculateEffectiveTLI(rawTli, capacityScore, credScore);

    const blockedTasks = activeTasks.filter(t => t.hasBlocker);
    const staleDays = activeTasks.length
      ? Math.max(...activeTasks.map(t => Math.floor((nowMs - new Date(t.lastUpdatedAt).getTime()) / (24 * 60 * 60 * 1000))))
      : 0;

    const loadBand = determineLoadBand(effectiveTli);
    const unresolvedAlertCount = alertsByIntern[intern.id] || 0;

    // performanceScore: derived from real Review records within the RPI window.
    // Formula: avg(quality + timeliness + initiative) / 3 scaled from 1–5 to 0–100.
    // Returns null when no reviews exist — never injects a fabricated score.
    const performanceScore = intern.reviews && intern.reviews.length > 0
      ? parseFloat(
          (
            intern.reviews.reduce((s, r) => s + (r.quality + r.timeliness + r.initiative) / 3, 0)
            / intern.reviews.length
            * 20  // convert 0–5 → 0–100
          ).toFixed(1)
        )
      : null;

    return {
      internId: intern.id,
      name: intern.user?.name || intern.user?.email?.split('@')[0] || intern.id,
      availabilityScore: capacityScore, // already 0..100
      credibilityScore: credScore, // 0..100
      // performanceScore: real RPI from Review table (null = no reviews yet)
      performanceScore,
      effectiveTli,
      loadBand,
      status: intern.user?.status || 'active',
      isInactive: false,
      hasBlocker: blockedTasks.length > 0,
      isBlocked: blockedTasks.length > 0,
      blockerType: blockedTasks[0]?.blockerType,
      unresolvedAlertCount,
      staleTasksDays: staleDays,
    };
  });

  const overloadThreshold = OVERLOAD_THRESHOLD;
  const lowCredibilityThreshold = LOW_CRED_THRESHOLD;
  const results = [];

  // Select failing owners by triggers.
  for (const { owner, ownerTask } of ownerContexts) {
    const riskTriggers = [];

    if (owner.capacityScore < 20) riskTriggers.push('capacity');
    if (owner.effectiveTli > overloadThreshold) riskTriggers.push('overload');
    if (owner.blockerEscalationHours >= 96) riskTriggers.push('blocker');
    if ((ownerTask.staleDays || 0) > 4) riskTriggers.push('stale');

    const unresolvedAlertCount = alertsByIntern[owner.internId] || 0;
    if (unresolvedAlertCount >= 5) riskTriggers.push('alerts');

    if (riskTriggers.length === 0) continue;

    // Update owner unresolvedAlertCount
    owner.unresolvedAlertCount = unresolvedAlertCount;

    // Candidate shortlist should exclude the owner itself.
    const shortlistCandidates = candidates.filter(c => c.internId !== owner.internId);

    const rec = generateReassignmentRecommendation({
      owner,
      ownerTask: { id: ownerTask.id, staleDays: ownerTask.staleDays || 0 },
      candidates: shortlistCandidates,
      overloadThreshold,
      lowCredibilityThreshold,
      deadlineUrgencyMultiplier: 1,
      topK: 3,
    });

    results.push(rec);
  }

  // Sort recommendations by priority desc.
  results.sort((a, b) => b.priority - a.priority);

  return {
    count: results.length,
    recommendations: results.slice(0, 10),
  };
}





// ── Config ────────────────────────────────────────────────────────────────────

const SLA_SUPPORT_HOURS      = parseInt(process.env.SLA_SUPPORT_HOURS)      || 48;  // unresolved > 48h = SLA breach
const SLA_STALE_DAYS         = parseInt(process.env.SLA_STALE_DAYS)         || 3;   // stale task threshold
const SLA_OVERDUE_DAYS       = parseInt(process.env.SLA_OVERDUE_DAYS)       || 0;   // past deadline = overdue
const LOW_CAPACITY_THRESHOLD = parseInt(process.env.LOW_CAPACITY_THRESHOLD) || 30;
const OVERLOAD_THRESHOLD     = parseInt(process.env.OVERLOAD_THRESHOLD)     || 12;  // TLI > 12 = overloaded
const LOW_CRED_THRESHOLD     = parseInt(process.env.LOW_CRED_THRESHOLD)     || 40;  // credibility < 40 = low
const TREND_WEEKS            = parseInt(process.env.TREND_WEEKS)            || 8;   // weeks of history for trends

// ── 1. Workload Analytics ─────────────────────────────────────────────────────

/**
 * Returns workload distribution across all interns:
 *   - Per-intern: name, capacityScore, tli, activeTasks, staleTasks, blockedTasks, status
 *   - Summary: overloaded count, low-capacity count, healthy count
 */
async function getWorkloadDistribution() {
  const interns = await prisma.intern.findMany({

    include: {
      user: { select: { name: true, email: true } },
      tasks: {
        where: { status: { notIn: ['completed', 'cancelled'] } },
        select: { status: true, complexity: true, progressPct: true, hasBlocker: true, deadline: true },
      },
      scoreHistory: {
        where:   { type: 'capacity' },
        orderBy: { createdAt: 'desc' },
        take:    1,
        select:  { score: true },
      },
    },
  });

  const now = new Date();

  const rows = interns.map(intern => {
    const activeTasks  = intern.tasks.filter(t => t.status === 'active');
    const staleTasks   = intern.tasks.filter(t => t.status === 'stale');
    const blockedTasks = intern.tasks.filter(t => t.hasBlocker);
    const overdueTasks = intern.tasks.filter(t => t.deadline && new Date(t.deadline) < now);

    const rawTli = calculateInternTLI(activeTasks);
    const tli = rawTli;

    const capacityScore = intern.scoreHistory[0]
      ? Math.round(intern.scoreHistory[0].score)
      : 0;

    const name = intern.user?.name || intern.user?.email?.split('@')[0] || intern.id;

    return {
      internId:      intern.id,
      name,
      capacityScore,
      tli:           parseFloat(tli.toFixed(2)),
      activeTasks:   activeTasks.length,
      staleTasks:    staleTasks.length,
      blockedTasks:  blockedTasks.length,
      overdueTasks:  overdueTasks.length,
      status:        capacityScore >= 70 ? 'healthy'
                   : capacityScore >= LOW_CAPACITY_THRESHOLD ? 'moderate'
                   : 'low',
      isOverloaded:  tli > OVERLOAD_THRESHOLD,
    };
  });

  const overloaded   = rows.filter(r => r.isOverloaded).length;
  const lowCapacity  = rows.filter(r => r.capacityScore < LOW_CAPACITY_THRESHOLD).length;
  const healthy      = rows.filter(r => r.status === 'healthy').length;

  return {
    interns: rows,
    summary: {
      total:        rows.length,
      overloaded,
      lowCapacity,
      healthy,
      withBlockers: rows.filter(r => r.blockedTasks > 0).length,
      withStale:    rows.filter(r => r.staleTasks > 0).length,
    },
  };
}

/**
 * Returns unresolved support requests grouped by status and priority,
 * plus a list of requests breaching the SLA threshold.
 * Degrades gracefully if the SupportRequest table does not exist.
 */
async function getSupportRequestSummary() {
  try {
    const [all, breaching] = await Promise.all([
      prisma.supportRequest.findMany({
        where:   { status: { notIn: ['resolved', 'closed'] } },
        select:  { id: true, title: true, category: true, status: true, priority: true, createdAt: true, assignedToId: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.supportRequest.findMany({
        where: {
          status:    { notIn: ['resolved', 'closed'] },
          createdAt: { lt: new Date(Date.now() - SLA_SUPPORT_HOURS * 60 * 60 * 1000) },
        },
        select: { id: true, title: true, priority: true, category: true, createdAt: true, assignedToId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const byStatus   = {};
    const byPriority = {};
    for (const r of all) {
      byStatus[r.status]     = (byStatus[r.status]     || 0) + 1;
      byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
    }

    return {
      total:      all.length,
      unassigned: all.filter(r => !r.assignedToId).length,
      byStatus,
      byPriority,
      slaBreach:  breaching,
      slaBreachCount: breaching.length,
      slaThresholdHours: SLA_SUPPORT_HOURS,
    };
  } catch {
    return { total: 0, unassigned: 0, byStatus: {}, byPriority: {}, slaBreach: [], slaBreachCount: 0, slaThresholdHours: SLA_SUPPORT_HOURS };
  }
}

// ── 2. Trend Analytics ────────────────────────────────────────────────────────

/**
 * Returns weekly capacity / credibility / performance trends from InternDigest.
 * Aggregates across all interns per week: avg, min, max.
 * Returns the last TREND_WEEKS weeks.
 */
async function getScoreTrends() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - TREND_WEEKS * 7);

  const digests = await prisma.internDigest.findMany({
    where:   { weekStart: { gte: since } },
    orderBy: { weekStart: 'asc' },
    select:  { weekStart: true, capacityScore: true, credibilityScore: true, performanceIndex: true, internId: true },
  });

  // Group by weekStart
  const byWeek = {};
  for (const d of digests) {
    const key = d.weekStart.toISOString().split('T')[0];
    if (!byWeek[key]) byWeek[key] = { capacity: [], credibility: [], performance: [] };
    byWeek[key].capacity.push(d.capacityScore);
    byWeek[key].credibility.push(d.credibilityScore);
    byWeek[key].performance.push(d.performanceIndex * 20); // scale to 0–100
  }

  const weeks = Object.entries(byWeek).map(([week, data]) => {
    const avg = arr => arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1)) : 0;
    const min = arr => arr.length ? Math.round(Math.min(...arr)) : 0;
    const max = arr => arr.length ? Math.round(Math.max(...arr)) : 0;

    return {
      week,
      capacity:    { avg: avg(data.capacity),    min: min(data.capacity),    max: max(data.capacity) },
      credibility: { avg: avg(data.credibility), min: min(data.credibility), max: max(data.credibility) },
      performance: { avg: avg(data.performance), min: min(data.performance), max: max(data.performance) },
      internCount: data.capacity.length,
    };
  });

  return { weeks, trendWeeks: TREND_WEEKS };
}

/**
 * Returns workload growth trend: active task count per week from InternDigest.
 * Also returns assignment density (tasks per intern) per week.
 */
async function getWorkloadTrend() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - TREND_WEEKS * 7);

  const digests = await prisma.internDigest.findMany({
    where:   { weekStart: { gte: since } },
    orderBy: { weekStart: 'asc' },
    select:  { weekStart: true, activeTasks: true, completedTasks: true, internId: true },
  });

  const byWeek = {};
  for (const d of digests) {
    const key = d.weekStart.toISOString().split('T')[0];
    if (!byWeek[key]) byWeek[key] = { active: 0, completed: 0, interns: 0 };
    byWeek[key].active    += d.activeTasks;
    byWeek[key].completed += d.completedTasks;
    byWeek[key].interns   += 1;
  }

  const weeks = Object.entries(byWeek).map(([week, data]) => ({
    week,
    totalActiveTasks:    data.active,
    totalCompletedTasks: data.completed,
    internCount:         data.interns,
    assignmentDensity:   data.interns > 0
      ? parseFloat((data.active / data.interns).toFixed(2))
      : 0,
  }));

  return { weeks, trendWeeks: TREND_WEEKS };
}

/**
 * Returns per-intern capacity score history for the last N weeks.
 * Used for individual trend sparklines.
 */
async function getCapacityHistory(internId, weeks = TREND_WEEKS) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - weeks * 7);

  const history = await prisma.scoreHistory.findMany({
    where:   { internId, type: 'capacity', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select:  { score: true, createdAt: true },
  });

  return history.map(h => ({
    date:  h.createdAt.toISOString().split('T')[0],
    score: Math.round(h.score),
  }));
}

// ── 3. SLA Monitoring ─────────────────────────────────────────────────────────

/**
 * Returns a full SLA status report:
 *   - Stale tasks (not updated in SLA_STALE_DAYS days)
 *   - Overdue tasks (past deadline)
 *   - Support requests breaching SLA
 *   - Unresolved blockers
 */
async function getSLAStatus() {
  const now          = new Date();
  const staleThresh  = new Date(now.getTime() - SLA_STALE_DAYS  * 24 * 60 * 60 * 1000);
  const slaThresh    = new Date(now.getTime() - SLA_SUPPORT_HOURS * 60 * 60 * 1000);

  const [staleTasks, overdueTasks, unresolvedBlockers, supportBreaches] = await Promise.all([
    // Stale: active tasks not updated in SLA_STALE_DAYS days
    prisma.task.findMany({
      where: {
        status:        { in: ['active', 'stale'] },
        lastUpdatedAt: { lt: staleThresh },
      },
      select: {
        id: true, title: true, internId: true, lastUpdatedAt: true, deadline: true, status: true,
        intern: { select: { user: { select: { name: true } } } },
      },
      orderBy: { lastUpdatedAt: 'asc' },
      take:    50,
    }),

    // Overdue: past deadline, not completed
    prisma.task.findMany({
      where: {
        deadline:  { lt: now, not: null },
        status:    { notIn: ['completed', 'cancelled'] },
      },
      select: {
        id: true, title: true, internId: true, deadline: true, status: true, progressPct: true,
        intern: { select: { user: { select: { name: true } } } },
      },
      orderBy: { deadline: 'asc' },
      take:    50,
    }),

    // Unresolved blockers
    prisma.task.findMany({
      where: { hasBlocker: true, status: { notIn: ['completed', 'cancelled'] } },
      select: {
        id: true, title: true, internId: true, blockerType: true, lastUpdatedAt: true,
        intern: { select: { user: { select: { name: true } } } },
      },
      orderBy: { lastUpdatedAt: 'asc' },
      take:    50,
    }),

    // Support SLA breaches — degrades gracefully if SupportRequest table doesn't exist
    Promise.resolve().then(() => prisma.supportRequest?.findMany({
      where: {
        status:    { notIn: ['resolved', 'closed'] },
        createdAt: { lt: slaThresh },
      },
      select: { id: true, title: true, priority: true, category: true, createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
      take:    50,
    }) ?? []).catch(() => []),
  ]);

  return {
    staleTasks: staleTasks.map(t => ({
      id:            t.id,
      title:         t.title,
      internId:      t.internId,
      internName:    t.intern?.user?.name || t.internId,
      lastUpdatedAt: t.lastUpdatedAt,
      deadline:      t.deadline,
      status:        t.status,
      daysSinceUpdate: Math.floor((now - new Date(t.lastUpdatedAt)) / (24 * 60 * 60 * 1000)),
    })),
    overdueTasks: overdueTasks.map(t => ({
      id:          t.id,
      title:       t.title,
      internId:    t.internId,
      internName:  t.intern?.user?.name || t.internId,
      deadline:    t.deadline,
      status:      t.status,
      progressPct: t.progressPct,
      daysOverdue: Math.floor((now - new Date(t.deadline)) / (24 * 60 * 60 * 1000)),
    })),
    unresolvedBlockers: unresolvedBlockers.map(t => ({
      id:            t.id,
      title:         t.title,
      internId:      t.internId,
      internName:    t.intern?.user?.name || t.internId,
      blockerType:   t.blockerType,
      lastUpdatedAt: t.lastUpdatedAt,
    })),
    supportBreaches: supportBreaches.map(r => ({
      id:        r.id,
      title:     r.title,
      priority:  r.priority,
      category:  r.category,
      createdAt: r.createdAt,
      status:    r.status,
      hoursOpen: Math.floor((now - new Date(r.createdAt)) / (60 * 60 * 1000)),
    })),
    counts: {
      staleTasks:         staleTasks.length,
      overdueTasks:       overdueTasks.length,
      unresolvedBlockers: unresolvedBlockers.length,
      supportBreaches:    supportBreaches.length,
    },
    thresholds: {
      staleDays:        SLA_STALE_DAYS,
      supportHours:     SLA_SUPPORT_HOURS,
    },
  };
}

// ── 4. Team Health Overview ───────────────────────────────────────────────────

/**
 * Returns per-team health metrics:
 *   - avg capacity, avg RPI, intern count
 *   - overloaded interns, low-capacity interns
 *   - inactive teams (no active tasks)
 */
async function getTeamHealth() {
  const [teams, userTeams, interns] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.userTeam.findMany({
      where:   { leftAt: null },
      select:  { userId: true, teamId: true },
    }),
    prisma.intern.findMany({
      include: {
        user:  { select: { id: true, name: true } },
        tasks: {
          where:  { status: { notIn: ['completed', 'cancelled'] } },
          select: { status: true, complexity: true, progressPct: true },
        },
        scoreHistory: {
          where:   { type: 'capacity' },
          orderBy: { createdAt: 'desc' },
          take:    1,
          select:  { score: true },
        },
        reviews: {
          where:  { createdAt: { gte: getRpiWindowStart() } },
          select: { quality: true, timeliness: true, initiative: true },
        },
      },
    }),
  ]);

  // Build userId → intern map
  const userToIntern = {};
  for (const intern of interns) {
    if (intern.user?.id) userToIntern[intern.user.id] = intern;
  }

  // Build teamId → userIds map
  const teamToUsers = {};
  for (const ut of userTeams) {
    if (!teamToUsers[ut.teamId]) teamToUsers[ut.teamId] = [];
    teamToUsers[ut.teamId].push(ut.userId);
  }

  const teamRows = teams.map(team => {
    const memberUserIds = teamToUsers[team.id] || [];
    const memberInterns = memberUserIds
      .map(uid => userToIntern[uid])
      .filter(Boolean);

    const capacityScores = memberInterns.map(i =>
      i.scoreHistory[0] ? Math.round(i.scoreHistory[0].score) : 0
    );

    const rpiScores = memberInterns.map(i => {
      if (!i.reviews.length) return 0;
      return parseFloat(
        (i.reviews.reduce((s, r) => s + (r.quality + r.timeliness + r.initiative) / 3, 0)
          / i.reviews.length * 20).toFixed(1)
      );
    });

    const tliValues = memberInterns.map(i =>
      i.tasks.filter(t => t.status === 'active').reduce(
        (sum, t) => sum + t.complexity * (1 - t.progressPct / 100), 0
      )
    );

    const avg = arr => arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1)) : 0;

    const avgCapacity = avg(capacityScores);
    const avgRpi      = avg(rpiScores);
    const avgTli      = avg(tliValues);

    const overloadedCount  = tliValues.filter(t => t > OVERLOAD_THRESHOLD).length;
    const lowCapacityCount = capacityScores.filter(c => c < LOW_CAPACITY_THRESHOLD).length;
    const activeTasks      = memberInterns.reduce((s, i) => s + i.tasks.filter(t => t.status === 'active').length, 0);

    return {
      id:             team.id,
      name:           team.name,
      internCount:    memberInterns.length,
      avgCapacity,
      avgRpi,
      avgTli,
      overloadedCount,
      lowCapacityCount,
      activeTasks,
      isInactive:     activeTasks === 0 && memberInterns.length > 0,
      isOverloaded:   overloadedCount > 0,
      healthStatus:   avgCapacity >= 60 ? 'healthy' : avgCapacity >= 35 ? 'moderate' : 'critical',
    };
  });

  return {
    teams: teamRows,
    summary: {
      totalTeams:      teamRows.length,
      healthyTeams:    teamRows.filter(t => t.healthStatus === 'healthy').length,
      criticalTeams:   teamRows.filter(t => t.healthStatus === 'critical').length,
      inactiveTeams:   teamRows.filter(t => t.isInactive).length,
      overloadedTeams: teamRows.filter(t => t.isOverloaded).length,
    },
  };
}

// ── 5. Weekly Operational Digest Summary ─────────────────────────────────────

/**
 * Returns a digest-style summary for the current week:
 *   - Interns with low credibility
 *   - Interns with inactive tasks (no progress in 7 days)
 *   - Overdue support requests
 *   - Unresolved blockers
 */
async function getOperationalDigest() {
  const now         = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [lowCredInterns, inactiveTasks, overdueRequests] = await Promise.all([
    // Low credibility interns
    prisma.credibilityScore.findMany({
      where:  { score: { lt: LOW_CRED_THRESHOLD / 100 } }, // score is 0–1 float
      select: {
        internId: true,
        score:    true,
        intern:   { select: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { score: 'asc' },
      take:    20,
    }),

    // Inactive tasks: active but no progress update in 7 days
    prisma.task.findMany({
      where: {
        status:        'active',
        lastUpdatedAt: { lt: sevenDaysAgo },
      },
      select: {
        id: true, title: true, internId: true, progressPct: true, lastUpdatedAt: true,
        intern: { select: { user: { select: { name: true } } } },
      },
      orderBy: { lastUpdatedAt: 'asc' },
      take:    30,
    }),

    // Overdue support requests (open > 72h) — degrades gracefully if table doesn't exist
    Promise.resolve().then(() => prisma.supportRequest?.findMany({
      where: {
        status:    { notIn: ['resolved', 'closed'] },
        createdAt: { lt: new Date(now.getTime() - 72 * 60 * 60 * 1000) },
      },
      select: { id: true, title: true, priority: true, category: true, createdAt: true, status: true, assignedToId: true },
      orderBy: { createdAt: 'asc' },
      take:    20,
    }) ?? []).catch(() => []),
  ]);

  return {
    lowCredibilityInterns: lowCredInterns.map(c => ({
      internId:        c.internId,
      name:            c.intern?.user?.name || c.internId,
      credibilityScore: Math.round(c.score * 100),
    })),
    inactiveTasks: inactiveTasks.map(t => ({
      id:            t.id,
      title:         t.title,
      internId:      t.internId,
      internName:    t.intern?.user?.name || t.internId,
      progressPct:   t.progressPct,
      lastUpdatedAt: t.lastUpdatedAt,
      daysSinceUpdate: Math.floor((now - new Date(t.lastUpdatedAt)) / (24 * 60 * 60 * 1000)),
    })),
    overdueRequests: overdueRequests.map(r => ({
      id:         r.id,
      title:      r.title,
      priority:   r.priority,
      category:   r.category,
      createdAt:  r.createdAt,
      status:     r.status,
      unassigned: !r.assignedToId,
      hoursOpen:  Math.floor((now - new Date(r.createdAt)) / (60 * 60 * 1000)),
    })),
    counts: {
      lowCredibilityInterns: lowCredInterns.length,
      inactiveTasks:         inactiveTasks.length,
      overdueRequests:       overdueRequests.length,
    },
  };
}

// ── 6. Task Risk Intelligence ─────────────────────────────────────────────────

/**
 * Produces a severity-ranked list of at-risk tasks with reasons and suggested actions.
 * Risk factors: overdue, stale, blocked, high complexity + low progress, deadline imminent.
 */
async function getTaskRiskIntelligence() {
  const now           = new Date();
  const staleThresh   = new Date(now.getTime() - SLA_STALE_DAYS * 24 * 60 * 60 * 1000);
  const imminentThresh = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days

  const tasks = await prisma.task.findMany({
    where: { status: { notIn: ['completed', 'cancelled'] } },
    select: {
      id: true, title: true, internId: true, complexity: true, progressPct: true,
      status: true, hasBlocker: true, blockerType: true, deadline: true, lastUpdatedAt: true,
      skills: true,
      intern: {
        select: {
          user: { select: { name: true } },
          scoreHistory: { where: { type: 'capacity' }, orderBy: { createdAt: 'desc' }, take: 1, select: { score: true } },
        },
      },
    },
    orderBy: { lastUpdatedAt: 'asc' },
    take: 100,
  });

  const risks = [];

  for (const t of tasks) {
    const riskFactors = [];
    let severity = 'low';

    const effectiveTliInputs = {
      capacityScore: t.intern?.scoreHistory?.[0]?.score ?? 0,
      credibility: null,
    };

    const taskTli = calculateTaskTLI(t);
    const rawTli = taskTli;
    const effectiveTli = calculateEffectiveTLI(rawTli, effectiveTliInputs.capacityScore, effectiveTliInputs.credibility);
    const loadBand = determineLoadBand(effectiveTli);

    const tliRiskFactors = [
      { factor: 'tli_load_band', detail: `TLI band: ${loadBand} (effectiveTli=${effectiveTli.toFixed(2)})` },
    ];

    const isOverdue   = t.deadline && new Date(t.deadline) < now;

    const isImminent  = t.deadline && new Date(t.deadline) <= imminentThresh && !isOverdue;
    const isStale     = new Date(t.lastUpdatedAt) < staleThresh;
    const isBlocked   = t.hasBlocker;
    const isHighLoad  = t.complexity >= 3 && t.progressPct < 30;
    const ownerCapacity = t.intern?.scoreHistory[0] ? Math.round(t.intern.scoreHistory[0].score) : null;
    const ownerOverloaded = ownerCapacity !== null && ownerCapacity < LOW_CAPACITY_THRESHOLD;

    if (isOverdue)       { riskFactors.push({ factor: 'overdue',          detail: `${Math.floor((now - new Date(t.deadline)) / 86400000)}d past deadline` }); severity = 'critical'; }
    if (isBlocked)       { riskFactors.push({ factor: 'blocked',          detail: t.blockerType ?? 'unspecified blocker' }); if (severity !== 'critical') severity = 'high'; }
    if (isStale)         { riskFactors.push({ factor: 'stale',            detail: `No update in ${Math.floor((now - new Date(t.lastUpdatedAt)) / 86400000)}d` }); if (severity === 'low') severity = 'medium'; }
    if (isImminent)      { riskFactors.push({ factor: 'deadline_imminent', detail: `Due in ${Math.ceil((new Date(t.deadline) - now) / 86400000)}d` }); if (severity === 'low') severity = 'medium'; }
    if (isHighLoad)      { riskFactors.push({ factor: 'high_complexity_low_progress', detail: `Complexity ${t.complexity}, only ${t.progressPct}% done` }); if (severity === 'low') severity = 'medium'; }
    if (ownerOverloaded) { riskFactors.push({ factor: 'owner_low_capacity', detail: `Owner capacity: ${ownerCapacity}` }); if (severity === 'low') severity = 'medium'; }
    if (loadBand === 'AMBER' && severity === 'low') severity = 'medium';
    if (loadBand === 'RED' && severity !== 'critical') severity = 'high';
    riskFactors.push(...tliRiskFactors);


    if (riskFactors.length === 0) continue;

    const suggestedAction =
      isOverdue   ? 'Escalate immediately — task is past deadline' :
      isBlocked   ? 'Resolve blocker or reassign task' :
      isStale     ? 'Follow up with intern on progress' :
      isImminent  ? 'Check progress and confirm delivery plan' :
      isHighLoad  ? 'Review complexity estimate or split task' :
      ownerOverloaded ? 'Consider reassigning to reduce owner load' :
      'Monitor closely';

    risks.push({
      taskId:          t.id,
      title:           t.title,
      internId:        t.internId,
      internName:      t.intern?.user?.name || t.internId,
      severity,
      riskFactors,
      suggestedAction,
      complexity:      t.complexity,
      progressPct:     t.progressPct,
      deadline:        t.deadline,
      lastUpdatedAt:   t.lastUpdatedAt,
      ownerCapacity,
    });
  }

  // Sort: critical → high → medium → low, then by lastUpdatedAt ascending
  const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  risks.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || new Date(a.lastUpdatedAt) - new Date(b.lastUpdatedAt));

  return {
    risks: risks.slice(0, 50),
    counts: {
      critical: risks.filter(r => r.severity === 'critical').length,
      high:     risks.filter(r => r.severity === 'high').length,
      medium:   risks.filter(r => r.severity === 'medium').length,
      total:    risks.length,
    },
  };
}

// ── 7. Assignment Readiness ───────────────────────────────────────────────────

/**
 * Returns interns ranked by assignment readiness.
 * Combines capacity score, TLI, credibility, and availability submission recency.
 * Each intern gets an explainable readiness score and a recommendation label.
 */
async function getAssignmentReadiness() {
  const now       = new Date();
  const monday    = new Date(now);
  const day       = monday.getUTCDay();
  const diff      = day === 0 ? -6 : 1 - day;
  monday.setUTCDate(monday.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);

  const interns = await prisma.intern.findMany({
    include: {
      user: { select: { name: true, email: true } },
      tasks: {
        where: { status: { notIn: ['completed', 'cancelled'] } },
        select: { complexity: true, progressPct: true, status: true, hasBlocker: true },
      },
      scoreHistory: {
        where: { type: 'capacity' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { score: true },
      },
      credibility: { select: { score: true } },
      availabilitySlots: {
        where: { weekStart: monday },
        select: { maxFreeBlockHours: true, busyBlocks: true },
        take: 1,
      },
    },
  });

  const rows = interns.map(intern => {
    const capacityScore   = intern.scoreHistory[0] ? Math.round(intern.scoreHistory[0].score) : 0;
    const credScore       = intern.credibility ? Math.round(intern.credibility.score * 100) : 0;
    const activeTasks     = intern.tasks.filter(t => t.status === 'active');
    const hasBlocker      = intern.tasks.some(t => t.hasBlocker);
    const submittedThisWeek = intern.availabilitySlots.length > 0;

    const rawTli = calculateInternTLI(activeTasks);
    const effectiveTli = calculateEffectiveTLI(rawTli, capacityScore, credScore);
    const loadBand = determineLoadBand(effectiveTli);


    // Readiness score: weighted composite
    // Capacity 50%, credibility 25%, TLI penalty 15%, availability submission 10%
    const tliPenalty      = Math.min(effectiveTli * 4, 40); // max 40pt penalty at effectiveTli=10

    const availBonus      = submittedThisWeek ? 10 : 0;
    const readinessScore  = Math.max(0, Math.round(
      0.50 * capacityScore +
      0.25 * credScore -
      tliPenalty +
      availBonus
    ));

    const reasons = [];
    if (capacityScore >= 70)    reasons.push('High capacity');
    if (credScore >= 70)        reasons.push('Reliable track record');
    if (effectiveTli < 3)      reasons.push('Low current load');
    if (submittedThisWeek)      reasons.push('Availability submitted');
    if (capacityScore < 30)     reasons.push('Low capacity — avoid assigning');
    if (hasBlocker)             reasons.push('Has active blocker');
    if (effectiveTli > OVERLOAD_THRESHOLD) reasons.push('Overloaded — do not assign');


    const recommendation =
      effectiveTli > OVERLOAD_THRESHOLD || capacityScore < 20 ? 'do_not_assign' :
      readinessScore >= 65 ? 'ready' :
      readinessScore >= 40 ? 'available_with_caution' :
      'low_availability';

    return {
      internId:       intern.id,
      name:           intern.user?.name || intern.user?.email?.split('@')[0] || intern.id,
      capacityScore,
      credScore,
      tli:            parseFloat(effectiveTli.toFixed(2)),
      activeTasks:    activeTasks.length,
      hasBlocker,
      submittedThisWeek,
      readinessScore,
      recommendation,
      reasons,
    };
  });

  rows.sort((a, b) => b.readinessScore - a.readinessScore);

  return {
    interns: rows,
    summary: {
      ready:               rows.filter(r => r.recommendation === 'ready').length,
      availableWithCaution: rows.filter(r => r.recommendation === 'available_with_caution').length,
      doNotAssign:         rows.filter(r => r.recommendation === 'do_not_assign').length,
      noAvailability:      rows.filter(r => !r.submittedThisWeek).length,
    },
  };
}

// ── 8. Alert Intelligence ─────────────────────────────────────────────────────

/**
 * Converts raw alerts into grouped, prioritized operational insights.
 * Groups by type, detects recurring issues, surfaces escalation-worthy patterns.
 */
async function getAlertIntelligence() {
  const alerts = await prisma.alert.findMany({
    where:   { resolved: false },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, type: true, severity: true, message: true, createdAt: true,
      internId: true, taskId: true,
    },
  });

  // Group by type
  const byType = {};
  for (const a of alerts) {
    if (!byType[a.type]) byType[a.type] = { type: a.type, count: 0, critical: 0, warning: 0, internIds: new Set(), oldest: a.createdAt };
    byType[a.type].count++;
    if (a.severity === 'critical') byType[a.type].critical++;
    else byType[a.type].warning++;
    byType[a.type].internIds.add(a.internId);
    if (new Date(a.createdAt) < new Date(byType[a.type].oldest)) byType[a.type].oldest = a.createdAt;
  }

  // Build insight groups
  const TYPE_LABELS = {
    stale_task:             { label: 'Stale Tasks',             action: 'Follow up with interns on progress' },
    deadline_approaching:   { label: 'Deadline Approaching',    action: 'Confirm delivery plans with interns' },
    low_capacity:           { label: 'Low Capacity',            action: 'Avoid new assignments for flagged interns' },
    overload:               { label: 'Overload Detected',       action: 'Redistribute tasks immediately' },
    availability_reminder:  { label: 'Missing Availability',    action: 'Chase interns for weekly submission' },
    task_reminder:          { label: 'Task Update Reminders',   action: 'Interns have not updated task progress' },
    blocker_reported:       { label: 'Active Blockers',         action: 'Resolve blockers or escalate to leads' },
    review_submitted:       { label: 'Reviews Submitted',       action: 'No action needed — informational' },
    form_reminder:          { label: 'Form Reminders',          action: 'Interns have not submitted required forms' },
  };

  const groups = Object.values(byType).map(g => ({
    type:           g.type,
    label:          TYPE_LABELS[g.type]?.label ?? g.type.replace(/_/g, ' '),
    suggestedAction: TYPE_LABELS[g.type]?.action ?? 'Review and action',
    count:          g.count,
    critical:       g.critical,
    warning:        g.warning,
    affectedInterns: g.internIds.size,
    oldestAlert:    g.oldest,
    isEscalation:   g.critical > 0 || g.count >= 5,
    priority:       g.critical > 0 ? 'critical' : g.count >= 5 ? 'high' : 'medium',
  }));

  // Sort: critical first, then by count
  groups.sort((a, b) => {
    const ORDER = { critical: 0, high: 1, medium: 2 };
    return ORDER[a.priority] - ORDER[b.priority] || b.count - a.count;
  });

  // Recurring issue detection: interns with 3+ unresolved alerts
  const internAlertCounts = {};
  for (const a of alerts) {
    internAlertCounts[a.internId] = (internAlertCounts[a.internId] || 0) + 1;
  }

  const recurringIssues = await Promise.all(
    Object.entries(internAlertCounts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(async ([internId, count]) => {
        const intern = await prisma.intern.findUnique({
          where: { id: internId },
          select: { user: { select: { name: true } } },
        });
        return { internId, name: intern?.user?.name || internId, alertCount: count };
      })
  );

  return {
    groups,
    recurringIssues,
    summary: {
      total:    alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning:  alerts.filter(a => a.severity === 'warning').length,
      types:    groups.length,
    },
  };
}

// ── 9. Performance & Credibility Trends (per-intern) ─────────────────────────

/**
 * Detects declining performance and credibility trends per intern.
 * Compares last 2 weeks vs prior 2 weeks from ScoreHistory.
 * Returns interns with significant drops and reliability indicators.
 */
async function getPerformanceTrends() {
  const now        = new Date();
  const twoWeeks   = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fourWeeks  = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const interns = await prisma.intern.findMany({
    select: {
      id: true,
      user: { select: { name: true } },
      scoreHistory: {
        where:   { createdAt: { gte: fourWeeks } },
        orderBy: { createdAt: 'asc' },
        select:  { score: true, type: true, createdAt: true },
      },
      credibility: { select: { score: true, updateFrequency: true, deadlineAdherence: true } },
    },
  });

  const trends = [];

  for (const intern of interns) {
    const capacityHistory = intern.scoreHistory.filter(h => h.type === 'capacity');
    if (capacityHistory.length < 2) continue;

    const recent = capacityHistory.filter(h => new Date(h.createdAt) >= twoWeeks);
    const prior  = capacityHistory.filter(h => new Date(h.createdAt) < twoWeeks);

    if (!recent.length || !prior.length) continue;

    const avg = arr => arr.reduce((s, h) => s + h.score, 0) / arr.length;
    const recentAvg = avg(recent);
    const priorAvg  = avg(prior);
    const delta     = parseFloat((recentAvg - priorAvg).toFixed(1));

    const credScore = intern.credibility ? Math.round(intern.credibility.score * 100) : null;
    const updateFreq = intern.credibility ? Math.round(intern.credibility.updateFrequency * 100) : null;
    const deadlineAdh = intern.credibility ? Math.round(intern.credibility.deadlineAdherence * 100) : null;

    const trend =
      delta <= -15 ? 'declining_fast' :
      delta <= -5  ? 'declining' :
      delta >= 10  ? 'improving' :
      'stable';

    const reliabilityFlag =
      credScore !== null && credScore < 40 ? 'low_reliability' :
      updateFreq !== null && updateFreq < 50 ? 'infrequent_updates' :
      deadlineAdh !== null && deadlineAdh < 50 ? 'deadline_issues' :
      null;

    trends.push({
      internId:     intern.id,
      name:         intern.user?.name || intern.id,
      recentAvg:    Math.round(recentAvg),
      priorAvg:     Math.round(priorAvg),
      delta,
      trend,
      credScore,
      updateFreq,
      deadlineAdh,
      reliabilityFlag,
      sparkline:    capacityHistory.map(h => Math.round(h.score)),
    });
  }

  // Sort: declining_fast first, then declining, then by delta ascending
  const ORDER = { declining_fast: 0, declining: 1, stable: 2, improving: 3 };
  trends.sort((a, b) => ORDER[a.trend] - ORDER[b.trend] || a.delta - b.delta);

  return {
    trends,
    summary: {
      decliningFast: trends.filter(t => t.trend === 'declining_fast').length,
      declining:     trends.filter(t => t.trend === 'declining').length,
      stable:        trends.filter(t => t.trend === 'stable').length,
      improving:     trends.filter(t => t.trend === 'improving').length,
      lowReliability: trends.filter(t => t.reliabilityFlag !== null).length,
    },
  };
}

// ── Composite: full dashboard payload ────────────────────────────────────────

/**
 * Returns all analytics sections in a single call.
 * Used by the frontend analytics dashboard to avoid waterfall requests.
 */
async function getFullAnalyticsDashboard() {
  const [workload, scoreTrends, workloadTrend, sla, teamHealth, digest, support, taskRisks, assignmentReadiness, alertIntelligence, performanceTrends, reassignmentRecommendations] = await Promise.all([
    getWorkloadDistribution(),
    getScoreTrends(),
    getWorkloadTrend(),
    getSLAStatus(),
    getTeamHealth(),
    getOperationalDigest(),
    getSupportRequestSummary(),
    getTaskRiskIntelligence(),
    getAssignmentReadiness(),
    getAlertIntelligence(),
    getPerformanceTrends(),
    getReassignmentRecommendations(),
  ]);

  return {
    workload,
    scoreTrends,
    workloadTrend,
    sla,
    teamHealth,
    digest,
    support,
    taskRisks,
    assignmentReadiness,
    alertIntelligence,
    performanceTrends,
    // Enterprise: operational reassignment recommendations (recommendation-only)
    reassignmentRecommendations,
  };
}


module.exports = {
  getWorkloadDistribution,
  getSupportRequestSummary,
  getScoreTrends,
  getWorkloadTrend,
  getCapacityHistory,
  getSLAStatus,
  getTeamHealth,
  getOperationalDigest,
  getFullAnalyticsDashboard,
  getTaskRiskIntelligence,
  getAssignmentReadiness,
  getAlertIntelligence,
  getPerformanceTrends,
  // Enterprise reassignment recommendation payload
  getReassignmentRecommendations,
};
