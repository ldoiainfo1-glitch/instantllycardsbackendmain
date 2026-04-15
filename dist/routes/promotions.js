"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const promotionController_1 = require("../controllers/promotionController");
const router = (0, express_1.Router)();
router.get('/', promotionController_1.listPromotions);
router.get('/nearby', promotionController_1.listPromotionsNearby);
router.get('/pricing-plans', promotionController_1.listPricingPlans);
router.get('/my', auth_1.authenticate, promotionController_1.getMyPromotions);
router.post('/', auth_1.authenticate, promotionController_1.createPromotion);
router.get('/:id', promotionController_1.getPromotion);
router.put('/:id', auth_1.authenticate, promotionController_1.updatePromotion);
router.post('/:id/payment-intent', auth_1.authenticate, promotionController_1.createPromotionPaymentIntent);
router.post('/:id/verify-payment', auth_1.authenticate, promotionController_1.verifyPromotionPayment);
router.post('/:id/retry-payment', auth_1.authenticate, promotionController_1.retryPromotionPayment);
exports.default = router;
//# sourceMappingURL=promotions.js.map