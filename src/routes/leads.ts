import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  listBusinessLeads,
  listPromotionLeads,
  createLead,
  updateLeadStatus,
} from '../controllers/leadController';

const router = Router();

router.get('/business/:businessId', authenticate, listBusinessLeads);
router.get('/promotion/:promotionId', authenticate, listPromotionLeads);
router.post(
  '/',
  [
    body('business_id').optional().isInt(),
    body('business_promotion_id').optional().isInt(),
    body('customer_name').notEmpty(),
  ],
  validate,
  createLead
);
router.patch(
  '/:id/status',
  authenticate,
  [body('status').notEmpty()],
  validate,
  updateLeadStatus
);

export default router;
