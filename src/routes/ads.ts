import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
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
const h = (fn: Function) => fn as RequestHandler;

router.get('/campaigns', h(listAds));
router.get('/campaigns/my', authenticate, requireFeature('basic_ads'), h(getMyCampaigns));
router.get('/campaigns/:id', authenticate, h(getCampaign));
router.post(
  '/campaigns',
  authenticate,
  requireFeature('ads'),
  [
    body('title').isString().notEmpty().withMessage('title is required'),
    body('ad_type').isString().notEmpty().withMessage('ad_type is required'),
    body('daily_budget').optional().isFloat({ min: 100 }),
    body('duration_days').optional().isInt({ min: 1, max: 365 }),
  ],
  h(createCampaign)
);
router.put('/campaigns/:id', authenticate, h(updateCampaign));
router.delete('/campaigns/:id', authenticate, h(deleteCampaign));
router.post('/campaigns/:id/impression', h(trackImpression));
router.post('/campaigns/:id/click', h(trackClick));
router.get('/campaigns/:id/analytics', authenticate, requireFeature('analytics'), h(getCampaignAnalytics));
router.get('/campaigns/:id/variants', authenticate, h(getCampaignVariants));
router.get('/', h(listLegacyAds));
router.get('/my', authenticate, h(getMyAds));

export default router;
