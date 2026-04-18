"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const categoryController_1 = require("../controllers/categoryController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const h = (fn) => fn;
router.get('/mobile', h(categoryController_1.listMobileCategories));
router.get('/mobile/:categoryId/subcategories', h(categoryController_1.getMobileSubcategories));
router.get('/tree', h(categoryController_1.getCategoryTree));
router.get('/tree/admin', auth_1.authenticate, (0, auth_1.requireRole)('admin'), h(categoryController_1.getCategoryTreeAdmin));
router.post('/admin/node', auth_1.authenticate, (0, auth_1.requireRole)('admin'), h(categoryController_1.createCategoryNode));
router.put('/admin/node/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), h(categoryController_1.updateCategoryNode));
router.delete('/admin/node/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), h(categoryController_1.deleteCategoryNode));
router.get('/', h(categoryController_1.listCategories));
router.get('/:id/cards', h(categoryController_1.getCategoryBusinessCards));
router.get('/:id', h(categoryController_1.getCategoryById));
exports.default = router;
//# sourceMappingURL=categories.js.map