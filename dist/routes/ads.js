"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const requireFeature_1 = require("../middleware/requireFeature");
const express_validator_1 = require("express-validator");
const adController_1 = require("../controllers/adController");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.get('/campaigns', h(adController_1.listAds));
router.get('/campaigns/my', auth_1.authenticate, (0, requireFeature_1.requireFeature)('basic_ads'), h(adController_1.getMyCampaigns));
router.get('/campaigns/:id', auth_1.authenticate, h(adController_1.getCampaign));
router.post('/campaigns', auth_1.authenticate, (0, requireFeature_1.requireFeature)('ads'), [
    (0, express_validator_1.body)('title').isString().notEmpty().withMessage('title is required'),
    (0, express_validator_1.body)('ad_type').isString().notEmpty().withMessage('ad_type is required'),
    (0, express_validator_1.body)('daily_budget').optional().isFloat({ min: 100 }),
    (0, express_validator_1.body)('duration_days').optional().isInt({ min: 1, max: 365 }),
], h(adController_1.createCampaign));
router.put('/campaigns/:id', auth_1.authenticate, h(adController_1.updateCampaign));
router.delete('/campaigns/:id', auth_1.authenticate, h(adController_1.deleteCampaign));
router.post('/campaigns/:id/impression', h(adController_1.trackImpression));
router.post('/campaigns/:id/click', h(adController_1.trackClick));
router.get('/campaigns/:id/analytics', auth_1.authenticate, (0, requireFeature_1.requireFeature)('analytics'), h(adController_1.getCampaignAnalytics));
router.get('/campaigns/:id/variants', auth_1.authenticate, h(adController_1.getCampaignVariants));
router.get('/', h(adController_1.listLegacyAds));
router.get('/my', auth_1.authenticate, h(adController_1.getMyAds));
exports.default = router;
//# sourceMappingURL=ads.js.map