'use strict';

// scheduler.js — periodic background sync scheduler.
//
// Jobs:
//   1. Sync scheduler (SYNC_INTERVAL_CRON, default every 15 min):
//      - syncTasksFromPlane()
//      - detectAndMarkStaleTasks()
//      - generateBlockerAlerts()
//
//   2. Weekly digest (DIGEST_CRON, default Monday 08:00 UTC):
//      - generateWeeklyDigest() — snapshots capacity/credibility/RPI per intern
//
// Configuration:
//   SYNC_INTERVAL_CRON — 5-field cron for the sync job (default: "*/15 * * * *")
//   DIGEST_CRON        — 5-field cron for the digest job (default: "0 8 * * 1")
//
// Both jobs are skipped when NODE_ENV === 'test'.
// Call scheduler.stop() on SIGINT / SIGTERM to clean up cron tasks.

const cron = require('node-cron');
const logger = require('../utils/logger');
const { syncTasksFromPlane, detectAndMarkStaleTasks, generateDeadlineAlerts, generateAvailabilityReminders, generateTaskReminders, generateFormReminders } = require('./taskService');
const { generateBlockerAlerts, generateReassignmentAlerts } = require('./alertService');
const realtimeEngine = require('./realtimeEngine');

// OpenProject modules loaded lazily inside job functions to prevent startup crashes
// if those modules have load-time errors
let _opService = null;
let _opIntelligence = null;

function getOPService() {
  if (!_opService) {
    try { _opService = require('./openproject.service'); } catch { _opService = { syncAllTasksToOP: async () => ({ pushed: 0, errors: 0 }) }; }
  }
  return _opService;
}

function getOPIntelligence() {
  if (!_opIntelligence) {
    try { _opIntelligence = require('./openproject.intelligence'); } catch { _opIntelligence = { runOPIntelligenceRefresh: async () => ({ signals: {}, alertsCreated: 0 }) }; }
  }
  return _opIntelligence;
}

const { generateWeeklyDigest } = require('./digestService');
const { recomputeInternTLI } = require('./recomputeInternTLI');


const DEFAULT_SYNC_CRON         = '*/15 * * * *';
const DEFAULT_DIGEST_CRON       = '0 8 * * 1';   // Monday 08:00 UTC
const DEFAULT_DEADLINE_CRON     = '0 * * * *';   // Every hour
const DEFAULT_AVAILABILITY_CRON = '0 9 * * 1';   // Monday 09:00 UTC
const DEFAULT_TASK_REMINDER_CRON = '0 9 * * 0,4'; // Thursday and Sunday 09:00 UTC
const DEFAULT_FORM_REMINDER_CRON = '0 9 * * 1,4'; // Monday & Thursday at 09:00 UTC
const DEFAULT_GDOC_REMINDER_CRON = '0 9 */3 * *'; // Every 3 days at 09:00 UTC
const DEFAULT_GDOC_META_CRON     = '0 */6 * * *'; // Every 6 hours

let _syncTask         = null;
let _digestTask       = null;
let _deadlineTask     = null;
let _availabilityTask = null;
let _taskReminderTask = null;
let _formReminderTask = null;
let _gdocReminderTask = null;
let _gdocMetaTask     = null;
let _staleTaskAutomationTask = null;
let _blockerEscalationTask = null;
let _reassignmentIntelligenceTask = null;
let _integrationIntelligenceTask = null;
let _opSyncTask = null;
let _opIntelligenceTask = null;
let _dbKeepAliveTask  = null;  // prevents Neon free-tier from suspending
let _presenceCleanupTask = null; // auto-closes stale open check-in sessions


// note: reassignment intelligence is implemented as a recommendation-only job



