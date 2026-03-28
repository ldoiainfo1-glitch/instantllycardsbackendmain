import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getDashboardCounts,
  getPendingPromotions,
  approvePromotion,
  rejectPromotion,
  listUsers,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/dashboard', getDashboardCounts);
router.get('/users', listUsers);
router.get('/promotions/pending', getPendingPromotions);
router.post('/promotions/:id/approve', approvePromotion);
router.post('/promotions/:id/reject', rejectPromotion);

export default router;
