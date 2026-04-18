"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const reviewController_1 = require("../controllers/reviewController");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.get('/card/:cardId', h(reviewController_1.getCardReviews));
router.post('/', auth_1.authenticate, [(0, express_validator_1.body)('business_id').isInt(), (0, express_validator_1.body)('rating').isInt({ min: 1, max: 5 })], validate_1.validate, h(reviewController_1.createReview));
router.post('/feedback', auth_1.authenticate, [(0, express_validator_1.body)('message').notEmpty()], validate_1.validate, h(reviewController_1.createFeedback));
exports.default = router;
//# sourceMappingURL=reviews.js.map