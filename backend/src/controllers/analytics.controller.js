'use strict';

/**
 * analytics.controller.js — Phase 7 Operational Intelligence Layer
 *
 * All endpoints are admin-only (CORE_ADMIN, OPERATIONS_LEAD, OPERATIONS_PROGRAM_MANAGER).
 * Delegates all computation to analyticsService — no business logic here.
 */

const {
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
  getAssignmentReadiness: getAssignmentReadinessData,
  getAlertIntelligence: getAlertIntelligenceData,
  getPerformanceTrends: getPerformanceTrendsData,
} = require('../services/analyticsService');
const { computeIntegrationIntelligence } = require('../services/integrationIntelligenceEngine');
const { aggregateUnifiedIntelligence }   = require('../services/unifiedIntelligenceEngine');
const { ok, validationError } = require('../utils/respond');
const { isUUID } = require('../utils/validate');

/**
 * GET /analytics/dashboard
 * Full analytics payload — all sections in one request.
 */
async function getDashboard(req, res, next) {
  try {
    const [data, integrationIntelligence] = await Promise.all([
      getFullAnalyticsDashboard(),
      computeIntegrationIntelligence({}).catch(() => []),
    ]);

    // Build summary from integration intelligence rows
    const iiRows = integrationIntelligence ?? [];
    const iiSummary = {
      total: iiRows.length,
      highRisk:    iiRows.filter(r => r.risk?.severity === 'high').length,
      warningRisk: iiRows.filter(r => r.risk?.severity === 'warning').length,
      avgDocActivityScore: iiRows.length
        ? Math.round(iiRows.reduce((s, r) => s + (r.documentActivityScore ?? 0), 0) / iiRows.length)
        : null,
      avgIntegrationScore: iiRows.length
        ? Math.round(iiRows.reduce((s, r) => s + (r.integrationIntelligenceScore ?? 0), 0) / iiRows.length)
        : null,
    };

    return ok(res, {
      ...data,
      integrationIntelligence: {
        rows:    iiRows,
        summary: iiSummary,
      },
    }, 'Analytics dashboard fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/workload
 * Workload distribution across all interns.
 */
async function getWorkload(req, res, next) {
  try {
    const data = await getWorkloadDistribution();
    return ok(res, data, 'Workload distribution fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/support
 * Support request summary + SLA breach list.
 */
async function getSupport(req, res, next) {
  try {
    const data = await getSupportRequestSummary();
    return ok(res, data, 'Support request summary fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/trends/scores
 * Weekly capacity / credibility / performance trends.
 */
async function getTrendScores(req, res, next) {
  try {
    const data = await getScoreTrends();
    return ok(res, data, 'Score trends fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/trends/workload
 * Weekly workload growth and assignment density.
 */
async function getTrendWorkload(req, res, next) {
  try {
    const data = await getWorkloadTrend();
    return ok(res, data, 'Workload trend fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/capacity-history/:internId
 * Per-intern capacity score history for sparklines.
 */
async function getInternCapacityHistory(req, res, next) {
  try {
    const { internId } = req.params;
    if (!isUUID(internId)) return validationError(res, 'internId must be a valid UUID');

    const weeks = req.query.weeks ? parseInt(req.query.weeks) : undefined;
    const data  = await getCapacityHistory(internId, weeks);
    return ok(res, data, 'Capacity history fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/sla
 * SLA status: stale tasks, overdue tasks, unresolved blockers, support breaches.
 */
async function getSLA(req, res, next) {
  try {
    const data = await getSLAStatus();
    return ok(res, data, 'SLA status fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/teams
 * Team health overview: capacity averages, overloaded/inactive teams.
 */
async function getTeams(req, res, next) {
  try {
    const data = await getTeamHealth();
    return ok(res, data, 'Team health fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/digest
 * Weekly operational digest: low-cred interns, inactive tasks, overdue requests.
 */
async function getDigest(req, res, next) {
  try {
    const data = await getOperationalDigest();
    return ok(res, data, 'Operational digest fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/task-risks
 * Severity-ranked task risk list with reasons and suggested actions.
 */
async function getTaskRisks(req, res, next) {
  try {
    const data = await getTaskRiskIntelligence();
    return ok(res, data, 'Task risks fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/assignment-readiness
 * Intern assignment readiness rankings with explainable scores.
 */
async function getAssignmentReadiness(req, res, next) {
  try {
    const data = await getAssignmentReadinessData();
    return ok(res, data, 'Assignment readiness fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/alert-intelligence
 * Grouped, prioritized alert insights with recurring issue detection.
 */
async function getAlertIntelligence(req, res, next) {
  try {
    const data = await getAlertIntelligenceData();
    return ok(res, data, 'Alert intelligence fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/performance-trends
 * Per-intern performance and credibility trend detection.
 */
async function getPerformanceTrends(req, res, next) {
  try {
    const data = await getPerformanceTrendsData();
    return ok(res, data, 'Performance trends fetched.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboard,
  getWorkload,
  getSupport,
  getTrendScores,
  getTrendWorkload,
  getInternCapacityHistory,
  getSLA,
  getTeams,
  getDigest,
  getTaskRisks,
  getAssignmentReadiness,
  getAlertIntelligence,
  getPerformanceTrends,
  getIntegrationIntelligence,
  getUnifiedIntelligence,
  getOpenProjectIntelligence,
  getPresenceAnalytics,
};

/**
 * GET /analytics/integration-intelligence
 * Per-intern integration intelligence scores with explainability payloads.
 */
async function getIntegrationIntelligence(req, res, next) {
  try {
    const rows = await computeIntegrationIntelligence({});
    const summary = {
      total: rows.length,
      highRisk:    rows.filter(r => r.risk?.severity === 'high').length,
      warningRisk: rows.filter(r => r.risk?.severity === 'warning').length,
      avgDocActivityScore: rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.documentActivityScore ?? 0), 0) / rows.length)
        : null,
      avgIntegrationScore: rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.integrationIntelligenceScore ?? 0), 0) / rows.length)
        : null,
    };
    return ok(res, { rows, summary }, 'Integration intelligence fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/unified
 * Unified enterprise intelligence: EnterpriseHealth, OperationalRisk, TeamStability.
 */
async function getUnifiedIntelligence(req, res, next) {
  try {
    const data = await aggregateUnifiedIntelligence();
    return ok(res, data, 'Unified intelligence fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/openproject-intelligence
 * OpenProject operational intelligence signals: milestones, sync health, detected patterns.
 */
async function getOpenProjectIntelligence(req, res, next) {
  try {
    const { computeOPIntelligenceSignals } = require('../services/openproject.intelligence');
    const data = await computeOPIntelligenceSignals();
    return ok(res, data, 'OpenProject intelligence fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /analytics/presence
 * Presence intelligence: daily attendance, session duration, consistency rates.
 */
async function getPresenceAnalytics(req, res, next) {
  try {
    const { getPresenceIntelligence } = require('../services/presenceService');
    const days = req.query.days ? parseInt(req.query.days, 10) : 14;
    const data = await getPresenceIntelligence(days);
    return ok(res, data, 'Presence intelligence fetched.');
  } catch (err) {
    next(err);
  }
}
