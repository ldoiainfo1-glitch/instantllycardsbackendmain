import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { signup, login, refresh, logout, me } from '../controllers/authController';

const router = Router();

router.post(
  '/signup',
  [
    body('phone').notEmpty().withMessage('Phone is required'),
    body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
  ],
  validate,
  signup
);

router.post(
  '/login',
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

router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

export default router;
