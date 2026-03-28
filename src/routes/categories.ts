import { Router } from 'express';
import {
  listCategories,
  listMobileCategories,
  getMobileSubcategories,
  getCategoryById,
  getCategoryBusinessCards,
  getCategoryTree,
  getCategoryTreeAdmin,
  createCategoryNode,
  updateCategoryNode,
  deleteCategoryNode,
} from '../controllers/categoryController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.get('/mobile', listMobileCategories);
router.get('/mobile/:categoryId/subcategories', getMobileSubcategories);
router.get('/tree', getCategoryTree);
router.get('/tree/admin', authenticate, requireRole('admin'), getCategoryTreeAdmin);

router.post('/admin/node', authenticate, requireRole('admin'), createCategoryNode);
router.put('/admin/node/:id', authenticate, requireRole('admin'), updateCategoryNode);
router.delete('/admin/node/:id', authenticate, requireRole('admin'), deleteCategoryNode);

router.get('/', listCategories);
router.get('/:id/cards', getCategoryBusinessCards);
router.get('/:id', getCategoryById);

export default router;
