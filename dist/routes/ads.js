"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const requireFeature_1 = require("../middleware/requireFeature");
const express_validator_1 = require("express-validator");
const adController_1 = require("../controllers/adController");
const router = (0, express_1.Router)();
// ─── Campaign endpoints (new system) ────────────────────────────────────────
// Public: list active campaigns for delivery
router.get('/campaigns', adController_1.listAds);
// Authenticated: my campaigns (basic_ads or ads feature required)
router.get('/campaigns/my', auth_1.authenticate, (0, requireFeature_1.requireFeature)('basic_ads'), adController_1.getMyCampaigns);
// Authenticated: single campaign
router.get('/campaigns/:id', auth_1.authenticate, adController_1.getCampaign);
// Create campaign (requires 'ads' feature — boost+ tier)
router.post('/campaigns', auth_1.authenticate, (0, requireFeature_1.requireFeature)('ads', {
    requirePromotionId: true,
    promotionIdSource: 'body',
    promotionIdField: 'promotion_id',
}), [
    (0, express_validator_1.body)('title').isString().notEmpty().withMessage('title is required'),
    (0, express_validator_1.body)('ad_type').isString().notEmpty().withMessage('ad_type is required'),
    (0, express_validator_1.body)('promotion_id').isInt({ min: 1 }).withMessage('promotion_id is required'),
    (0, express_validator_1.body)('daily_budget').optional().isFloat({ min: 100 }),
    (0, express_validator_1.body)('duration_days').optional().isInt({ min: 1, max: 365 }),
], adController_1.createCampaign);
// Update campaign
router.put('/campaigns/:id', auth_1.authenticate, adController_1.updateCampaign);
// Delete campaign
router.delete('/campaigns/:id', auth_1.authenticate, adController_1.deleteCampaign);
// Tracking (public — no feature gate)
router.post('/campaigns/:id/impression', adController_1.trackImpression);
router.post('/campaigns/:id/click', adController_1.trackClick);
// Analytics (requires 'analytics' feature — growth+ tier)
router.get('/campaigns/:id/analytics', auth_1.authenticate, (0, requireFeature_1.requireFeature)('analytics'), adController_1.getCampaignAnalytics);
// Variants
router.get('/campaigns/:id/variants', auth_1.authenticate, adController_1.getCampaignVariants);
// ─── Legacy Ad endpoints (backward compat) ──────────────────────────────────
router.get('/', adController_1.listLegacyAds);
router.get('/my', auth_1.authenticate, adController_1.getMyAds);
exports.default = router;
//# sourceMappingURL=ads.js.map