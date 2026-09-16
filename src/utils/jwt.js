/**
 * JWT helpers — the only place tokens are signed or verified.
 *
 * Keeping this in one module means the secret, algorithm and expiry are read
 * exactly once, and a misconfigured environment fails loudly at the first
 * use instead of silently issuing weak tokens.
 */
import jwt from 'jsonwebtoken';
import AppError from './AppError.js';

export const TOKEN_ISSUER = 'internify-backend-tasks';

/** Read JWT_SECRET, refusing to run with a missing or trivially weak value. */
const getSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new AppError(
      'JWT_SECRET is not configured. Copy .env.example to .env and set it.',
      500
    );
  }

  if (secret.length < 32) {
    throw new AppError('JWT_SECRET must be at least 32 characters long', 500);
  }

  return secret;
};

/** Token lifetime — overridable so tests can mint an already-expired token. */
export const expiresIn = () => process.env.JWT_EXPIRES_IN || '1h';

/**
 * Sign a token for a user.
 * `sub` carries the user id (the JWT-standard claim for the subject).
 */
export const signToken = (user) =>
  jwt.sign(
    { sub: user.id ?? String(user._id), email: user.email },
    getSecret(),
    { expiresIn: expiresIn(), issuer: TOKEN_ISSUER }
  );

/**
 * Verify a token and return its payload.
 * Every jsonwebtoken failure is translated into a 401 with a message that
 * says what actually went wrong without leaking internals.
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, getSecret(), { issuer: TOKEN_ISSUER });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Token has expired — please log in again', 401);
    }
    if (error.name === 'JsonWebTokenError') {
      throw new AppError('Invalid token — please log in again', 401);
    }
    if (error.name === 'NotBeforeError') {
      throw new AppError('Token is not active yet', 401);
    }
    throw new AppError('Could not verify token', 401);
  }
};

/**
 * Pull a bearer token out of the Authorization header.
 * Returns null when the header is absent or not in `Bearer <token>` form so
 * the caller can raise a single, consistent 401.
 */
export const extractBearerToken = (req) => {
  const header = req.headers.authorization;

  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;

  return token.trim() || null;
};

export default { signToken, verifyToken, extractBearerToken, TOKEN_ISSUER, expiresIn };
