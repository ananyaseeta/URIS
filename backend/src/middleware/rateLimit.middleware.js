'use strict';

/**
 * rateLimit.middleware.js
 *
 * Configures express-rate-limit instances for authentication endpoints.
 *
 * Limits are tunable via environment variables so they can be tightened
 * in production without a code change:
 *
 *   RATE_LIMIT_LOGIN_WINDOW_MS     — sliding window in ms   (default: 15 min)
 *   RATE_LIMIT_LOGIN_MAX           — max attempts per window (default: 10)
 *   RATE_LIMIT_REGISTER_WINDOW_MS  — sliding window in ms   (default: 60 min)
 *   RATE_LIMIT_REGISTER_MAX        — max attempts per window (default: 5)
 *
 * On limit breach the middleware returns:
 *   429 { success: false, error: 'RATE_LIMITED', message: '...', data: null }
 *
 * The response shape matches the project-wide error format used by
 * error.middleware.js so the frontend error handler works without changes.
 */

const rateLimit = require('express-rate-limit');

// ── Shared response handler ───────────────────────────────────────────────────

function rateLimitHandler(req, res) {
  return res.status(429).json({
    success: false,
    error:   'RATE_LIMITED',
    message: 'Too many requests. Please wait before trying again.',
    data:    null,
  });
}

// ── Login limiter ─────────────────────────────────────────────────────────────
// 10 attempts per 15 minutes per IP — tight enough to block brute-force,
// loose enough for legitimate users who mistype their password a few times.

const loginLimiter = rateLimit({
  windowMs:         parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS)  || 15 * 60 * 1000,
  max:              parseInt(process.env.RATE_LIMIT_LOGIN_MAX)         || 10,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
  handler:          rateLimitHandler,
});

const registerLimiter = rateLimit({
  windowMs:         parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS) || 60 * 60 * 1000,
  max:              parseInt(process.env.RATE_LIMIT_REGISTER_MAX)        || 5,
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
  handler:          rateLimitHandler,
});

// ── Global API limiter ────────────────────────────────────────────────────────
// Applied to all non-auth routes as a baseline abuse guard.
// Much more permissive than the auth limiters — intended to stop runaway
// scripts and scrapers, not to throttle legitimate users.
//
//   RATE_LIMIT_API_WINDOW_MS  — sliding window in ms   (default: 1 min)
//   RATE_LIMIT_API_MAX        — max requests per window (default: 200)

const apiLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_API_WINDOW_MS) || 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_API_MAX)        || 200,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  handler:         rateLimitHandler,
  // Skip the health endpoint — liveness/readiness probes must never be throttled
  skip: (req) => req.path.startsWith('/health'),
});

const forgotPasswordLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_FORGOT_WINDOW_MS) || 15 * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_FORGOT_MAX)        || 5,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

module.exports = { loginLimiter, registerLimiter, apiLimiter, forgotPasswordLimiter, chatMessageLimiter };

// ── Chat message limiter ──────────────────────────────────────────────────────
// Per-user (keyed by JWT user id) limit on sending messages.
// Prevents a single user from flooding a chat.
//
//   RATE_LIMIT_CHAT_WINDOW_MS  — sliding window in ms  (default: 10 s)
//   RATE_LIMIT_CHAT_MAX        — max messages per window (default: 10)
//
// 10 messages per 10 seconds is generous for normal conversation but
// stops programmatic flooding at HTTP throughput.
const chatMessageLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_CHAT_WINDOW_MS) || 10 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_CHAT_MAX)        || 10,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  // Key by authenticated user id, not IP — so VPNs / shared IPs don't affect others
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => res.status(429).json({
    success: false,
    error:   'RATE_LIMITED',
    message: 'Sending too fast. Please slow down.',
    data:    null,
  }),
});
