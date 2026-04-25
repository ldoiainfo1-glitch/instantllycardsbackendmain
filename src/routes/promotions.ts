import { Router, RequestHandler } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listPromotions, getPromotion, createPromotion, updatePromotion,
  deletePromotion,
  getMyPromotions, listPromotionsNearby, listPricingPlans,
  createPromotionPaymentIntent, verifyPromotionPayment, retryPromotionPayment,
} from '../controllers/promotionController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/', h(listPromotions));
router.get('/nearby', h(listPromotionsNearby));
router.get('/pricing-plans', h(listPricingPlans));
router.get('/my', authenticate, h(getMyPromotions));
router.post('/', authenticate, h(createPromotion));
router.get('/:id', h(getPromotion));
router.put('/:id', authenticate, h(updatePromotion));
router.delete('/:id', authenticate, h(deletePromotion));
router.post('/:id/payment-intent', authenticate, h(createPromotionPaymentIntent));
router.post('/:id/verify-payment', authenticate, h(verifyPromotionPayment));
router.post('/:id/retry-payment', authenticate, h(retryPromotionPayment));

export default router;
