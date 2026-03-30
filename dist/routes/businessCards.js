"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const businessCardController_1 = require("../controllers/businessCardController");
const router = (0, express_1.Router)();
// Rate limit card creation: 5 per hour per IP (bypass in test)
const cardCreateLimit = process.env.NODE_ENV === 'test'
    ? (_req, _res, next) => next()
    : (0, express_rate_limit_1.default)({
        windowMs: 60 * 60 * 1000,
        max: 5,
        message: { error: 'Too many cards created, try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });
router.get('/', businessCardController_1.listCards);
router.get('/my', auth_1.authenticate, businessCardController_1.getMyCards);
router.get('/shared', auth_1.authenticate, businessCardController_1.getSharedCards);
router.get('/:id', businessCardController_1.getCard);
router.post('/', auth_1.authenticate, cardCreateLimit, [(0, express_validator_1.body)('full_name').notEmpty().withMessage('full_name required')], validate_1.validate, businessCardController_1.createCard);
router.put('/:id', auth_1.authenticate, [
    (0, express_validator_1.body)('full_name').optional().isString().withMessage('full_name must be a string'),
    (0, express_validator_1.body)('phone').optional().isString().withMessage('phone must be a string'),
    (0, express_validator_1.body)('email').optional({ values: 'null' }).isEmail().withMessage('Invalid email'),
    (0, express_validator_1.body)('services').optional().isArray().withMessage('services must be an array'),
    (0, express_validator_1.body)('personal_country_code').optional().isString().withMessage('personal_country_code must be a string'),
    (0, express_validator_1.body)('company_country_code').optional().isString().withMessage('company_country_code must be a string'),
], validate_1.validate, businessCardController_1.updateCard);
router.delete('/:id', auth_1.authenticate, businessCardController_1.deleteCard);
router.post('/share', auth_1.authenticate, [(0, express_validator_1.body)('card_id').isInt(), (0, express_validator_1.body)('recipient_user_id').isInt()], validate_1.validate, businessCardController_1.shareCard);
exports.default = router;
//# sourceMappingURL=businessCards.js.map