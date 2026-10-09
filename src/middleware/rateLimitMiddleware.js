'use strict';

const rateLimit = require('express-rate-limit');

// All thresholds and window durations are configurable via environment
// variables so that tests can use low limits to verify 429 responses.
const windowMs       = parseInt(process.env.RATE_LIMIT_WINDOW_MS,       10) || 15 * 60 * 1000; // 15 min
const maxTracking    = parseInt(process.env.RATE_LIMIT_MAX_TRACKING,    10) || 30;
const maxLogin       = parseInt(process.env.RATE_LIMIT_MAX_LOGIN,       10) || 5;
const maxSubmissions = parseInt(process.env.RATE_LIMIT_MAX_SUBMISSIONS, 10) || 50;

/** Standard JSON response for rate-limited requests */
function rateLimitHandler(req, res) {
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
  });
}

/** Rate limiter for GET /api/reports/:caseCode (case tracking) */
const trackingLimiter = rateLimit({
  windowMs,
  max: maxTracking,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Rate limiter for POST /api/moderator/login */
const loginLimiter = rateLimit({
  windowMs,
  max: maxLogin,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/**
 * Rate limiter for POST /api/reports (anonymous submissions).
 * Default: 50 submissions per window (RATE_LIMIT_WINDOW_MS).
 * Tests override RATE_LIMIT_MAX_SUBMISSIONS with a low value.
 */
const submissionLimiter = rateLimit({
  windowMs,
  max: maxSubmissions,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

module.exports = { trackingLimiter, loginLimiter, submissionLimiter };
