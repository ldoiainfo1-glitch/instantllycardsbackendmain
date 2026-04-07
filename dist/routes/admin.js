"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const adminController_1 = require("../controllers/adminController");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireRole)('admin'));
router.get('/dashboard', adminController_1.getDashboardCounts);
router.get('/users', adminController_1.listUsers);
// Promotions
router.get('/promotions/pending', adminController_1.getPendingPromotions);
router.post('/promotions/:id/approve', adminController_1.approvePromotion);
router.post('/promotions/:id/reject', adminController_1.rejectPromotion);
// Listings
router.get('/businesses', adminController_1.listBusinesses);
router.post('/businesses/:id/approve', adminController_1.approveBusinessCard);
router.post('/businesses/:id/reject', adminController_1.rejectBusinessCard);
router.get('/events', adminController_1.listEvents);
router.get('/vouchers', adminController_1.listVouchers);
router.get('/reviews', adminController_1.listReviews);
// Ad campaigns
router.get('/ads', adminController_1.listAdCampaigns);
router.get('/ads/:id', async (req, res) => {
    const { getAdCampaignDetails } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return getAdCampaignDetails(req, res);
});
router.post('/ads/:id/approve', adminController_1.approveAdCampaign);
router.post('/ads/:id/reject', adminController_1.rejectAdCampaign);
router.post('/ads/:id/pause', async (req, res) => {
    const { pauseAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return pauseAdCampaign(req, res);
});
router.post('/ads/:id/resume', async (req, res) => {
    const { resumeAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return resumeAdCampaign(req, res);
});
router.post('/ads/:id/delete', async (req, res) => {
    const { deleteAdCampaign } = await Promise.resolve().then(() => __importStar(require('../controllers/adminController')));
    return deleteAdCampaign(req, res);
});
exports.default = router;
//# sourceMappingURL=admin.js.map