import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listPromotions, getPromotion, createPromotion, updatePromotion,
  getMyPromotions, listPromotionsNearby, listPricingPlans,
  createPromotionPaymentIntent, verifyPromotionPayment, retryPromotionPayment,
} from '../controllers/promotionController';

const router = Router();

router.get('/', listPromotions);
router.get('/nearby', listPromotionsNearby);
router.get('/pricing-plans', listPricingPlans);
router.get('/my', authenticate, getMyPromotions);
router.post('/', authenticate, createPromotion);
router.get('/:id', getPromotion);
router.put('/:id', authenticate, updatePromotion);
router.post('/:id/payment-intent', authenticate, createPromotionPaymentIntent);
router.post('/:id/verify-payment', authenticate, verifyPromotionPayment);
router.post('/:id/retry-payment', authenticate, retryPromotionPayment);

export default router;
