"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const adminController_1 = require("../controllers/adminController");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireRole)('admin'));
router.get('/dashboard', adminController_1.getDashboardCounts);
router.get('/users', adminController_1.listUsers);
router.get('/promotions/pending', adminController_1.getPendingPromotions);
router.post('/promotions/:id/approve', adminController_1.approvePromotion);
router.post('/promotions/:id/reject', adminController_1.rejectPromotion);
exports.default = router;
//# sourceMappingURL=admin.js.map