import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  listCards,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  getMyCards,
  shareCard,
  getSharedCards,
} from '../controllers/businessCardController';

const router = Router();

// Rate limit card creation: 5 per hour per IP (bypass in test)
const cardCreateLimit =
  process.env.NODE_ENV === 'test'
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        message: { error: 'Too many cards created, try again later' },
        standardHeaders: true,
        legacyHeaders: false,
      });

router.get('/', listCards);
router.get('/my', authenticate, getMyCards);
router.get('/shared', authenticate, getSharedCards);
router.get('/:id', getCard);

router.post(
  '/',
  authenticate,
  cardCreateLimit,
  [body('full_name').notEmpty().withMessage('full_name required')],
  validate,
  createCard
);

router.put(
  '/:id',
  authenticate,
  [
    body('full_name').optional().isString().withMessage('full_name must be a string'),
    body('phone').optional().isString().withMessage('phone must be a string'),
    body('email').optional({ values: 'null' }).isEmail().withMessage('Invalid email'),
    body('services').optional().isArray().withMessage('services must be an array'),
    body('personal_country_code').optional().isString().withMessage('personal_country_code must be a string'),
    body('company_country_code').optional().isString().withMessage('company_country_code must be a string'),
  ],
  validate,
  updateCard
);

router.delete('/:id', authenticate, deleteCard);

router.post(
  '/share',
  authenticate,
  [body('card_id').isInt(), body('recipient_user_id').isInt()],
  validate,
  shareCard
);

export default router;
