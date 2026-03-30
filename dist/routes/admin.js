"use strict";
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
router.post('/ads/:id/approve', adminController_1.approveAdCampaign);
router.post('/ads/:id/reject', adminController_1.rejectAdCampaign);
exports.default = router;
//# sourceMappingURL=admin.js.map