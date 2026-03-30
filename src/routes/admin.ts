import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getDashboardCounts,
  getPendingPromotions,
  approvePromotion,
  rejectPromotion,
  listUsers,
  listAdCampaigns,
  approveAdCampaign,
  rejectAdCampaign,
  listBusinesses,
  approveBusinessCard,
  rejectBusinessCard,
  listEvents,
  listVouchers,
  listReviews,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/dashboard', getDashboardCounts);
router.get('/users', listUsers);

// Promotions
router.get('/promotions/pending', getPendingPromotions);
router.post('/promotions/:id/approve', approvePromotion);
router.post('/promotions/:id/reject', rejectPromotion);

// Listings
router.get('/businesses', listBusinesses);
router.post('/businesses/:id/approve', approveBusinessCard);
router.post('/businesses/:id/reject', rejectBusinessCard);
router.get('/events', listEvents);
router.get('/vouchers', listVouchers);
router.get('/reviews', listReviews);

// Ad campaigns
router.get('/ads', listAdCampaigns);
router.post('/ads/:id/approve', approveAdCampaign);
router.post('/ads/:id/reject', rejectAdCampaign);

export default router;
