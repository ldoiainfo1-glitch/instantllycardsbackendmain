import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { listPromotions, getPromotion, createPromotion, updatePromotion, getMyPromotions, listPromotionsNearby } from '../controllers/promotionController';

const router = Router();

router.get('/', listPromotions);
router.get('/nearby', listPromotionsNearby);
router.get('/my', authenticate, requireRole('business', 'admin'), getMyPromotions);
router.get('/:id', getPromotion);
router.post('/', authenticate, requireRole('business', 'admin'), createPromotion);
router.put('/:id', authenticate, requireRole('business', 'admin'), updatePromotion);

export default router;
