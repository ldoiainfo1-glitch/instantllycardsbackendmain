"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const bookingController_1 = require("../controllers/bookingController");
const router = (0, express_1.Router)();
router.get('/my', auth_1.authenticate, bookingController_1.listMyBookings);
router.get('/business/:businessId', auth_1.authenticate, bookingController_1.listBusinessBookings);
router.get('/promotion/:promotionId', auth_1.authenticate, bookingController_1.listPromotionBookings);
router.get('/:id', auth_1.authenticate, bookingController_1.getBooking);
router.post('/', auth_1.authenticate, [
    (0, express_validator_1.body)('business_id').optional().isInt(),
    (0, express_validator_1.body)('business_promotion_id').optional().isInt(),
    (0, express_validator_1.body)('customer_name').notEmpty(),
    (0, express_validator_1.body)('customer_phone').notEmpty(),
], validate_1.validate, bookingController_1.createBooking);
router.patch('/:id/status', auth_1.authenticate, [(0, express_validator_1.body)('status').notEmpty()], validate_1.validate, bookingController_1.updateBookingStatus);
exports.default = router;
//# sourceMappingURL=bookings.js.map