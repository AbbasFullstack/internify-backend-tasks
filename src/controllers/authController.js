/**
 * Auth controllers — signup, login and "who am I".
 *
 * Every handler is wrapped in asyncHandler so a rejected promise reaches the
 * central error middleware, and failures throw AppError rather than responding
 * directly, keeping one response shape across the whole API.
 *
 * Security notes worth stating out loud:
 *  - Login returns the SAME message whether the email is unknown or the
 *    password is wrong. Distinguishing them would let an attacker enumerate
 *    which emails are registered.
 *  - The user is serialised through the schema's toJSON transform, which strips
 *    the password hash. No controller ever hand-picks fields from a user doc.
 */
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { signToken } from '../utils/jwt.js';

/** Uniform success envelope so clients parse one shape everywhere. */
const ok = (res, statusCode, data, message) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * POST /api/auth/signup
 * Register a new user. Body already validated and normalised by validateSignup.
 */
export const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Explicit pre-check so the common case returns a friendly 409. The unique
  // index is still the real guard — two simultaneous signups can both pass this
  // check, and the losing one is caught by the error handler's 11000 branch.
  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError('A user with that email already exists', 409);
  }

  const user = await User.create({ name, email, password });

  return ok(
    res,
    201,
    { user, token: signToken(user) },
    'Account created successfully'
  );
});

/**
 * POST /api/auth/login
 * Validate credentials and issue a token.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // `password` is `select: false` on the schema, so it must be asked for.
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid email or password', 401);
  }

  // toJSON transform removes the hash from this copy of the document.
  return ok(res, 200, { user, token: signToken(user) }, 'Logged in successfully');
});

/**
 * GET /api/auth/me
 * Return the authenticated user's own record.
 * `req.user` is set by the protect middleware after a token check.
 */
export const getMe = asyncHandler(async (req, res) => {
  return ok(res, 200, req.user, 'Current user fetched successfully');
});

export default { signup, login, getMe };
