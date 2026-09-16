/**
 * JWT authentication middleware.
 *
 * `protect` is the reusable guard: drop it in front of any route that needs a
 * logged-in user and it will
 *
 *   1. require an `Authorization: Bearer <token>` header,
 *   2. verify the token (signature, expiry, issuer),
 *   3. load the matching user from MongoDB,
 *   4. attach it as `req.user`.
 *
 * The user is re-read from the database on every request rather than trusted
 * from the token payload. That costs one indexed lookup and buys two things:
 * a deleted account stops working immediately, and `req.user` is always a real
 * document with the current name/email rather than a stale snapshot.
 */
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { extractBearerToken, verifyToken } from '../utils/jwt.js';

export const protect = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw new AppError(
      'Not authorized — provide a Bearer token in the Authorization header',
      401
    );
  }

  // Throws AppError(401) itself for expired / malformed / bad-signature tokens.
  const payload = verifyToken(token);

  const user = await User.findById(payload.sub);

  if (!user) {
    // Valid signature, but the account it points at no longer exists.
    throw new AppError('The account for this token no longer exists', 401);
  }

  req.user = user;
  return next();
});

/**
 * Optional-auth helper, kept for routes that personalise a response when a
 * token is present but still work without one. Not used by Task 2's routes —
 * it lives here so the pattern is already in place.
 */
export const attachUserIfPresent = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const payload = verifyToken(token);
    req.user = await User.findById(payload.sub);
  } catch {
    // An invalid token on an optional route is simply "not logged in".
    req.user = undefined;
  }

  return next();
});

export default { protect, attachUserIfPresent };
