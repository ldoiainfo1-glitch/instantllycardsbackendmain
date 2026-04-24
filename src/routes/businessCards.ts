import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { FEATURES } from '../utils/featureFlags';
import {
  listCards,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  getMyCards,
  shareCard,
  getSharedCards,
  bulkSendCard,
} from '../controllers/businessCardController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

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

router.get('/', h(listCards));
router.get('/my', authenticate, h(getMyCards));
router.get('/shared', authenticate, h(getSharedCards));
router.get('/:id', h(getCard));

router.post(
  '/',
  authenticate,
  cardCreateLimit,
  [body('full_name').notEmpty().withMessage('full_name required')],
  validate,
  h(createCard)
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
  h(updateCard)
);

router.delete('/:id', authenticate, h(deleteCard));

router.post(
  '/share',
  authenticate,
  [body('card_id').isInt(), body('recipient_user_id').isInt()],
  validate,
  h(shareCard)
);

const bulkSendLimit =
  process.env.NODE_ENV === 'test'
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 10,
        message: { error: 'Too many bulk sends, try again later' },
        standardHeaders: true,
        legacyHeaders: false,
      });

if (FEATURES.BULK_SEND) {
  router.post(
    '/bulk-send',
    authenticate,
    bulkSendLimit,
    [
      body('card_id').isInt().withMessage('card_id must be an integer'),
      body('audience').notEmpty().withMessage('audience is required'),
      body('audience_type').isIn(['category', 'subcategory']).withMessage('Invalid audience_type'),
      body('level').isIn(['zone', 'state', 'division', 'pincode', 'village']).withMessage('Invalid level'),
    ],
    validate,
    h(bulkSendCard)
  );
}

export default router;
