'use strict';

/**
 * analytics.routes.js — Phase 7 Operational Intelligence Layer
 *
 * GET /analytics/dashboard              — full payload (all sections)
 * GET /analytics/workload               — workload distribution
 * GET /analytics/support                — support request summary
 * GET /analytics/trends/scores          — capacity/credibility/performance trends
 * GET /analytics/trends/workload        — workload growth + assignment density
 * GET /analytics/capacity-history/:id   — per-intern capacity sparkline
 * GET /analytics/sla                    — SLA status report
 * GET /analytics/teams                  — team health overview
 * GET /analytics/digest                 — weekly operational digest
 * GET /analytics/task-risks             — severity-ranked task risk list
 * GET /analytics/assignment-readiness   — intern assignment readiness rankings
 * GET /analytics/alert-intelligence     — grouped alert insights
 * GET /analytics/performance-trends     — per-intern performance/credibility trends
 */

const express = require('express');
const router  = express.Router();
const {
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
} = require('../controllers/analytics.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { ROLES } = require('../constants/roles');

const ANALYTICS_ROLES = [
  ROLES.CORE_ADMIN,
  ROLES.OPERATIONS_LEAD,
  ROLES.OPERATIONS_PROGRAM_MANAGER,
  ROLES.TECHNICAL_LEAD,
  ROLES.RESEARCH_LEAD,
];

const auth = [verifyToken, requireRole(...ANALYTICS_ROLES)];

router.get('/dashboard',                    ...auth, getDashboard);
router.get('/workload',                     ...auth, getWorkload);
router.get('/support',                      ...auth, getSupport);
router.get('/trends/scores',                ...auth, getTrendScores);
router.get('/trends/workload',              ...auth, getTrendWorkload);
router.get('/capacity-history/:internId',   ...auth, getInternCapacityHistory);
router.get('/sla',                          ...auth, getSLA);
router.get('/teams',                        ...auth, getTeams);
router.get('/digest',                       ...auth, getDigest);
router.get('/task-risks',                   ...auth, getTaskRisks);
router.get('/assignment-readiness',         ...auth, getAssignmentReadiness);
router.get('/alert-intelligence',           ...auth, getAlertIntelligence);
router.get('/performance-trends',           ...auth, getPerformanceTrends);
router.get('/integration-intelligence',     ...auth, getIntegrationIntelligence);
router.get('/unified',                      ...auth, getUnifiedIntelligence);
router.get('/openproject-intelligence',     ...auth, getOpenProjectIntelligence);
router.get('/presence',                     ...auth, getPresenceAnalytics);

module.exports = router;