function _startSyncJob() {
  const expression = process.env.SYNC_INTERVAL_CRON || DEFAULT_SYNC_CRON;

  if (!cron.validate(expression)) {
    logger.error({ expression }, 'SYNC_INTERVAL_CRON is not a valid cron expression — sync job not started');
    return;
  }

  logger.info({ expression }, 'Starting periodic sync job');

  _syncTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'Sync job started');

    try {
      const { synced, error: syncErr } = await syncTasksFromPlane();
      if (syncErr) logger.warn({ runId, syncErr }, 'syncTasksFromPlane completed with error');
      else logger.info({ runId, synced }, 'syncTasksFromPlane completed');
    } catch (err) {
      logger.error({ runId, err }, 'syncTasksFromPlane threw unexpectedly');
    }

    // TLI recomputation (foundational): after plane sync
    try {
      const { getAllInternIds } = require('../utils/getAllInternIds');
      const internIds = await getAllInternIds();
      await Promise.all(internIds.map(id => recomputeInternTLI(id)));
      logger.info({ runId, internCount: internIds.length }, 'recomputeInternTLI after syncTasksFromPlane completed');
    } catch (err) {
      logger.error({ runId, err }, 'recomputeInternTLI after syncTasksFromPlane failed');
    }




    // NOTE: stale task automation is handled by a dedicated every-6-hours job.
    // The sync job intentionally does not run detectAndMarkStaleTasks() to preserve cadence.

    try {
      await generateBlockerAlerts();
      logger.info({ runId }, 'generateBlockerAlerts completed');
    } catch (err) {
      logger.error({ runId, err }, 'generateBlockerAlerts threw unexpectedly');
    }


    // TLI recomputation (foundational): after blocker escalation generation
    try {
      const { getAllInternIds } = require('../utils/getAllInternIds');
      const internIds = await getAllInternIds();
      await Promise.all(internIds.map(id => recomputeInternTLI(id)));
      logger.info({ runId, internCount: internIds.length }, 'recomputeInternTLI after generateBlockerAlerts completed');
    } catch (err) {
      logger.error({ runId, err }, 'recomputeInternTLI after generateBlockerAlerts failed');
    }

    // Broadcast operational pulse after sync completes
    try {
      await realtimeEngine.broadcastOperationalPulse();
    } catch (err) {
      logger.warn({ runId, err: err.message }, 'broadcastOperationalPulse after sync failed (non-fatal)');
    }

    // Broadcast unified enterprise health after sync
    try {
      const { aggregateUnifiedIntelligence } = require('./unifiedIntelligenceEngine');
      const unified = await aggregateUnifiedIntelligence();
      realtimeEngine.emitEnterpriseHealthUpdate(unified);
    } catch (err) {
      logger.warn({ runId, err: err.message }, 'emitEnterpriseHealthUpdate after sync failed (non-fatal)');
    }

    logger.info({ runId }, 'Sync job finished');
  });
}

function _startDigestJob() {
  const expression = process.env.DIGEST_CRON || DEFAULT_DIGEST_CRON;

  if (!cron.validate(expression)) {
    logger.error({ expression }, 'DIGEST_CRON is not a valid cron expression — digest job not started');
    return;
  }

  logger.info({ expression }, 'Starting weekly digest job');

  _digestTask = cron.schedule(expression, async () => {
    try {
      const { generated, errors } = await generateWeeklyDigest();
      if (errors > 0) logger.warn({ generated, errors }, 'Weekly digest completed with errors');
      else logger.info({ generated }, 'Weekly digest completed successfully');
    } catch (err) {
      logger.error({ err }, 'Weekly digest job threw unexpectedly');
    }
  });
}

function start() {
  if (_syncTask || _digestTask) {
    logger.warn('Scheduler already running — ignoring duplicate start() call');
    return;
  }
  _startSyncJob();
  _startDigestJob();
  _startDeadlineJob();
  _startAvailabilityReminderJob();
  _startTaskReminderJob();
  _startFormReminderJob();
  _startGdocReminderJob();
  _startGdocMetaRefreshJob();
  _startStaleTaskAutomationJob();
  _startBlockerEscalationJob();
  _startReassignmentIntelligenceJob();
  _startIntegrationIntelligenceJob();
  _startOPSyncJob();
  _startOPIntelligenceJob();
  _startDbKeepAliveJob();
  _startPresenceCleanupJob();
}

