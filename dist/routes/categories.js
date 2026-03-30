"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const categoryController_1 = require("../controllers/categoryController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/mobile', categoryController_1.listMobileCategories);
router.get('/mobile/:categoryId/subcategories', categoryController_1.getMobileSubcategories);
router.get('/tree', categoryController_1.getCategoryTree);
router.get('/tree/admin', auth_1.authenticate, (0, auth_1.requireRole)('admin'), categoryController_1.getCategoryTreeAdmin);
router.post('/admin/node', auth_1.authenticate, (0, auth_1.requireRole)('admin'), categoryController_1.createCategoryNode);
router.put('/admin/node/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), categoryController_1.updateCategoryNode);
router.delete('/admin/node/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), categoryController_1.deleteCategoryNode);
router.get('/', categoryController_1.listCategories);
router.get('/:id/cards', categoryController_1.getCategoryBusinessCards);
router.get('/:id', categoryController_1.getCategoryById);
exports.default = router;
//# sourceMappingURL=categories.js.map