/**
 * Auth routes.
 *
 * Validation runs before the controller, exactly as the Books routes do:
 *   POST /api/auth/signup   — public
 *   POST /api/auth/login    — public
 *   GET  /api/auth/me       — protected by `protect`
 */
import { Router } from 'express';
import { signup, login, getMe } from '../controllers/authController.js';
import { validateSignup, validateLogin } from '../middleware/validateAuth.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/signup', validateSignup, signup);
router.post('/login', validateLogin, login);
router.get('/me', protect, getMe);

export default router;
