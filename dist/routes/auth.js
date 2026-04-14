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
const authController_1 = require("../controllers/authController");
const router = (0, express_1.Router)();
// Strict rate limit for credential endpoints: 10 attempts per 15 minutes per IP.
// Disabled in test environment to allow integration tests to run without hitting the limit.
const authRateLimit = process.env.NODE_ENV === 'test'
    ? (_req, _res, next) => next()
    : (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: { error: 'Too many attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });
router.post('/signup', authRateLimit, [
    (0, express_validator_1.body)('phone').notEmpty().withMessage('Phone is required'),
    (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
    (0, express_validator_1.body)('role').optional().isIn(['customer', 'business']).withMessage('Role must be customer or business'),
], validate_1.validate, authController_1.signup);
router.post('/login', authRateLimit, [
    (0, express_validator_1.body)().custom((_, { req }) => {
        if (!req.body.phone && !req.body.email)
            throw new Error('phone or email required');
        return true;
    }),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password required'),
    (0, express_validator_1.body)('loginType').optional().isIn(['customer', 'business']).withMessage('loginType must be customer or business'),
], validate_1.validate, authController_1.login);
router.post('/refresh', authRateLimit, authController_1.refresh);
router.post('/logout', auth_1.authenticate, authController_1.logout);
router.get('/me', auth_1.authenticate, authController_1.me);
router.post('/change-password', auth_1.authenticate, [
    (0, express_validator_1.body)('currentPassword').notEmpty().withMessage('Current password required'),
    (0, express_validator_1.body)('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], validate_1.validate, authController_1.changePassword);
// Forgot password routes
router.post('/forgot-password/send-otp', authRateLimit, [
    (0, express_validator_1.body)('phone').notEmpty().withMessage('Phone number is required'),
], validate_1.validate, authController_1.sendPasswordResetOTP);
router.post('/forgot-password/verify-otp', authRateLimit, [
    (0, express_validator_1.body)('phone').notEmpty().withMessage('Phone number is required'),
    (0, express_validator_1.body)('otp').notEmpty().withMessage('OTP is required'),
], validate_1.validate, authController_1.verifyPasswordResetOTP);
router.post('/forgot-password/reset-password', authRateLimit, [
    (0, express_validator_1.body)('phone').notEmpty().withMessage('Phone number is required'),
    (0, express_validator_1.body)('otp').notEmpty().withMessage('OTP is required'),
    (0, express_validator_1.body)('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], validate_1.validate, authController_1.resetPassword);
exports.default = router;
//# sourceMappingURL=auth.js.map