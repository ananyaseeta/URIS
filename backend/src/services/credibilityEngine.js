'use strict';

// Centralized behavior-based operational credibility computation engine.
// IMPORTANT: This file does not create new persistence systems/tables.

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

// Window configuration (fallbacks; can be made env-driven later if desired)
const DEFAULT_WINDOW_DAYS = parseInt(process.env.CREDIBILITY_WINDOW_DAYS, 10) || 14;
const DEFAULT_UPDATE_ON_TIME_MS = parseInt(process.env.CREDIBILITY_UPDATE_ON_TIME_HOURS, 10) || 48 * 60 * 60 * 1000;
const DEFAULT_IMMINENT_DEADLINE_DAYS = parseInt(process.env.CREDIBILITY_IMMINENT_DEADLINE_DAYS, 10) || 3;
const DEFAULT_RESPONSE_SLA_HOURS = parseInt(process.env.CREDIBILITY_RESPONSE_SLA_HOURS, 10) || 48;

// Weights for final score (sum ~1.0)
const WEIGHTS = {
  updateConsistency: 0.25,
  deadlineReliability: 0.25,
  responsiveness: 0.20,
  throughputStability: 0.15,
  blockerRiskPenalty: 0.15,
};

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function toScore100(normalized01) {
  return Math.round(clamp01(normalized01) * 10000) / 100; // 0-100 with 2 decimals
}

function scoreFromRatio(ratio) {
  if (!Number.isFinite(ratio)) return 0;
  return toScore100(ratio);
}

function normalizeTo100(value01) {
  return toScore100(value01);
}

function computeStdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function bucketDailyProgress(taskProgressPct) {
  // Task progress is 0-100. We bucket to reduce noise.
  if (taskProgressPct == null) return 0;
  const v = Number(taskProgressPct);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / 10) * 10;
}

async function fetchOperationalTasksForIntern(internId, windowStart) {
  // We rely on Task operational fields.
  // We intentionally include both active and recently completed tasks to measure:
  // - deadline reliability (completed on-time)
  // - throughput stability (activity consistency)
  return prisma.task.findMany({
    where: {
      internId,
      createdAt: { gte: windowStart },
    },
    select: {
      id: true,
      status: true,
      complexity: true,
      progressPct: true,
      deadline: true,
      hasBlocker: true,
      blockerType: true,
      lastUpdatedAt: true,
      createdAt: true,
      alerts: {
        select: {
          id: true,
          type: true,
          severity: true,
          createdAt: true,
          resolved: true,
        },
      },
    },
  });
}

