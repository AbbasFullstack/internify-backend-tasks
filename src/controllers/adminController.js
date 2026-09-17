/**
 * Admin controllers — user management.
 *
 * Every route here is mounted behind `protect` + `restrictTo(ROLES.ADMIN)`, so
 * these handlers can assume an authenticated administrator. They still guard
 * against the two mistakes an admin can make about themselves, because a
 * mistake that locks the only admin out of their own account is unrecoverable
 * without direct database access.
 */
import User, { ROLES, ROLE_VALUES } from '../models/User.js';
import Book from '../models/Book.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

/** Uniform success envelope so clients parse one shape everywhere. */
const ok = (res, statusCode, data, message) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * GET /api/admin/users
 * Paginated list of all accounts. Never exposes the password hash — the schema's
 * toJSON transform strips it — and supports the same ?search= shape as books.
 */
export const listUsers = asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 10 } = req.query;

  const filter = {};
  if (role) {
    if (!ROLE_VALUES.includes(role)) {
      throw new AppError(`Role must be one of: ${ROLE_VALUES.join(', ')}`, 400);
    }
    filter.role = role;
  }
  if (search && String(search).trim()) {
    const term = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [{ name: term }, { email: term }];
  }

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort('-createdAt')
      .skip((pageNum - 1) * perPage)
      .limit(perPage),
    User.countDocuments(filter),
  ]);

  const pages = Math.ceil(total / perPage) || 1;

  return res.status(200).json({
    success: true,
    message: 'Users fetched successfully',
    count: users.length,
    total,
    page: pageNum,
    pages,
    hasNextPage: pageNum < pages,
    hasPrevPage: pageNum > 1,
    limit: perPage,
    data: users,
  });
});

/**
 * GET /api/admin/users/:id
 * One account, including a count of how many books they own.
 */
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new AppError(`No user found with id ${req.params.id}`, 404);
  }

  const bookCount = await Book.countDocuments({ createdBy: user.id });

  return ok(res, 200, { ...user.toJSON(), bookCount }, 'User fetched successfully');
});

/**
 * PATCH /api/admin/users/:id/role
 * Promote or demote an account.
 *
 * Self-demotion is refused: an admin who demotes themselves loses access to
 * this very endpoint, and if they are the only admin nobody can undo it. Adding
 * a second admin first is the safe path, and the error says so.
 */
export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!role || !ROLE_VALUES.includes(role)) {
    throw new AppError(
      `Role is required and must be one of: ${ROLE_VALUES.join(', ')}`,
      400
    );
  }

  const isSelf = String(req.user.id) === String(req.params.id);
  if (isSelf && role !== ROLES.ADMIN) {
    throw new AppError(
      'You cannot remove your own admin role — promote another admin first',
      400
    );
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError(`No user found with id ${req.params.id}`, 404);
  }

  if (user.role === role) {
    return ok(res, 200, user, `User is already a ${role}`);
  }

  user.role = role;
  await user.save();

  return ok(res, 200, user, `User role updated to ${role}`);
});

/**
 * DELETE /api/admin/users/:id
 * Remove an account. Also refuses self-deletion, and reports how many books the
 * account owned so the caller can see what is being orphaned.
 *
 * The books are intentionally left in place. Cascading the delete would silently
 * destroy data that other admins may still need, and ownership on a book whose
 * owner is gone is still meaningful.
 */
export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError(`No user found with id ${req.params.id}`, 404);
  }

  const bookCount = await Book.countDocuments({ createdBy: user.id });

  await user.deleteOne();

  return ok(
    res,
    200,
    { ...user.toJSON(), booksLeftBehind: bookCount },
    'User deleted successfully'
  );
});

/** Escape a user-supplied string before it reaches a RegExp. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
