"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const userController_1 = require("../controllers/userController");
const router = (0, express_1.Router)();
router.get('/profile', auth_1.authenticate, userController_1.getProfile);
router.put('/profile', auth_1.authenticate, userController_1.updateProfile);
router.delete('/me', auth_1.authenticate, userController_1.deleteMe);
router.get('/location', auth_1.authenticate, userController_1.getUserLocation);
router.put('/location', auth_1.authenticate, userController_1.upsertUserLocation);
router.get('/:id', auth_1.authenticate, userController_1.getUserById);
exports.default = router;
//# sourceMappingURL=users.js.map