async function fetchUnresolvedAlertsForIntern(internId, windowStart) {
  // Existing Alert table supports operational alerts; we use it to detect escalation patterns.
  // Schema: Alert{ type, severity, resolved, createdAt, internId, taskId }
  try {
    return prisma.alert.findMany({
      where: {
        internId,
        createdAt: { gte: windowStart },
        resolved: false,
      },
      select: { id: true, type: true, severity: true, createdAt: true, taskId: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  } catch (e) {
    return [];
  }
}

async function fetchTaskUpdatesTimelineForResponsiveness(internId, windowStart) {
  // Approximate acknowledgment/response speed by looking at lastUpdatedAt deltas.
  // A more precise "ack" signal might exist elsewhere, but we preserve current architecture.
  // We'll compute average delay as time between successive task updates.
  const tasks = await prisma.task.findMany({
    where: {
      internId,
      createdAt: { gte: windowStart },
    },
    select: {
      id: true,
      lastUpdatedAt: true,
      status: true,
      deadline: true,
      hasBlocker: true,
      blockerType: true,
      progressPct: true,
    },
  });

  // If we don't have enough timeline points, return empty.
  if (!tasks.length) return [];

  // Use updatedAt timestamps as a proxy timeline.
  // Sort by timestamp and compute deltas.
  const updates = tasks
    .filter(t => t.lastUpdatedAt)
    .map(t => new Date(t.lastUpdatedAt).getTime())
    .sort((a, b) => a - b);

  const delays = [];
  for (let i = 1; i < updates.length; i++) {
    const d = updates[i] - updates[i - 1];
    if (d >= 0) delays.push(d);
  }
  return delays;
}

async function fetchThroughputProgressBuckets(internId, windowStart) {
  // Throughput stability: check output consistency by measuring stability of progress buckets
  // across the window for completed/active tasks.
  // We'll sample tasks and group their progress buckets by day.
  const tasks = await prisma.task.findMany({
    where: {
      internId,
      createdAt: { gte: windowStart },
    },
    select: {
      id: true,
      status: true,
      progressPct: true,
      lastUpdatedAt: true,
      deadline: true,
    },
  });

  const byDay = new Map();
  for (const t of tasks) {
    if (!t.lastUpdatedAt) continue;
    const dayKey = new Date(t.lastUpdatedAt).toISOString().slice(0, 10); // YYYY-MM-DD
    const bucket = bucketDailyProgress(t.progressPct);
    const prev = byDay.get(dayKey) || [];
    prev.push(bucket);
    byDay.set(dayKey, prev);
  }

  // For each day compute average bucket.
  const dailyAverages = [];
  for (const [_day, buckets] of byDay.entries()) {
    if (!buckets.length) continue;
    const avg = buckets.reduce((s, v) => s + v, 0) / buckets.length;
    dailyAverages.push(avg);
  }

  return dailyAverages;
}

function computeUpdateConsistency({ tasks, windowStart }) {
  const now = Date.now();

  // We approximate “expected updates” by counting tasks created in window.

  // On-time update is when lastUpdatedAt is within DEFAULT_UPDATE_ON_TIME_MS.
  const eligible = tasks.filter(t => t.status !== 'cancelled');

  const expectedUpdates = Math.max(eligible.length, 1);
  const onTimeUpdates = eligible.filter(t => {
    if (!t.lastUpdatedAt) return false;
    const age = now - new Date(t.lastUpdatedAt).getTime();
    return age <= DEFAULT_UPDATE_ON_TIME_MS;
  }).length;

  const updateConsistency01 = onTimeUpdates / expectedUpdates;

  const normalized = normalizeTo100(updateConsistency01);

  const reasoning = {
    onTimeUpdates,
    expectedUpdates,
    updateWindowHours: Math.round(DEFAULT_UPDATE_ON_TIME_MS / 36e5),
    delayedTaskCount: Math.max(0, eligible.length - onTimeUpdates),
    notes: [
      'Update consistency uses task lastUpdatedAt as the operational update signal.',
      'A task is “on-time” if its last update is within the on-time SLA window.',
    ],
  };

  return {
    score100: normalized,
    value01: clamp01(updateConsistency01),
    reasoning,
  };
}

function computeDeadlineReliability({ tasks }) {
  const completedWithDeadline = tasks.filter(t => t.status === 'completed' && t.deadline);
  const total = completedWithDeadline.length;

  if (total === 0) {
    return {
      score100: 50,
      value01: 0.5,
      reasoning: {
        completedOnTime: 0,
        totalAssignedWithDeadline: 0,
        notes: ['No completed tasks with deadlines found in the window; defaulting reliability to neutral 50.'],
      },
    };
  }

  const completedOnTime = completedWithDeadline.filter(t => {
    if (!t.lastUpdatedAt || !t.deadline) return false;
    return new Date(t.lastUpdatedAt) <= new Date(t.deadline);
  }).length;

  const ratio = completedOnTime / total;
  return {
    score100: normalizeTo100(ratio),
    value01: clamp01(ratio),
    reasoning: {
      completedOnTime,
      totalAssignedWithDeadline: total,
      onTimeRate: ratio,
    },
  };
}

function computeResponsiveness({ responseDelaysMs }) {
  if (!responseDelaysMs.length) {
    return {
      score100: 50,
      value01: 0.5,
      reasoning: { avgResponseDelayHours: null, notes: ['Insufficient update timeline data; defaulting responsiveness to neutral 50.'] },
    };
  }

  const avgDelay = responseDelaysMs.reduce((s, v) => s + v, 0) / responseDelaysMs.length;
  const avgDelayHours = avgDelay / 36e5;

  // Inverse(avg delay): shorter delay => higher score.
  // Map delay to 0..1 using SLA reference.
  // If avgDelayHours <= SLA -> >~1 (clamped to 1). If much larger -> near 0.
  const responsiveness01 = clamp01(DEFAULT_RESPONSE_SLA_HOURS / Math.max(1e-6, avgDelayHours));

  return {
    score100: normalizeTo100(responsiveness01),
    value01: clamp01(responsiveness01),
    reasoning: {
      avgResponseDelayHours: parseFloat(avgDelayHours.toFixed(2)),
      slaHours: DEFAULT_RESPONSE_SLA_HOURS,
      notes: ['Responsiveness approximates acknowledgment/response time using deltas between observed task updates (lastUpdatedAt).'],
    },
  };
}

function computeBlockerRisk({ tasks, unresolvedAlerts }) {
  const now = Date.now();
  const activeBlocked = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.hasBlocker);

  // Escalation frequency proxy:
  // - unresolved alerts in window weighted by severity
  // - also blockerType repetition
  const alertWeights = {
    critical: 1.0,
    high: 0.8,
    warning: 0.5,
    medium: 0.4,
    low: 0.2,
  };

  const unresolvedEscalationScore = unresolvedAlerts.reduce((s, a) => {
    const w = alertWeights[(a.severity || '').toLowerCase()] ?? 0.3;
    return s + w;
  }, 0);

  const repeatedLateBlockers = (() => {
    // If blockerType repeats across tasks and lastUpdatedAt is old, count it.
    const byType = {};
    for (const t of activeBlocked) {
      const type = t.blockerType || 'unspecified';
      byType[type] = byType[type] || [];
      byType[type].push(t);
    }

    let count = 0;
    for (const [_type, ts] of Object.entries(byType)) {
      // count tasks where blocker appears and is older than 2 days
      const late = ts.filter(t => t.lastUpdatedAt && (now - new Date(t.lastUpdatedAt).getTime()) >= 48 * 36e5).length;
      if (ts.length >= 2 && late >= 1) count += 1;
    }
    return count;
  })();

  const unresolvedBlockerDurationScore = (() => {
    if (!activeBlocked.length) return 0;
    const oldestMs = Math.max(
      ...activeBlocked.map(t => (t.lastUpdatedAt ? (now - new Date(t.lastUpdatedAt).getTime()) : 0))
    );

    // Map oldest duration to 0..1; 0 at <=1 day, 1 at >=7 days.
    const oneDay = 24 * 36e5;
    const sevenDays = 7 * 24 * 36e5;
    const duration01 = clamp01((oldestMs - oneDay) / (sevenDays - oneDay));
    return duration01;
  })();

  // Compose risk penalty: higher risk => higher penalty.
  // Weighted escalation frequency + repeated late blockers + unresolved blocker duration.
  const escalationFreq01 = clamp01(unresolvedEscalationScore / 10); // heuristic scaling
  const repeatedLate01 = clamp01(repeatedLateBlockers / 3);
  const duration01 = clamp01(unresolvedBlockerDurationScore);

  const blockerRisk01 = clamp01(0.45 * escalationFreq01 + 0.35 * repeatedLate01 + 0.20 * duration01);

  // We treat this as a risk penalty in final scoring.
  return {
    score100: normalizeTo100(blockerRisk01),
    value01: blockerRisk01,
    reasoning: {
      blockedTaskCount: activeBlocked.length,
      unresolvedAlertCount: unresolvedAlerts.length,
      repeatedLateBlockers,
      escalationFreq01: parseFloat(escalationFreq01.toFixed(3)),
      unresolvedBlockerDurationScore01: parseFloat(duration01.toFixed(3)),
      notes: ['Blocker risk uses unresolved alerts + repeated blocker patterns + blocker duration based on task lastUpdatedAt.'],
    },
  };
}

function computeThroughputStability({ dailyAverages }) {
  // ThroughputStability: higher when daily output is stable.
  // We compute stddev of daily average progress buckets.
  // Normalize inversely: lower stddev => higher stability.
  if (!dailyAverages.length) {
    return {
      score100: 50,
      value01: 0.5,
      reasoning: { notes: ['Insufficient throughput buckets; defaulting stability to 50.'] },
    };
  }

  const std = computeStdDev(dailyAverages);

  // stddev roughly 0..50. Map <=5 => high stability, >=25 => low.
  const stability01 = clamp01(1 - (std - 5) / (25 - 5));

  return {
    score100: normalizeTo100(stability01),
    value01: stability01,
    reasoning: {
      dailySampleCount: dailyAverages.length,
      stddevProgressBucket: parseFloat(std.toFixed(2)),
      notes: ['Throughput stability is derived from variation in daily progress buckets (approximate output consistency).'],
    },
  };
}

function aggregateCredibilityScore({
  updateConsistency01,
  deadlineReliability01,
  responsiveness01,
  throughputStability01,
  blockerRisk01,
}) {
  // blockerRisk is a penalty: we subtract risk from final.
  // final01 = weighted sum of positive factors - weighted blockerRisk.
  const positive =
    WEIGHTS.updateConsistency * updateConsistency01 +
    WEIGHTS.deadlineReliability * deadlineReliability01 +
    WEIGHTS.responsiveness * responsiveness01 +
    WEIGHTS.throughputStability * throughputStability01;

  const penalty = WEIGHTS.blockerRiskPenalty * blockerRisk01;

  const final01 = clamp01(positive - penalty);

  const breakdown = {
    updateConsistency: toScore100(updateConsistency01),
    deadlineReliability: toScore100(deadlineReliability01),
    responsiveness: toScore100(responsiveness01),
    throughputStability: toScore100(throughputStability01),
    blockerRisk: toScore100(blockerRisk01),
  };

  return {
    score100: normalizeTo100(final01),
    value01: final01,
    breakdown,
  };
}

function detectRiskPatterns({
  updateConsistency,
  deadlineReliability,
  responsiveness,
  throughputStability,
  blockerRisk,
  tasks,
  unresolvedAlerts,
}) {
  const now = Date.now();

  // repeated stale tasks: count tasks whose lastUpdatedAt is older than 2*DEFAULT_UPDATE SLA (approx)
  const staleMs = 4 * 24 * 36e5; // 4 days
  const staleCount = tasks.filter(t => t.lastUpdatedAt && (now - new Date(t.lastUpdatedAt).getTime()) >= staleMs && t.status !== 'completed').length;

  // repeated escalations: unresolved critical/high alerts frequency
  const escalationCount = unresolvedAlerts.filter(a => {
    const s = (a.severity || '').toLowerCase();
    return s === 'critical' || s === 'high';
  }).length;

  // reliability degradation:
  const reliabilityDecline = (updateConsistency.value01 < 0.4) && (deadlineReliability.value01 < 0.5);

  // overload instability proxy: throughput stability low
  const overloadInstability = throughputStability.value01 < 0.45 && responsiveness.value01 < 0.5;

  // assignment churn risk proxy: high blockers risk + low responsiveness
  const assignmentChurnRisk = blockerRisk.value01 > 0.5 && responsiveness.value01 < 0.6;

  const factors = [];

  if (staleCount >= 3) factors.push({ factor: 'repeated_stale_tasks', detail: `${staleCount} tasks stale beyond threshold` });
  if (escalationCount >= 2) factors.push({ factor: 'repeated_escalations', detail: `${escalationCount} critical/high unresolved alerts` });
  if (reliabilityDecline) factors.push({ factor: 'reliability_degradation', detail: 'Update consistency + deadline reliability both degraded' });
  if (overloadInstability) factors.push({ factor: 'overload_instability', detail: 'Low throughput stability with weak responsiveness' });
  if (assignmentChurnRisk) factors.push({ factor: 'assignment_churn_risk', detail: 'High blocker risk combined with low responsiveness' });

  // Assign severity
  const severity = (() => {
    const hasCritical = unresolvedAlerts.some(a => (a.severity || '').toLowerCase() === 'critical');
    if (blockerRisk.value01 >= 0.65 || hasCritical) return 'critical';
    if (factors.length >= 3) return 'high';
    if (factors.length >= 1) return 'medium';
    return 'low';
  })();

  const suggestedAction =
    severity === 'critical'
      ? 'Freeze new assignments; resolve blockers/escalations and verify delivery plan.'
      : severity === 'high'
      ? 'Prefer reassignment for time-sensitive tasks; follow up on stale updates.'
      : severity === 'medium'
      ? 'Monitor closely; enforce update reminders before deadlines.'
      : 'No major operational risk patterns detected.';

  return {
    severity,
    factors,
    suggestedAction,
    operationalImpact: [
      'Lower credibility increases assignment risk and governance monitoring priority.',
      'Blocker risk and stale patterns suggest process friction (governance intervention recommended).',
    ],
  };
}

async function computeCredibilityForIntern(internId) {
  const windowStart = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [tasks, unresolvedAlerts, responseDelaysMs, throughputDailyAverages] = await Promise.all([
    fetchOperationalTasksForIntern(internId, windowStart),
    fetchUnresolvedAlertsForIntern(internId, windowStart),
    fetchTaskUpdatesTimelineForResponsiveness(internId, windowStart),
    fetchThroughputProgressBuckets(internId, windowStart),
  ]);

  const updateConsistency = computeUpdateConsistency({ tasks, windowStart });
  const deadlineReliability = computeDeadlineReliability({ tasks });
  const responsiveness = computeResponsiveness({ responseDelaysMs });
  const throughputStability = computeThroughputStability({ dailyAverages: throughputDailyAverages });
  const blockerRisk = computeBlockerRisk({ tasks, unresolvedAlerts });

  const final = aggregateCredibilityScore({
    updateConsistency01: updateConsistency.value01,
    deadlineReliability01: deadlineReliability.value01,
    responsiveness01: responsiveness.value01,
    throughputStability01: throughputStability.value01,
    blockerRisk01: blockerRisk.value01,
  });

  const riskPatterns = detectRiskPatterns({
    updateConsistency,
    deadlineReliability,
    responsiveness,
    throughputStability,
    blockerRisk,
    tasks,
    unresolvedAlerts,
  });

  return {
    internId,
    finalCredibilityScore: final.score100,
    components: {
      updateConsistency,
      deadlineReliability,
      responsiveness,
      throughputStability,
      blockerRisk,
    },
    riskPatterns,
    explainability: {
      updateConsistency,
      deadlineReliability,
      responsiveness,
      blockerRisk,
      throughputStability,
      finalCredibilityScore: final.score100,
      detectedRiskFactors: riskPatterns.factors,
      reliabilityReasoning: {
        notes: [
          'All components are computed from operational task signals in the configured time window.',
          'Scores are normalized to 0–100 and final credibility penalizes blocker risk.',
        ],
      },
      trendExplanation: {
        // We cannot infer multi-week trend without digest history in this engine alone.
        // The UI trend charts already use InternDigest; digest will be driven by the final score.
        notes: ['Trend charts are derived from weekly InternDigest entries; this engine provides the per-run score and reasoning.'],
      },
      operationalImpactReasoning: riskPatterns.operationalImpact,
    },
  };
}

// Public API used by credibilityService.
// Returns DB-ready shape (score + component signals) and explainability.
async function computeCredibilityScore(internId) {
  try {
    const result = await computeCredibilityForIntern(internId);

    return {
      internId,
      // Keep backward compatibility: a scoreOut100 integer is required by controller/scoreHistory.
      score: parseFloat(result.finalCredibilityScore.toFixed(2)),
      scoreOut100: Math.round(result.finalCredibilityScore),

      // component signals (normalized 0..1 for internal use)
      signals: {
        updateConsistency: result.components.updateConsistency.value01,
        deadlineReliability: result.components.deadlineReliability.value01,
        responsiveness: result.components.responsiveness.value01,
        throughputStability: result.components.throughputStability.value01,
        blockerRisk: result.components.blockerRisk.value01,
      },

      // Map to existing legacy fields meaningfully:
      // - updateFrequency ~ updateConsistency
      // - deadlineAdherence ~ deadlineReliability
      // - throughputAccuracy ~ throughputStability (compat)
      legacySignals: {
        updateFrequency: result.components.updateConsistency.value01,
        deadlineAdherence: result.components.deadlineReliability.value01,
        throughputAccuracy: result.components.throughputStability.value01,
      },

      // Explainability required by task
      explainability: {
        updateConsistency: result.components.updateConsistency,
        deadlineReliability: result.components.deadlineReliability,
        responsiveness: result.components.responsiveness,
        blockerRisk: result.components.blockerRisk,
        throughputStability: result.components.throughputStability,
        finalCredibilityScore: result.finalCredibilityScore,
      },

      // Governance/risk patterns for alerts
      detectRiskPatterns: result.riskPatterns,
    };
  } catch (err) {
    logger.error({ err, internId }, 'credibilityEngine.computeCredibilityScore failed');
    throw err;
  }
}

// Generate governance/operational alerts using existing Alert architecture.
// We only create alerts; we do not create new tables.
async function generateCredibilityRiskAlerts({ internId, scoreOut100, detectRiskPatterns }) {
  // Only alert when severity is medium+ or score is very low.
  const { severity, factors, suggestedAction } = detectRiskPatterns;

  const scoreCritical = scoreOut100 <= 25;
  const shouldAlert = scoreCritical || severity === 'critical' || severity === 'high';
  if (!shouldAlert) return { created: 0 };

  const type = 'credibility_risk';
  const message = [
    `Credibility score: ${scoreOut100}/100.`,
    factors.length ? `Risk factors: ${factors.map(f => f.factor).join(', ')}` : 'No explicit risk factors listed.',
    suggestedAction ? `Action: ${suggestedAction}` : '',
  ].filter(Boolean).join(' ');

  const severityMap = {
    critical: 'critical',
    high: 'warning', // existing UI treats warning as yellow (fallback)
    medium: 'warning',
    low: 'info',
  };

  const alertSeverity = severityMap[severity] || 'warning';

  // Avoid alert spam: upsert by (internId,type,unresolved) isn't possible without unique constraints.
  // So we create new alerts only if none recent unresolved exist.
  const recentWindowMs = 6 * 60 * 60 * 1000;
  const recent = await prisma.alert.findMany({
    where: {
      internId,
      type,
      resolved: false,
      createdAt: { gte: new Date(Date.now() - recentWindowMs) },
    },
    select: { id: true },
    take: 1,
  });

  if (recent.length) return { created: 0 };

  await prisma.alert.create({
    data: {
      internId,
      type,
      message,
      severity: alertSeverity,
      resolved: false,
      taskId: null,
    },
  });

  return { created: 1 };
}

// Convenience wrapper used by recomputation flows.
async function computeAndPersistCredibility(internId) {
  const computed = await computeCredibilityScore(internId);

  // Persist existing credibilityScore table.
  // Requirement: CredibilityScore.score must continue to persist correctly.
  await prisma.credibilityScore.upsert({
    where: { internId },
    update: {
      updateFrequency: parseFloat(computed.legacySignals.updateFrequency.toFixed(4)),
      deadlineAdherence: parseFloat(computed.legacySignals.deadlineAdherence.toFixed(4)),
      throughputAccuracy: parseFloat(computed.legacySignals.throughputAccuracy.toFixed(4)),
      score: parseFloat((computed.score / 100).toFixed(4)), // table expects 0..1 float
      computedAt: new Date(),
    },
    create: {
      internId,
      updateFrequency: parseFloat(computed.legacySignals.updateFrequency.toFixed(4)),
      deadlineAdherence: parseFloat(computed.legacySignals.deadlineAdherence.toFixed(4)),
      throughputAccuracy: parseFloat(computed.legacySignals.throughputAccuracy.toFixed(4)),
      score: parseFloat((computed.score / 100).toFixed(4)),
      computedAt: new Date(),
    },
  });

  return computed;
}

module.exports = {
  computeUpdateConsistency,
  computeDeadlineReliability,
  computeResponsiveness,
  computeBlockerRisk,
  computeCredibilityScore,
  detectRiskPatterns,
  generateCredibilityRiskAlerts,
  computeAndPersistCredibility,
};


