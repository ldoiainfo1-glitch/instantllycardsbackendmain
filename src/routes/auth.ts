import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  signup,
  login,
  refresh,
  logout,
  me,
  changePassword,
  sendPasswordResetOTP,
  verifyPasswordResetOTP,
  resetPassword
} from '../controllers/authController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

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
  h(signup)
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
    body('loginType').optional().isIn(['customer', 'business']).withMessage('loginType must be customer or business'),
  ],
  validate,
  h(login)
);

router.post('/refresh', authRateLimit, h(refresh));
router.post('/logout', authenticate, h(logout));
router.get('/me', authenticate, h(me));
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  validate,
  h(changePassword)
);

router.post(
  '/forgot-password/send-otp',
  authRateLimit,
  [
    body('phone').notEmpty().withMessage('Phone number is required'),
  ],
  validate,
  h(sendPasswordResetOTP)
);

router.post(
  '/forgot-password/verify-otp',
  authRateLimit,
  [
    body('phone').notEmpty().withMessage('Phone number is required'),
    body('otp').notEmpty().withMessage('OTP is required'),
  ],
  validate,
  h(verifyPasswordResetOTP)
);

router.post(
  '/forgot-password/reset-password',
  authRateLimit,
  [
    body('phone').notEmpty().withMessage('Phone number is required'),
    body('otp').notEmpty().withMessage('OTP is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  validate,
  h(resetPassword)
);

export default router;
