import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { getCardReviews, createReview, createFeedback } from '../controllers/reviewController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/card/:cardId', h(getCardReviews));
router.post(
  '/',
  authenticate,
  [body('business_id').isInt(), body('rating').isInt({ min: 1, max: 5 })],
  validate,
  h(createReview)
);
router.post('/feedback', authenticate, [body('message').notEmpty()], validate, h(createFeedback));

export default router;
