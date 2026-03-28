import { Router } from 'express';
import { body } from 'express-validator';
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

router.get('/', listCards);
router.get('/my', authenticate, getMyCards);
router.get('/shared', authenticate, getSharedCards);
router.get('/:id', getCard);

router.post(
  '/',
  authenticate,
  [body('full_name').notEmpty().withMessage('full_name required')],
  validate,
  createCard
);
router.put('/:id', authenticate, updateCard);
router.delete('/:id', authenticate, deleteCard);

router.post(
  '/share',
  authenticate,
  [body('card_id').isInt(), body('recipient_user_id').isInt()],
  validate,
  shareCard
);

export default router;
