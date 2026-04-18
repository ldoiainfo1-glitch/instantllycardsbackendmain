"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const voucherController_1 = require("../controllers/voucherController");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.get('/', h(voucherController_1.listVouchers));
router.get('/my', auth_1.authenticate, h(voucherController_1.getMyVouchers));
router.get('/created', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), h(voucherController_1.getMyCreatedVouchers));
router.get('/transfers', auth_1.authenticate, h(voucherController_1.getMyTransfers));
router.get('/:id', h(voucherController_1.getVoucher));
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), [
    (0, express_validator_1.body)('business_id').isInt(),
    (0, express_validator_1.body)('title').notEmpty(),
    (0, express_validator_1.body)('discount_value').notEmpty(),
], validate_1.validate, h(voucherController_1.createVoucher));
router.post('/:id/claim', auth_1.authenticate, h(voucherController_1.claimVoucher));
router.post('/transfer', auth_1.authenticate, [(0, express_validator_1.body)('voucher_id').isInt(), (0, express_validator_1.body)('recipient_phone').notEmpty()], validate_1.validate, h(voucherController_1.transferVoucher));
exports.default = router;
//# sourceMappingURL=vouchers.js.map