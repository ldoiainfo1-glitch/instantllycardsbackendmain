import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { signup, login, refresh, logout, me, changePassword } from '../controllers/authController';

const router = Router();

// Strict rate limit for credential endpoints: 10 attempts per 15 minutes per IP.
// Disabled in test environment to allow integration tests to run without hitting the limit.
const authRateLimit =
  process.env.NODE_ENV === 'test'
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: { error: 'Too many attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
      });

router.post(
  '/signup',
  authRateLimit,
  [
    body('phone').notEmpty().withMessage('Phone is required'),
    body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
    body('role').optional().isIn(['customer', 'business']).withMessage('Role must be customer or business'),
  ],
  validate,
  signup
);

router.post(
  '/login',
  authRateLimit,
  [
    body().custom((_, { req }) => {
      if (!req.body.phone && !req.body.email) throw new Error('phone or email required');
      return true;
    }),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  login
);

router.post('/refresh', authRateLimit, refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  validate,
  changePassword
);

export default router;
