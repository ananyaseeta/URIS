const path = require('path');
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const logger  = require('./src/utils/logger');
const { apiLimiter } = require('./src/middleware/rateLimit.middleware');

const availabilityRoutes = require('./src/routes/availability.routes');
const assignmentRoutes   = require('./src/routes/assignment.routes');
const demoRoutes         = require('./src/routes/demo.routes');
const authRoutes         = require('./src/routes/auth.routes');
const taskRoutes         = require('./src/routes/task.routes');
const credibilityRoutes  = require('./src/routes/credibility.routes');
const alertRoutes        = require('./src/routes/alert.routes');
const reviewRoutes       = require('./src/routes/review.routes');
const performanceRoutes  = require('./src/routes/performance.routes');
const adminRoutes        = require('./src/routes/admin.routes');
const scoreRoutes        = require('./src/routes/score.routes');
const internRoutes       = require('./src/routes/intern.routes');
const nextcloudRoutes    = require('./src/routes/nextcloud.routes');
const auditLogRoutes     = require('./src/routes/auditLog.routes');
const activityRoutes     = require('./src/routes/activity.routes');
const teamRoutes         = require('./src/routes/team.routes');

const portfolioRoutes    = require('./src/routes/portfolio.routes.js');
const analyticsRoutes    = require('./src/routes/analytics.routes');
const governanceRoutes   = require('./src/routes/governance.routes');
const workflowRoutes     = require('./src/routes/workflow.routes');
const profileRoutes      = require('./src/routes/profile.routes');
const googleRoutes       = require('./src/routes/google.routes');
const documentRoutes     = require('./src/routes/document.routes');
const chatRoutes         = require('./src/routes/chat.routes');

const healthRoutes       = require('./src/routes/health.routes');
const webhookRoutes      = require('./src/routes/webhook.routes');
const supportRoutes      = require('./src/routes/support.routes');
const archiveRoutes      = require('./src/routes/archive.routes');
const operationalRoutes  = require('./src/routes/operational.routes');
const { errorHandler }   = require('./src/middleware/error.middleware');
const { ipBlockMiddleware } = require('./src/middleware/ipBlock.middleware');

const app = express();

// ── Trust proxy ───────────────────────────────────────────────────────────────
// Render (and most cloud platforms) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and req.ip returns the proxy IP instead of the real client IP.
app.set('trust proxy', 1);

// ── Production startup guard ──────────────────────────────────────────────────
// DATABASE_URL must always be set — Prisma will crash with an unhelpful error
// if it is missing. Check early so the failure message is clear.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set. Server cannot start.');
}

// In production, FRONTEND_URL must be explicitly set. Falling back to
// localhost in production would silently open CORS to the wrong origin.
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  throw new Error('FRONTEND_URL environment variable is not set. Server cannot start in production.');
}

// PLANE_WEBHOOK_SECRET must be set in production — without it every incoming
// webhook request will be rejected with 500, silently breaking real-time sync.
if (process.env.NODE_ENV === 'production' && !process.env.PLANE_WEBHOOK_SECRET) {
  throw new Error('PLANE_WEBHOOK_SECRET environment variable is not set. Server cannot start in production.');
}

// APP_BASE_URL must be set in production — without it profile picture URLs will
// point to localhost and be broken for all users.
if (process.env.NODE_ENV === 'production' && !process.env.APP_BASE_URL) {
  throw new Error('APP_BASE_URL environment variable is not set. Server cannot start in production.');
}

// SCOPE NOTE: OpenProject integration is DESCOPED.
// The system uses Plane.so as the sole project management integration.
// All task sync, webhook, and issue mapping code targets Plane.so only.
// OpenProject support will not be added unless explicitly re-scoped.

// Build the allowed origins list from FRONTEND_URL (comma-separated for multiple)
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Security headers ──────────────────────────────────────────────────────────
// helmet sets X-Content-Type-Options, X-Frame-Options, HSTS, CSP, and more.
// Must come before any route handlers.
app.use(helmet());

// ── Global API rate limiter ───────────────────────────────────────────────────
// Applied to all routes except /health (probes must never be throttled).
// Auth routes have their own tighter limiters applied at the route level.
app.use(apiLimiter);

// ── Webhook routes MUST be registered before express.json() ──────────────────
// The Plane webhook route uses express.raw() internally so it can read the
// raw body bytes for HMAC-SHA256 signature verification.  If express.json()
// runs first the raw body is consumed and verification will always fail.
app.use('/webhooks', webhookRoutes);

app.use(express.json());

// ── IP block check ────────────────────────────────────────────────────────────
// Runs after express.json() so req.ip is resolved, but before any route
// handlers. Degrades gracefully if the BlockedIP table doesn't exist yet.
app.use(ipBlockMiddleware);

// ── Minimal structured HTTP request log ──────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'incoming request');
  next();
});

app.use('/availability', availabilityRoutes);
app.use('/assign',       assignmentRoutes);
app.use('/demo',         demoRoutes);
app.use('/auth',         authRoutes);
app.use('/auth',         googleRoutes);   // Google OAuth: /auth/google, /auth/google/callback
app.use('/tasks',        taskRoutes);
app.use('/credibility',  credibilityRoutes);
app.use('/alerts',       alertRoutes);
app.use('/review',       reviewRoutes);
app.use('/performance',  performanceRoutes);
app.use('/admin',        adminRoutes);
app.use('/score',        scoreRoutes);
app.use('/intern',       internRoutes);
app.use('/audit-logs',   auditLogRoutes);
app.use('/activity',     activityRoutes);
app.use('/teams',        teamRoutes);
app.use('/health',       healthRoutes);
app.use('/nextcloud',    nextcloudRoutes);
app.use('/portfolio',    portfolioRoutes);
app.use('/analytics',    analyticsRoutes);
app.use('/governance',   governanceRoutes);
app.use('/workflow',     workflowRoutes);
app.use('/support',      supportRoutes);
app.use('/operational',  operationalRoutes);
app.use('/archive',      archiveRoutes);
app.use('/profile',      profileRoutes);
app.use('/google',       googleRoutes);   // Google data: /google/worklog, /google/calendar
app.use('/document',     documentRoutes); // Document submission: /document/submit, /document/mine, /document/lead/:internId
app.use('/chat',         chatRoutes);     // Chat system: /chat/friend-requests, /chat/chats, /chat/messages
// Serve uploaded profile pictures — /tmp in production (Render), local in dev
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.NODE_ENV === 'production'
    ? '/tmp/uploads/profile-pictures'
    : path.join(__dirname, 'uploads', 'profile-pictures');
app.use('/uploads/profile-pictures', express.static(uploadDir));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



app.use(errorHandler);

const prisma          = require('./src/utils/prisma');
const scheduler       = require('./src/services/scheduler');

// Load realtimeEngine lazily — if socket.io fails to load, server still starts
let realtimeEngine = null;
try {
  realtimeEngine = require('./src/services/realtimeEngine');
} catch (err) {
  logger.warn({ err: err.message }, 'realtimeEngine failed to load — realtime features disabled');
}

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server running');

  if (process.env.NODE_ENV !== 'test') {
    if (realtimeEngine) {
      try {
        realtimeEngine.init(server, ALLOWED_ORIGINS);
      } catch (err) {
        logger.warn({ err: err.message }, 'Socket.IO init failed — realtime features disabled');
      }
    }
    scheduler.start();
  }
});

const shutdown = () => {
  scheduler.stop();
  prisma.$disconnect().finally(() => server.close());
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
