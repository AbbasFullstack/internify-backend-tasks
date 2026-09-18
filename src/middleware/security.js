/**
 * Security headers and rate limiting.
 *
 * Kept in one file so the policy is reviewable at a glance rather than spread
 * across app.js.
 */
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

/**
 * Helmet.
 *
 * One deviation from the defaults, and it is deliberate: the cross-origin
 * resource policy is relaxed to `cross-origin` so an image served from
 * `/uploads/...` can be embedded by a separate front-end origin. Without it the
 * browser blocks every uploaded image as soon as the client is not same-origin.
 *
 * `contentSecurityPolicy` is disabled because this service returns JSON and
 * uploaded files, never HTML pages — a CSP here would only add noise.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/** Shared shape for limit responses, matching the app's error envelope. */
const limitHandler = (message) => (req, res) => {
  res.status(429).json({ success: false, statusCode: 429, message });
};

/**
 * Global limiter — a coarse ceiling on everything.
 *
 * Skipped under test: the suites fire well over a hundred requests in a few
 * seconds and would otherwise trip the limit and fail for the wrong reason.
 */
export const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: limitHandler(
    'Too many requests from this IP. Please try again in a few minutes.'
  ),
});

/**
 * Auth limiter — much tighter, and it counts only FAILED attempts.
 *
 * A legitimate login does not consume the budget, so normal use never locks
 * anyone out; a password-guessing loop burns through it in seconds.
 */
export const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => isTest,
  handler: limitHandler(
    'Too many failed authentication attempts. Please try again later.'
  ),
});

/**
 * Write limiter — for endpoints that spend a resource: posting a blog, which
 * also sends an email. Tighter than global, looser than auth, and it does NOT
 * skip successful requests, because the cost is incurred on success.
 */
export const writeLimiter = rateLimit({
  windowMs: Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
  limit: Number(process.env.WRITE_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  handler: limitHandler(
    'You are creating posts too quickly. Please wait a moment and try again.'
  ),
});

export default { securityHeaders, globalLimiter, authLimiter, writeLimiter };