function _startIntegrationIntelligenceJob() {
  const expression = process.env.INTEGRATION_INTELLIGENCE_CRON || '0 */6 * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'INTEGRATION_INTELLIGENCE_CRON is not a valid cron expression — integration intelligence job not started');
    return;
  }

  logger.info({ expression }, 'Starting integration intelligence job');

  _integrationIntelligenceTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'Integration intelligence job started');

    try {
      const { getAllInternIds } = require('../utils/getAllInternIds');
      const { integrationIntelligenceRefresh } = require('./integrationIntelligenceEngine');
      const internIds = await getAllInternIds();

      const { createdAlerts } = await integrationIntelligenceRefresh({ internIds });
      logger.info({ runId, createdAlertsCount: createdAlerts.length }, 'Integration intelligence refresh completed');

      // Emit integration change realtime event
      const highRiskCount = createdAlerts.filter(a => a.severity === 'high').length;
      realtimeEngine.emitIntegrationChange({
        createdAlertsCount: createdAlerts.length,
        highRiskCount,
      });
    } catch (err) {
      logger.error({ runId, err }, 'Integration intelligence job threw unexpectedly');
    }

    logger.info({ runId }, 'Integration intelligence job finished');
  });
}




function stop() {
  if (_syncTask)         { _syncTask.stop();         _syncTask         = null; }
  if (_digestTask)       { _digestTask.stop();       _digestTask       = null; }
  if (_deadlineTask)     { _deadlineTask.stop();     _deadlineTask     = null; }
  if (_availabilityTask) { _availabilityTask.stop(); _availabilityTask = null; }
  if (_taskReminderTask) { _taskReminderTask.stop(); _taskReminderTask = null; }
  if (_formReminderTask) { _formReminderTask.stop(); _formReminderTask = null; }
  if (_gdocReminderTask) { _gdocReminderTask.stop(); _gdocReminderTask = null; }
  if (_gdocMetaTask)     { _gdocMetaTask.stop();     _gdocMetaTask     = null; }
  if (_staleTaskAutomationTask) { _staleTaskAutomationTask.stop(); _staleTaskAutomationTask = null; }
  if (_opSyncTask)        { _opSyncTask.stop();        _opSyncTask        = null; }
  if (_opIntelligenceTask){ _opIntelligenceTask.stop(); _opIntelligenceTask = null; }
  if (_dbKeepAliveTask)  { _dbKeepAliveTask.stop();  _dbKeepAliveTask  = null; }
  if (_presenceCleanupTask) { _presenceCleanupTask.stop(); _presenceCleanupTask = null; }
  logger.info('All scheduled jobs stopped');
}

function _startDeadlineJob() {
  const expression = process.env.DEADLINE_CRON || DEFAULT_DEADLINE_CRON;
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'DEADLINE_CRON is not valid — deadline alert job not started');
    return;
  }
  logger.info({ expression }, 'Starting deadline alert job');
  _deadlineTask = cron.schedule(expression, async () => {
    try {
      const count = await generateDeadlineAlerts();
      logger.info({ count }, 'generateDeadlineAlerts completed');
    } catch (err) {
      logger.error({ err }, 'generateDeadlineAlerts threw unexpectedly');
    }
  });
}

function _startAvailabilityReminderJob() {
  const expression = process.env.AVAILABILITY_REMINDER_CRON || DEFAULT_AVAILABILITY_CRON;
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'AVAILABILITY_REMINDER_CRON is not valid — reminder job not started');
    return;
  }
  logger.info({ expression }, 'Starting availability reminder job');
  _availabilityTask = cron.schedule(expression, async () => {
    try {
      const count = await generateAvailabilityReminders();
      logger.info({ count }, 'generateAvailabilityReminders completed');
    } catch (err) {
      logger.error({ err }, 'generateAvailabilityReminders threw unexpectedly');
    }
  });
}

