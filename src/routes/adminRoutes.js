/**
 * Admin routes — user management.
 *
 * The whole router sits behind `protect` + `restrictTo(ROLES.ADMIN)`. Mounting
 * the guards once here rather than per-route means a new endpoint added below
 * is admin-only by default: forgetting to add a guard makes a route stricter
 * than intended, not more open, which is the safe direction to fail.
 */
import { Router } from 'express';
import {
  listUsers,
  getUserById,
  updateUserRole,
  deleteUser,
} from '../controllers/adminController.js';
import { protect } from '../middleware/authMiddleware.js';
import { restrictTo } from '../middleware/roleMiddleware.js';
import { validateObjectId } from '../middleware/validateBook.js';
import { ROLES } from '../models/User.js';

const router = Router();

// Every route below this line requires a valid token AND the admin role.
router.use(protect, restrictTo(ROLES.ADMIN));

router
  .route('/users')
  .get(listUsers); //                    GET    /api/admin/users

router
  .route('/users/:id')
  .get(validateObjectId, getUserById) //  GET    /api/admin/users/:id
  .delete(validateObjectId, deleteUser); // DELETE /api/admin/users/:id

router
  .route('/users/:id/role')
  .patch(validateObjectId, updateUserRole); // PATCH /api/admin/users/:id/role

export default router;
