"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const adController_1 = require("../controllers/adController");
const router = (0, express_1.Router)();
router.get('/', adController_1.listAds);
router.get('/my', auth_1.authenticate, adController_1.getMyAds);
router.post('/:id/impression', adController_1.trackImpression);
router.post('/:id/click', adController_1.trackClick);
exports.default = router;
//# sourceMappingURL=ads.js.map