'use strict';

/**
 * health.routes.js
 *
 * Human-readable health and integration status endpoints.
 *
 * GET /health          — plain-English system overview (database + Plane + uptime)
 * GET /health/live     — liveness probe (is the process alive?)
 * GET /health/ready    — readiness probe (can it serve traffic?)
 * GET /health/integrations — detailed per-integration audit with plain-English summaries
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const prisma  = require('../utils/prisma');

// ── Internal probe helper ─────────────────────────────────────────────────────

/**
 * Wraps a promise with a hard timeout.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
async function probe(promise, timeoutMs = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out waiting for response')), timeoutMs);
  });
  try {
    await Promise.race([promise, timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Service checks ────────────────────────────────────────────────────────────

async function checkDatabase() {
  return probe(prisma.$queryRaw`SELECT 1`, 3000);
}

async function checkPlane() {
  const base      = process.env.PLANE_BASE_URL;
  const apiKey    = process.env.PLANE_API_KEY;
  const workspace = process.env.PLANE_WORKSPACE_SLUG;

  if (!base || !apiKey || !workspace) {
    return { ok: false, reason: 'not configured — PLANE_BASE_URL / API_KEY / WORKSPACE_SLUG missing' };
  }

  return probe(
    axios.get(`${base}/workspaces/${workspace}/`, {
      headers:       { 'x-api-key': apiKey },
      validateStatus: (s) => s < 500,
    }),
    3000,
  );
}

async function checkNextcloud() {
  const base     = process.env.NEXTCLOUD_URL || process.env.NEXTCLOUD_BASE_URL;
  const username = process.env.NEXTCLOUD_USERNAME;
  const password = process.env.NEXTCLOUD_PASSWORD;

  if (!base || !username || !password) {
    return { ok: false, reason: 'not configured' };
  }

  const url  = base.endsWith('/') ? base : `${base}/`;
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  return probe(
    axios.request({
      method:         'PROPFIND',
      url,
      headers:        { Authorization: `Basic ${auth}`, Depth: '0' },
      validateStatus: (s) => s < 500,
    }),
    3000,
  );
}

async function checkOpenProject() {
  const base   = process.env.OPENPROJECT_BASE_URL;
  const apiKey = process.env.OPENPROJECT_API_KEY;

  if (!base || !apiKey) {
    return { ok: false, reason: 'not configured — OPENPROJECT_BASE_URL / API_KEY missing' };
  }

  const auth = Buffer.from(`apikey:${apiKey}`).toString('base64');
  return probe(
    axios.get(`${base.replace(/\/$/, '')}/api/v3`, {
      headers:        { Authorization: `Basic ${auth}` },
      validateStatus: (s) => s < 500,
    }),
    4000,
  );
}

// ── Uptime formatter ──────────────────────────────────────────────────────────

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /health/live
 *
 * Liveness probe — is Express still alive?
 * Returns 200 immediately with no I/O. If this fails, the process is dead.
 */