function _startTaskReminderJob() {
  const expression = process.env.TASK_REMINDER_CRON || DEFAULT_TASK_REMINDER_CRON;
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'TASK_REMINDER_CRON is not valid — task reminder job not started');
    return;
  }
  logger.info({ expression }, 'Starting task reminder job');
  _taskReminderTask = cron.schedule(expression, async () => {
    try {
      const count = await generateTaskReminders();
      logger.info({ count }, 'generateTaskReminders completed');
    } catch (err) {
      logger.error({ err }, 'generateTaskReminders threw unexpectedly');
    }
  });
}

function _startFormReminderJob() {
  const expression = process.env.FORM_REMINDER_CRON || DEFAULT_FORM_REMINDER_CRON;
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'FORM_REMINDER_CRON is not valid — form reminder job not started');
    return;
  }
  logger.info({ expression }, 'Starting form reminder job');
  _formReminderTask = cron.schedule(expression, async () => {
    try {
      const count = await generateFormReminders();
      logger.info({ count }, 'generateFormReminders completed');
    } catch (err) {
      logger.error({ err }, 'generateFormReminders threw unexpectedly');
    }
  });
}

function _startGdocReminderJob() {
  const expression = process.env.GDOC_REMINDER_CRON || DEFAULT_GDOC_REMINDER_CRON;

  if (!cron.validate(expression)) {
    logger.warn({ expression }, 'GDOC_REMINDER_CRON is not a valid cron expression — falling back to default');
    return _startGdocReminderJobWithExpression(DEFAULT_GDOC_REMINDER_CRON);
  }

  return _startGdocReminderJobWithExpression(expression);
}

function _startGdocReminderJobWithExpression(expression) {
  logger.info({ expression }, 'Starting GDoc reminder job');
  _gdocReminderTask = cron.schedule(expression, async () => {
    try {
      const { sendGdocReminders } = require('./notification.service');
      const { sent, errors } = await sendGdocReminders();
      if (errors > 0) logger.warn({ sent, errors }, 'GDoc reminder job completed with errors');
      else logger.info({ sent }, 'GDoc reminder job completed successfully');
    } catch (err) {
      logger.error({ err }, 'GDoc reminder job threw unexpectedly');
    }
  });
}

// exported after all job definitions
function _startStaleTaskAutomationJob() {
  const expression = process.env.STALE_TASK_AUTOMATION_CRON || '0 */6 * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'STALE_TASK_AUTOMATION_CRON is not valid — stale automation job not started');
    return;
  }
  logger.info({ expression }, 'Starting stale task automation job');

  _staleTaskAutomationTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'Stale task automation job started');

    try {
      const staleCount = await detectAndMarkStaleTasks();
      logger.info({ runId, staleCount }, 'detectAndMarkStaleTasks completed');
    } catch (err) {
      logger.error({ runId, err }, 'detectAndMarkStaleTasks threw unexpectedly');
    }

    // After stale automation, recompute foundational TLI for all interns.
    try {
      const { getAllInternIds } = require('../utils/getAllInternIds');
      const internIds = await getAllInternIds();
      await Promise.all(internIds.map(id => recomputeInternTLI(id)));
      logger.info({ runId, internCount: internIds.length }, 'recomputeInternTLI after detectAndMarkStaleTasks completed');
    } catch (err) {
      logger.error({ runId, err }, 'recomputeInternTLI after detectAndMarkStaleTasks failed');
    }

    // Emit stale task realtime event
    try {
      const prisma = require('../utils/prisma');
      const staleThresh = new Date(Date.now() - (parseInt(process.env.SLA_STALE_DAYS) || 3) * 86400000);
      const staleSample = await prisma.task.findMany({
        where: { status: { in: ['active', 'stale'] }, lastUpdatedAt: { lt: staleThresh } },
        select: { id: true, title: true, internId: true, intern: { select: { user: { select: { name: true } } } } },
        take: 10,
      });
      realtimeEngine.emitStaleTaskUpdate({
        count: staleCount,
        staleTasks: staleSample.map(t => ({
          id: t.id, title: t.title, internId: t.internId,
          internName: t.intern?.user?.name || t.internId,
          daysSinceUpdate: Math.floor((Date.now() - new Date(t.lastUpdatedAt || 0).getTime()) / 86400000),
        })),
      });
    } catch (err) {
      logger.warn({ runId, err: err.message }, 'emitStaleTaskUpdate failed (non-fatal)');
    }

    logger.info({ runId }, 'Stale task automation job finished');
  });
}

