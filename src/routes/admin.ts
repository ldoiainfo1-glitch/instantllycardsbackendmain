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
router.get('/ads/:id', async (req, res) => {
  const { getAdCampaignDetails } = await import('../controllers/adminController');
  return getAdCampaignDetails(req, res);
});
router.post('/ads/:id/approve', approveAdCampaign);
router.post('/ads/:id/reject', rejectAdCampaign);
router.post('/ads/:id/pause', async (req, res) => {
  const { pauseAdCampaign } = await import('../controllers/adminController');
  return pauseAdCampaign(req, res);
});
router.post('/ads/:id/resume', async (req, res) => {
  const { resumeAdCampaign } = await import('../controllers/adminController');
  return resumeAdCampaign(req, res);
});
router.post('/ads/:id/delete', async (req, res) => {
  const { deleteAdCampaign } = await import('../controllers/adminController');
  return deleteAdCampaign(req, res);
});

export default router;
