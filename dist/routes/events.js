"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const eventController_1 = require("../controllers/eventController");
const router = (0, express_1.Router)();
router.get('/', eventController_1.listEvents);
router.get('/my', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), eventController_1.listMyEvents);
router.get('/registrations/my', auth_1.authenticate, eventController_1.getMyRegistrations);
router.get('/:id', eventController_1.getEvent);
router.get('/:id/registrations', auth_1.authenticate, eventController_1.getEventRegistrations);
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('business', 'admin'), [
    (0, express_validator_1.body)('business_promotion_id').notEmpty().toInt(),
    (0, express_validator_1.body)('title').notEmpty(),
    (0, express_validator_1.body)('date').notEmpty(),
    (0, express_validator_1.body)('time').notEmpty(),
], validate_1.validate, eventController_1.createEvent);
router.put('/:id', auth_1.authenticate, eventController_1.updateEvent);
router.post('/:id/payment-intent', auth_1.authenticate, eventController_1.createEventPaymentIntent);
router.post('/:id/register', auth_1.authenticate, eventController_1.registerForEvent);
router.post('/verify', auth_1.authenticate, eventController_1.verifyRegistration);
exports.default = router;
//# sourceMappingURL=events.js.map