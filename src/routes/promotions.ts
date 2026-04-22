import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listPromotions, getPromotion, createPromotion, updatePromotion,
  deletePromotion,
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
router.delete('/:id', authenticate, deletePromotion);
router.post('/:id/payment-intent', authenticate, createPromotionPaymentIntent);
router.post('/:id/verify-payment', authenticate, verifyPromotionPayment);
router.post('/:id/retry-payment', authenticate, retryPromotionPayment);

export default router;
