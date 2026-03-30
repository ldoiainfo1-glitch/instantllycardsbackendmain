"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const promotionController_1 = require("../controllers/promotionController");
const router = (0, express_1.Router)();
router.get('/', promotionController_1.listPromotions);
router.get('/nearby', promotionController_1.listPromotionsNearby);
router.get('/my', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), promotionController_1.getMyPromotions);
router.get('/:id', promotionController_1.getPromotion);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), promotionController_1.createPromotion);
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), promotionController_1.updatePromotion);
exports.default = router;
//# sourceMappingURL=promotions.js.map