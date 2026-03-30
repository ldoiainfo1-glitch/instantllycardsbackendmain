import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { body } from 'express-validator';
import {
  listAds,
  getMyCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  trackImpression,
  trackClick,
  getCampaignAnalytics,
  getCampaignVariants,
  listLegacyAds,
  getMyAds,
} from '../controllers/adController';

const router = Router();

// ─── Campaign endpoints (new system) ────────────────────────────────────────

// Public: list active campaigns for delivery
router.get('/campaigns', listAds);

// Authenticated: my campaigns
router.get('/campaigns/my', authenticate, getMyCampaigns);

// Authenticated: single campaign
router.get('/campaigns/:id', authenticate, getCampaign);

// Create campaign
router.post(
  '/campaigns',
  authenticate,
  [
    body('title').isString().notEmpty().withMessage('title is required'),
    body('ad_type').isString().notEmpty().withMessage('ad_type is required'),
    body('daily_budget').optional().isFloat({ min: 100 }),
    body('duration_days').optional().isInt({ min: 1, max: 365 }),
  ],
  createCampaign
);

// Update campaign
router.put('/campaigns/:id', authenticate, updateCampaign);

// Delete campaign
router.delete('/campaigns/:id', authenticate, deleteCampaign);

// Tracking
router.post('/campaigns/:id/impression', trackImpression);
router.post('/campaigns/:id/click', trackClick);

// Analytics
router.get('/campaigns/:id/analytics', authenticate, getCampaignAnalytics);

// Variants
router.get('/campaigns/:id/variants', authenticate, getCampaignVariants);

// ─── Legacy Ad endpoints (backward compat) ──────────────────────────────────
router.get('/', listLegacyAds);
router.get('/my', authenticate, getMyAds);

export default router;