function _startBlockerEscalationJob() {
  // Dedicated blocker escalation scheduler job: every 6 hours
  const expression = process.env.BLOCKER_ESCALATION_CRON || '0 */6 * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'BLOCKER_ESCALATION_CRON is not a valid cron expression — blocker escalation job not started');
    return;
  }

  logger.info({ expression }, 'Starting blocker escalation job');

  _blockerEscalationTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'Blocker escalation job started');

    try {
      const created = await generateBlockerAlerts();
      logger.info({ runId, created }, 'generateBlockerAlerts (blocker escalation) completed');
    } catch (err) {
      logger.error({ runId, err }, 'generateBlockerAlerts (blocker escalation) threw unexpectedly');
    }

    logger.info({ runId }, 'Blocker escalation job finished');
  });
}

function _startReassignmentIntelligenceJob() {
  const expression = process.env.REASSIGNMENT_INTELLIGENCE_CRON || '0 */6 * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'REASSIGNMENT_INTELLIGENCE_CRON is not a valid cron expression — reassignment intelligence job not started');
    return;
  }

  logger.info({ expression }, 'Starting reassignment intelligence job (recommendation-only)');

  _reassignmentIntelligenceTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'Reassignment intelligence job started');

    try {
      const { getReassignmentRecommendations } = require('./analyticsService');
      const payload = await getReassignmentRecommendations();

      // Create a reassignment alert per recommendation (idempotent handled by generateReassignmentAlerts).
      // We pass a finalCapacity proxy from owner capacityScore/100.
      let created = 0;
      for (const rec of payload.recommendations || []) {
        const finalCapacity = (rec?.ownerCapacityScore ?? rec?.owner?.capacityScore ?? rec?.ownerCapacity ?? 0) / 100;
        created += await generateReassignmentAlerts(rec.ownerInternId, finalCapacity);
      }

      logger.info({ runId, created, recommendationCount: payload.recommendations?.length || 0 }, 'Reassignment intelligence alerts generated');

      // Emit reassignment recommendation realtime event
      realtimeEngine.emitReassignmentRecommendation({
        count: payload.recommendations?.length || 0,
        recommendations: payload.recommendations || [],
      });
    } catch (err) {
      logger.error({ runId, err }, 'Reassignment intelligence job threw unexpectedly');
    }

    logger.info({ runId }, 'Reassignment intelligence job finished');
  });
}

function _startGdocMetaRefreshJob() {

  const expression = process.env.GDOC_META_CRON || DEFAULT_GDOC_META_CRON;

  if (!cron.validate(expression)) {
    logger.warn({ expression }, 'GDOC_META_CRON is not valid — falling back to default');
  }
  const expr = cron.validate(expression) ? expression : DEFAULT_GDOC_META_CRON;
  logger.info({ expr }, 'Starting GDoc metadata refresh job');
  _gdocMetaTask = cron.schedule(expr, async () => {
    try {
      const { refreshAllGdocMetadata } = require('./google.service');
      const { refreshed, errors } = await refreshAllGdocMetadata();
      if (errors > 0) logger.warn({ refreshed, errors }, 'GDoc meta refresh completed with errors');
      else logger.info({ refreshed }, 'GDoc meta refresh completed');
    } catch (err) {
      logger.error({ err }, 'GDoc meta refresh job threw unexpectedly');
    }
  });
}

// ── OpenProject outbound sync job ─────────────────────────────────────────────

function _startOPSyncJob() {
  const expression = process.env.OP_SYNC_CRON || '*/30 * * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'OP_SYNC_CRON is not valid — OpenProject sync job not started');
    return;
  }
  logger.info({ expression }, 'Starting OpenProject outbound sync job');

  _opSyncTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'OpenProject sync job started');
    try {
      const { syncAllTasksToOP } = getOPService();
      const { pushed, errors } = await syncAllTasksToOP();
      logger.info({ runId, pushed, errors }, 'OpenProject sync job completed');
    } catch (err) {
      logger.error({ runId, err: err.message }, 'OpenProject sync job threw unexpectedly');
    }
  });
}

