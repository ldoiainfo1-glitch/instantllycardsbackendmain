"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const requireFeature_1 = require("../middleware/requireFeature");
const voucherController_1 = require("../controllers/voucherController");
const router = (0, express_1.Router)();
router.get('/', voucherController_1.listVouchers);
router.get('/my', auth_1.authenticate, voucherController_1.getMyVouchers);
router.get('/created', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), voucherController_1.getMyCreatedVouchers);
router.get('/transfers', auth_1.authenticate, voucherController_1.getMyTransfers);
router.get('/:id', voucherController_1.getVoucher);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), (0, requireFeature_1.requireFeature)('voucher', {
    requirePromotionId: true,
    promotionIdSource: 'body',
    promotionIdField: 'business_promotion_id',
}), [
    (0, express_validator_1.body)('business_promotion_id').isInt(),
    (0, express_validator_1.body)('title').notEmpty(),
    (0, express_validator_1.body)('discount_value').notEmpty(),
], validate_1.validate, voucherController_1.createVoucher);
router.post('/:id/claim', auth_1.authenticate, voucherController_1.claimVoucher);
router.patch('/:id/status', auth_1.authenticate, [(0, express_validator_1.body)('status').notEmpty()], validate_1.validate, voucherController_1.updateVoucherStatus);
router.post('/redeem', auth_1.authenticate, [(0, express_validator_1.body)('voucher_id').isInt()], validate_1.validate, voucherController_1.redeemVoucher);
router.post('/transfer', auth_1.authenticate, [(0, express_validator_1.body)('voucher_id').isInt(), (0, express_validator_1.body)('recipient_phone').notEmpty()], validate_1.validate, voucherController_1.transferVoucher);
exports.default = router;
//# sourceMappingURL=vouchers.js.map