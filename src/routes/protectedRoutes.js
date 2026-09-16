/**
 * Protected routes.
 *
 * These exist to prove `protect` is a reusable guard rather than something
 * welded to the auth controller: the same middleware that powers GET
 * /api/auth/me also fronts a non-auth resource here.
 *
 *   GET /api/protected/dashboard — requires a valid JWT
 */
import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// Everything below this line requires a valid token.
router.use(protect);

/**
 * GET /api/protected/dashboard
 * A stand-in for any private resource. Confirms who the caller is and echoes
 * their own record only — never a list of other users.
 */
router.get('/dashboard', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'You have reached a protected route',
    data: {
      greeting: `Welcome back, ${req.user.name}`,
      user: req.user,
      accountCreatedAt: req.user.createdAt,
    },
  });
});

export default router;
