/**
 * Role-based access control middleware.
 *
 * Two guards, both designed to sit AFTER `protect` so `req.user` already exists:
 *
 *   restrictTo(...roles)  — gate a whole route by role
 *   requireOwnership()    — allow the owner or an admin, nobody else
 *
 * Both throw AppError(403) rather than 401: the caller IS authenticated, they
 * simply are not allowed. Conflating the two would tell a logged-in user to
 * "log in again" when the real answer is "this is not yours".
 *
 * Design notes:
 *  - `restrictTo` takes roles as arguments and returns a middleware, so routes
 *    read as intent: `restrictTo(ROLES.ADMIN)`.
 *  - The role is read from `req.user` — the document the `protect` middleware
 *    just loaded from MongoDB — never from the JWT payload. A token minted
 *    before a demotion carries the old claim, and trusting it would let a
 *    demoted admin keep admin access for the life of that token.
 */
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ROLES } from '../models/User.js';

/**
 * Allow only the listed roles through.
 *
 *   router.get('/admin/users', protect, restrictTo(ROLES.ADMIN), listUsers)
 */
export const restrictTo = (...roles) => (req, _res, next) => {
  if (!req.user) {
    // Programming error: this guard was mounted without `protect` in front.
    return next(
      new AppError('restrictTo requires the protect middleware to run first', 500)
    );
  }

  if (!roles.includes(req.user.role)) {
    return next(
      new AppError(
        `Access denied — this route requires one of: ${roles.join(', ')}`,
        403
      )
    );
  }

  return next();
};

/**
 * Allow the request only if the caller owns the loaded document, or is an admin.
 *
 * Expects the target document on `req.resource`. `loadResource` below is the
 * usual way to put it there.
 */
export const requireOwnership = () => (req, _res, next) => {
  const resource = req.resource;

  if (!resource) {
    return next(
      new AppError('requireOwnership requires a loaded resource', 500)
    );
  }

  if (!resource.isOwnedBy?.(req.user)) {
    return next(
      new AppError('Access denied — you can only modify your own records', 403)
    );
  }

  return next();
};

/**
 * Load a document by `req.params.id` and stash it on `req.resource`.
 *
 * Sits between the id guard and the controller so ownership can be checked
 * against a real document. Returning 404 for a missing record keeps a
 * non-existent id indistinguishable from one the caller cannot see, which
 * avoids leaking whether a given id exists.
 *
 * @param {import('mongoose').Model} Model
 * @param {string} label  human-readable resource name for messages
 */
export const loadResource = (Model, label) =>
  asyncHandler(async (req, _res, next) => {
    const resource = await Model.findById(req.params.id);

    if (!resource) {
      throw new AppError(`No ${label} found with id ${req.params.id}`, 404);
    }

    req.resource = resource;
    return next();
  });

/**
 * Convenience guard for the "admin, or the owner of this document" rule, used
 * where a route allows self-service edits (e.g. a user updating their own
 * profile) alongside admin override.
 */
export const requireAdminOrSelf = () => (req, _res, next) => {
  const targetId = req.params.id;
  const isSelf = String(req.user?.id ?? req.user?._id) === String(targetId);

  if (!req.user?.isAdmin?.() && !isSelf) {
    return next(
      new AppError('Access denied — you can only modify your own account', 403)
    );
  }

  return next();
};

export default { restrictTo, requireOwnership, loadResource, requireAdminOrSelf };
