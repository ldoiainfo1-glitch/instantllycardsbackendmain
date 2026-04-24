import { Router, RequestHandler } from 'express';
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
const h = (fn: Function) => fn as RequestHandler;

router.get('/mobile', h(listMobileCategories));
router.get('/mobile/:categoryId/subcategories', h(getMobileSubcategories));
router.get('/tree', h(getCategoryTree));
router.get('/tree/admin', authenticate, requireRole('admin'), h(getCategoryTreeAdmin));

router.post('/admin/node', authenticate, requireRole('admin'), h(createCategoryNode));
router.put('/admin/node/:id', authenticate, requireRole('admin'), h(updateCategoryNode));
router.delete('/admin/node/:id', authenticate, requireRole('admin'), h(deleteCategoryNode));

router.get('/', h(listCategories));
router.get('/:id/cards', h(getCategoryBusinessCards));
router.get('/:id', h(getCategoryById));

export default router;