// ── OpenProject intelligence job ──────────────────────────────────────────────

function _startOPIntelligenceJob() {
  const expression = process.env.OP_INTELLIGENCE_CRON || '0 */6 * * *';
  if (!cron.validate(expression)) {
    logger.error({ expression }, 'OP_INTELLIGENCE_CRON is not valid — OpenProject intelligence job not started');
    return;
  }
  logger.info({ expression }, 'Starting OpenProject intelligence job');

  _opIntelligenceTask = cron.schedule(expression, async () => {
    const runId = Date.now();
    logger.info({ runId }, 'OpenProject intelligence job started');
    try {
      const { runOPIntelligenceRefresh } = getOPIntelligence();
      const { signals, alertsCreated } = await runOPIntelligenceRefresh();
      logger.info({ runId, alertsCreated, opHealthScore: signals?.opHealthScore }, 'OpenProject intelligence job completed');

      if (signals?.available && signals?.opHealthScore < 60) {
        realtimeEngine.emitIntegrationChange({
          createdAlertsCount: alertsCreated,
          highRiskCount: signals?.detectedPatterns?.filter(p => p.severity === 'high').length ?? 0,
          source: 'openproject',
        });
      }
    } catch (err) {
      logger.error({ runId, err: err.message }, 'OpenProject intelligence job threw unexpectedly');
    }
    logger.info({ runId }, 'OpenProject intelligence job finished');
  });
}

// ── Neon DB keep-alive ────────────────────────────────────────────────────────
// Neon free tier suspends the compute after 5 min of inactivity.
// This job runs a cheap COUNT query every 4 min to keep the connection alive,
// preventing cold-start delays for real users and flaky E2E tests.
// Skipped in test environment (tests manage their own DB lifecycle).
function _startDbKeepAliveJob() {
  if (process.env.NODE_ENV === 'test') return;

  // Every 4 minutes — safely under Neon's 5-min suspend threshold
  _dbKeepAliveTask = cron.schedule('*/4 * * * *', async () => {
    try {
      // Reuse the shared Prisma instance (src/utils/prisma.js)
      const prisma = require('../utils/prisma');
      await prisma.$queryRaw`SELECT 1`;
      logger.debug('DB keep-alive ping OK');
    } catch (err) {
      // Non-fatal — just log at warn level so it's visible but doesn't alarm
      logger.warn({ err: err.message }, 'DB keep-alive ping failed (Neon may be waking up)');
    }
  });

  logger.info('DB keep-alive job started (every 4 min — prevents Neon suspension)');
}

// ── Presence cleanup job ──────────────────────────────────────────────────────
// Runs every 5 minutes. Auto-closes any VirtualPresence sessions that have
// been open for more than 12 hours (guards against forgotten check-outs).

function _startPresenceCleanupJob() {
  if (process.env.NODE_ENV === 'test') return;

  _presenceCleanupTask = cron.schedule('*/5 * * * *', async () => {
    try {
      const prisma = require('../utils/prisma');
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);

      const stale = await prisma.virtualPresence.findMany({
        where:  { checkOutAt: null, checkInAt: { lt: cutoff } },
        select: { id: true, checkInAt: true },
      });

      for (const s of stale) {
        const checkOutAt = new Date(new Date(s.checkInAt).getTime() + 12 * 60 * 60 * 1000);
        await prisma.virtualPresence.update({
          where: { id: s.id },
          data:  { checkOutAt, durationMinutes: 720 }, // cap at 12 h
        });
      }

      if (stale.length > 0) {
        logger.info({ count: stale.length }, 'Stale presence sessions auto-closed');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Presence cleanup job failed (non-fatal)');
    }
  });

  logger.info('Presence cleanup job started (every 5 min)');
}

module.exports = { start, stop };
