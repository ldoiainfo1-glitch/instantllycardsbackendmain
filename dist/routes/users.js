"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const userController_1 = require("../controllers/userController");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.get('/profile', auth_1.authenticate, h(userController_1.getProfile));
router.put('/profile', auth_1.authenticate, h(userController_1.updateProfile));
router.delete('/me', auth_1.authenticate, h(userController_1.deleteMe));
router.get('/location', auth_1.authenticate, h(userController_1.getUserLocation));
router.put('/location', auth_1.authenticate, h(userController_1.upsertUserLocation));
router.post('/match-contacts', auth_1.authenticate, [(0, express_validator_1.body)('phones').isArray({ min: 1 }).withMessage('phones must be a non-empty array')], validate_1.validate, h(userController_1.matchContacts));
router.get('/:id', auth_1.authenticate, h(userController_1.getUserById));
exports.default = router;
//# sourceMappingURL=users.js.map