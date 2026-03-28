import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { getCardReviews, createReview, createFeedback } from '../controllers/reviewController';

const router = Router();

router.get('/card/:cardId', getCardReviews);
router.post(
  '/',
  authenticate,
  [body('business_id').isInt(), body('rating').isInt({ min: 1, max: 5 })],
  validate,
  createReview
);
router.post('/feedback', authenticate, [body('message').notEmpty()], validate, createFeedback);

export default router;