router.get('/live', (_req, res) => {
  res.json({
    status:    'alive',
    message:   'URIS backend process is running.',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 *
 * Readiness probe — can this instance serve real traffic?
 * Checks the database (required). Plane is optional — its absence is warned, not fatal.
 * Returns 503 only if the database is unreachable.
 */
router.get('/ready', async (_req, res) => {
  const db = await checkDatabase();

  if (!db.ok) {
    return res.status(503).json({
      status:  'not_ready',
      message: `Cannot serve traffic — database is unreachable. Reason: ${db.reason}`,
      fix:     'Check DATABASE_URL in your .env and verify the Neon database is not suspended.',
    });
  }

  const plane = await checkPlane();

  if (!plane.ok) {
    return res.json({
      status:   'ready',
      message:  'Ready to serve traffic. Database is connected.',
      warnings: [
        `Plane.so is not reachable (${plane.reason}). Task sync and webhook delivery will not work until this is resolved.`,
      ],
    });
  }

  return res.json({
    status:  'ready',
    message: 'All systems go. Database and Plane.so are connected.',
  });
});

/**
 * GET /health
 *
 * Full human-readable system overview.
 * Reports: overall health, uptime, database, Plane.so, and Nextcloud.
 *
 * Overall status meanings:
 *   OK       — everything is working
 *   DEGRADED — database is up but Plane.so is unreachable (task sync broken)
 *   DOWN     — database is unreachable (the app cannot function)
 *
 * Note: Nextcloud being unconfigured or unreachable does NOT degrade status.
 * It is optional infrastructure. Only the database and Plane affect overall health.
 */
router.get('/', async (_req, res) => {
  const [db, plane, nextcloud] = await Promise.all([
    checkDatabase(),
    checkPlane(),
    checkNextcloud(),
  ]);

  // ── Overall status ─────────────────────────────────────────────────────────
  let overallStatus, overallMessage;

  if (!db.ok) {
    overallStatus  = 'DOWN';
    overallMessage = 'URIS is not operational. The database is unreachable.';
  } else if (!plane.ok) {
    overallStatus  = 'DEGRADED';
    overallMessage = 'URIS is running but task sync is broken. Plane.so is unreachable.';
  } else {
    overallStatus  = 'OK';
    overallMessage = 'All core systems are operational.';
  }

  // ── Per-service summaries ──────────────────────────────────────────────────
  const services = {
    database: {
      status:  db.ok ? '✓ Connected' : '✗ Unreachable',
      detail:  db.ok
        ? 'PostgreSQL (Neon) is responding normally.'
        : `Cannot reach database. ${db.reason}. Check DATABASE_URL.`,
    },
    plane: {
      status:  plane.ok ? '✓ Connected' : '✗ Unreachable',
      detail:  plane.ok
        ? 'Plane.so API is reachable. Task sync and webhooks are operational.'
        : `Plane.so is not reachable. ${plane.reason}. Task sync is paused until restored.`,
    },
    nextcloud: {
      status:  nextcloud.ok
        ? '✓ Connected'
        : nextcloud.reason === 'not configured'
          ? '— Not configured (optional)'
          : '✗ Unreachable',
      detail:  nextcloud.ok
        ? 'Nextcloud WebDAV is reachable. File uploads are working.'
        : nextcloud.reason === 'not configured'
          ? 'Nextcloud is not set up. This is optional — the rest of the system works without it.'
          : `Nextcloud is configured but not reachable. ${nextcloud.reason}. File uploads will fail.`,
    },
  };

  return res.status(overallStatus === 'DOWN' ? 503 : 200).json({
    status:    overallStatus,
    message:   overallMessage,
    uptime:    formatUptime(process.uptime()),
    timestamp: new Date().toISOString(),
    services,
  });
});

/**
 * GET /health/integrations
 *
 * Detailed integration audit for the admin dashboard.
 * Each integration includes:
 *   - status: connected | partial | not_configured | failed
 *   - health: plain-English one-liner (what's working, what's broken, what to fix)
 *   - configured: whether all required env vars are present
 *   - operational: whether the integration is actively working right now
 *   - notes: live runtime data (token counts, sync times, task counts)
 *   - requiredEnvVars: which env vars the integration needs
 *   - features: what this integration powers in the product
 */
router.get('/integrations', async (_req, res) => {
  // Run all external checks concurrently
  const [db, nextcloud, plane, openproject] = await Promise.all([
    checkDatabase(),
    checkNextcloud(),
    checkPlane(),
    checkOpenProject(),
  ]);

  // ── Google ─────────────────────────────────────────────────────────────────
  let googleTokenCount = 0;
  let googleDbOk = true;
  try {
    googleTokenCount = await prisma.googleToken.count();
  } catch {
    googleDbOk = false;
  }

  const googleEnvOk = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );

  const googleStatus = googleEnvOk && googleDbOk ? 'connected'
    : googleEnvOk ? 'partial'
    : 'not_configured';

  const googleHealth = !googleEnvOk
    ? 'Not set up. Users cannot connect Google Drive or Calendar. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to enable.'
    : !googleDbOk
      ? 'Env vars are set but the GoogleToken table is unreachable. Database may have a schema issue.'
      : googleTokenCount === 0
        ? 'Configured and ready. No users have connected their Google account yet — they can do so from their profile settings.'
        : `Working. ${googleTokenCount} user${googleTokenCount !== 1 ? 's have' : ' has'} connected Google. Drive metadata, Calendar, and GDoc reminders are active.`;

  // ── Resend Email ───────────────────────────────────────────────────────────
  const resendEnvOk  = !!process.env.RESEND_API_KEY;
  const resendFromOk = !!(process.env.RESEND_FROM || process.env.SMTP_FROM);
  const resendSender = process.env.RESEND_FROM || process.env.SMTP_FROM || null;

  const resendStatus = resendEnvOk && resendFromOk ? 'connected'
    : resendEnvOk ? 'partial'
    : 'not_configured';

  const resendHealth = !resendEnvOk
    ? 'Not configured. All outbound emails are silently skipped — password resets, account approvals, and task notifications will NOT be delivered. Add RESEND_API_KEY to fix.'
    : !resendFromOk
      ? 'API key is set but RESEND_FROM sender address is missing. Emails will fail to send. Add RESEND_FROM to fix.'
      : `Working. Sending from: ${resendSender}. All email templates are active.`;

  // ── Plane.so ───────────────────────────────────────────────────────────────
  const planeEnvOk = !!(
    process.env.PLANE_BASE_URL &&
    process.env.PLANE_API_KEY &&
    process.env.PLANE_WORKSPACE_SLUG &&
    process.env.PLANE_PROJECT_ID
  );

  let taskCount = 0;
  let lastSync  = null;
  try { taskCount = await prisma.task.count(); } catch { /* graceful */ }
  try {
    const latest = await prisma.syncLog.findFirst({ orderBy: { createdAt: 'desc' } });
    lastSync = latest?.createdAt ?? null;
  } catch { /* graceful */ }

  const planeStatus = plane.ok ? 'connected' : planeEnvOk ? 'partial' : 'not_configured';

  const planeHealth = !planeEnvOk
    ? 'Not configured. Task sync is disabled — tasks must be managed manually. Add PLANE_BASE_URL, PLANE_API_KEY, PLANE_WORKSPACE_SLUG, and PLANE_PROJECT_ID to enable.'
    : !plane.ok
      ? `Env vars are set but Plane.so API is not reachable (${plane.reason}). Task sync is paused. Check your API key and network access.`
      : `Working. ${taskCount} task${taskCount !== 1 ? 's' : ''} synced from Plane.so. Last sync: ${lastSync ? new Date(lastSync).toLocaleString('en-GB') : 'never — cron has not run yet'}.`;

  // ── Nextcloud ──────────────────────────────────────────────────────────────
  const nextcloudEnvOk = !!(
    process.env.NEXTCLOUD_URL &&
    process.env.NEXTCLOUD_USERNAME &&
    process.env.NEXTCLOUD_PASSWORD
  );

  let syncLogCount = 0;
  try {
    syncLogCount = await prisma.syncLog.count();
  } catch { /* graceful */ }

  const nextcloudStatus = nextcloud.ok ? 'connected'
    : nextcloudEnvOk ? 'partial'
    : 'not_configured';

  const nextcloudHealth = !nextcloudEnvOk
    ? 'Not configured. This is optional — document upload to Nextcloud is disabled but all other features work normally.'
    : !nextcloud.ok
      ? `Credentials are set but Nextcloud is not reachable (${nextcloud.reason}). File uploads will fail. Check NEXTCLOUD_URL and your server.`
      : `Working. ${syncLogCount} file${syncLogCount !== 1 ? 's' : ''} synced via WebDAV.`;

  // ── Database ───────────────────────────────────────────────────────────────
  const dbHealth = db.ok
    ? 'Connected. Prisma ORM is active. All models and queries are working normally.'
    : `Unreachable. ${db.reason}. The entire application is non-functional without the database. Check DATABASE_URL.`;

  // ── OpenProject ────────────────────────────────────────────────────────────
  const opEnvOk = !!(
    process.env.OPENPROJECT_BASE_URL &&
    process.env.OPENPROJECT_API_KEY
  );

  let opSyncedCount = 0;
  try {
    opSyncedCount = await prisma.task.count({ where: { note: { contains: 'op:' } } });
  } catch { /* graceful */ }

  const opStatus = openproject.ok ? 'connected' : opEnvOk ? 'partial' : 'not_configured';

  const opHealth = !opEnvOk
    ? 'Not configured. OpenProject work package sync is disabled.'
    : !openproject.ok
      ? `Env vars are set but OpenProject is not reachable (${openproject.reason}). Outbound sync is paused.`
      : `Working. ${opSyncedCount} task${opSyncedCount !== 1 ? 's' : ''} linked to OpenProject work packages.`;

  // ── Build response ─────────────────────────────────────────────────────────
  const integrations = [
    {
      // ── Identity ──────────────────────────────────────────────────────────
      id:   'database',
      name: 'PostgreSQL  (Neon)',

      // ── Status ────────────────────────────────────────────────────────────
      // status      — machine-readable verdict:  connected | partial | not_configured | failed
      // operational — true when the service is actively responding right now
      // configured  — true when all required env vars are present in .env
      status:      db.ok ? 'connected' : 'failed',
      operational: db.ok,
      configured:  !!process.env.DATABASE_URL,

      // ── Plain-English summary ─────────────────────────────────────────────
      // What is working, what is broken, and what to do to fix it
      health: dbHealth,

      // ── Required environment variables ────────────────────────────────────
      required_env_vars: ['DATABASE_URL'],

      // ── What this integration powers in the product ───────────────────────
      powers: [
        'All data storage (users, tasks, scores, alerts, chat, audit logs)',
        'Every API endpoint depends on this — nothing works without it',
      ],

      // ── Visibility ────────────────────────────────────────────────────────
      // frontendVisible — whether this integration has a settings panel in the admin UI
      frontendVisible: false,
    },

    // ─────────────────────────────────────────────────────────────────────────

    {
      id:   'resend',
      name: 'Resend Email',

      status:      resendStatus,
      operational: resendEnvOk && resendFromOk,
      configured:  resendEnvOk,

      health: resendHealth,

      // ── Live runtime data ─────────────────────────────────────────────────
      // Real values pulled from DB / env at the time of this request
      runtime: {
        sender_address:    resendSender ?? 'not set',
        api_key_present:   resendEnvOk,
        from_address_set:  resendFromOk,
      },

      required_env_vars: ['RESEND_API_KEY', 'RESEND_FROM'],

      powers: [
        'Password reset  — user clicks "Forgot Password", gets a reset link by email',
        'Password changed  — confirmation email after any password change',
        'Account approved  — email to intern when admin approves their registration',
        'Task assigned  — email to intern when a task is assigned to them',
        'GDoc reminder  — every 3 days, reminds interns to update their work log',
        'Operational alerts  — critical alert emails to leads/admins',
      ],

      frontendVisible: false,
    },

    // ─────────────────────────────────────────────────────────────────────────

    {
      id:   'plane',
      name: 'Plane.so  Task Sync',

      status:      planeStatus,
      operational: plane.ok,
      configured:  planeEnvOk,

      health: planeHealth,

      runtime: {
        tasks_in_database:  taskCount,
        last_sync:          lastSync
          ? new Date(lastSync).toLocaleString('en-GB')
          : 'never — scheduler has not run a sync yet',
        webhook_endpoint:   '/webhooks/plane',
        sync_interval:      process.env.SYNC_INTERVAL_CRON || '*/15 * * * *  (every 15 min)',
      },

      required_env_vars: [
        'PLANE_BASE_URL',
        'PLANE_API_KEY',
        'PLANE_WORKSPACE_SLUG',
        'PLANE_PROJECT_ID',
        'PLANE_WEBHOOK_SECRET',
      ],

      powers: [
        'Pulls all issues from Plane every 15 min into the tasks table',
        'Webhook triggers an immediate single-issue sync on issue.created / issue.updated',
        'HMAC-SHA256 signature verification on every inbound webhook',
        'Task data feeds TLI (Task Load Index) and capacity scoring',
        'Stale task detection  — marks tasks with no update in 3+ days',
        'Blocker alert generation  — creates alerts when tasks have blockers',
      ],

      frontendVisible: false,
    },

    // ─────────────────────────────────────────────────────────────────────────

    {
      id:   'google',
      name: 'Google  (Drive · Docs · Calendar)',

      status:      googleStatus,
      operational: googleEnvOk && googleDbOk,
      configured:  googleEnvOk,

      health: googleHealth,

      runtime: {
        users_connected:      googleTokenCount,
        oauth_redirect_uri:   process.env.GOOGLE_REDIRECT_URI || 'not set',
        gdoc_stale_threshold: `${process.env.GDOC_STALE_DAYS || 3} days without edit = stale`,
        gdoc_meta_refresh:    process.env.GDOC_META_CRON || '0 */6 * * *  (every 6 hours)',
        gdoc_reminder_cron:   process.env.GDOC_REMINDER_CRON || '0 9 */3 * *  (every 3 days)',
      },

      required_env_vars: [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
      ],

      powers: [
        'OAuth 2.0 flow  — interns connect their Google account from profile settings',
        'Drive metadata  — tracks file name, size, and last-modified for each intern GDoc',
        'Drive Activity API  — detects real edits vs just opens for stale-GDoc logic',
        'Google Calendar  — reads busy slots to inform capacity and availability scoring',
        'GDoc stale detection  — flags work logs not edited in 3+ days, triggers reminders',
        'Token refresh cron  — refreshes OAuth tokens every 6 hours to prevent expiry',
      ],

      frontendVisible: true,
    },

    // ─────────────────────────────────────────────────────────────────────────

    {
      id:   'nextcloud',
      name: 'Nextcloud  WebDAV',

      status:      nextcloudStatus,
      operational: nextcloud.ok,
      configured:  nextcloudEnvOk,

      health: nextcloudHealth,

      runtime: {
        sync_log_entries: syncLogCount,
        webdav_url:       process.env.NEXTCLOUD_URL || 'not set',
        request_timeout:  `${process.env.NEXTCLOUD_REQUEST_TIMEOUT_MS || 15000} ms`,
        test_endpoint:    '/nextcloud/test-nextcloud',
      },

      required_env_vars: [
        'NEXTCLOUD_URL',
        'NEXTCLOUD_USERNAME',
        'NEXTCLOUD_PASSWORD',
      ],

      powers: [
        'WebDAV PUT upload  — pushes files from the app to Nextcloud storage',
        'Retry with exponential backoff  — retries failed uploads automatically',
        'Sync log  — every upload attempt is recorded in the SyncLog table',
        'Test route  — GET /nextcloud/test-nextcloud verifies the connection manually',
      ],

      // OPTIONAL — the rest of the system works fine without Nextcloud
      optional: true,
      frontendVisible: false,
    },

    // ─────────────────────────────────────────────────────────────────────────

    {
      id:   'openproject',
      name: 'OpenProject',

      status:      opStatus,
      operational: openproject.ok,
      configured:  opEnvOk,

      health: opHealth,

      runtime: {
        tasks_linked_to_work_packages: opSyncedCount,
        webhook_endpoint:              '/webhooks/openproject',
        outbound_sync_interval:        process.env.OP_SYNC_CRON || '*/30 * * * *  (every 30 min)',
        intelligence_refresh_interval: process.env.OP_INTELLIGENCE_CRON || '0 */6 * * *  (every 6 hours)',
      },

      required_env_vars: [
        'OPENPROJECT_BASE_URL',
        'OPENPROJECT_API_KEY',
        'OPENPROJECT_WEBHOOK_SECRET',
      ],

      powers: [
        'Work package create / update  — pushes task changes from URIS to OpenProject',
        'Assignee sync  — keeps assignee in sync when tasks are reassigned',
        'Deadline sync  — mirrors task deadlines into OpenProject milestones',
        'Status sync  — active / stale / completed / paused states stay in sync',
        'Blocker sync  — blocker details written as comments on work packages',
        'Comment / activity sync  — task updates appear as journal entries in OP',
        'Inbound webhook  — OpenProject pushes changes back to URIS in real time',
        'Intelligence signals  — detects assignment churn and milestone instability',
      ],

      frontendVisible: true,
    },
  ];

  // ── Overall summary ────────────────────────────────────────────────────────
  const failed      = integrations.filter(i => i.status === 'failed');
  const unconfigured = integrations.filter(i => i.status === 'not_configured');
  const partial     = integrations.filter(i => i.status === 'partial');
  const connected   = integrations.filter(i => i.status === 'connected');

  let overallStatus, overallSummary;

  if (failed.length > 0) {
    overallStatus  = 'degraded';
    overallSummary = `${failed.length} integration${failed.length > 1 ? 's are' : ' is'} failing: ${failed.map(i => i.name).join(', ')}. Immediate attention required.`;
  } else if (partial.length > 0) {
    overallStatus  = 'partial';
    overallSummary = `${connected.length} of ${integrations.length} integrations are fully operational. ${partial.length} ${partial.length > 1 ? 'have' : 'has'} env vars set but cannot reach the service: ${partial.map(i => i.name).join(', ')}.`;
  } else if (unconfigured.length > 0) {
    const requiredUnconfigured = unconfigured.filter(i => ['database', 'resend', 'plane'].includes(i.id));
    overallStatus  = requiredUnconfigured.length > 0 ? 'partial' : 'all_operational';
    overallSummary = requiredUnconfigured.length > 0
      ? `Core integration not configured: ${requiredUnconfigured.map(i => i.name).join(', ')}. Optional ones (${unconfigured.filter(i => !['database', 'resend', 'plane'].includes(i.id)).map(i => i.name).join(', ')}) are intentionally skipped.`
      : `All required integrations are operational. ${unconfigured.length} optional integration${unconfigured.length > 1 ? 's are' : ' is'} not configured (${unconfigured.map(i => i.name).join(', ')}) — this is fine.`;
  } else {
    overallStatus  = 'all_operational';
    overallSummary = 'All integrations are connected and working normally.';
  }

  return res.json({
    status:    overallStatus,
    summary:   overallSummary,
    timestamp: new Date().toISOString(),
    uptime:    formatUptime(process.uptime()),
    counts: {
      total:        integrations.length,
      connected:    connected.length,
      partial:      partial.length,
      unconfigured: unconfigured.length,
      failed:       failed.length,
    },
    integrations,
  });
});

module.exports = router;
