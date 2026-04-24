import { Router, RequestHandler } from 'express';
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
const h = (fn: Function) => fn as RequestHandler;

router.get('/business/:businessId', authenticate, h(listBusinessLeads));
router.get('/promotion/:promotionId', authenticate, h(listPromotionLeads));
router.post(
  '/',
  [
    body('business_id').optional().isInt(),
    body('business_promotion_id').optional().isInt(),
    body('customer_name').notEmpty(),
  ],
  validate,
  h(createLead)
);
router.patch(
  '/:id/status',
  authenticate,
  [body('status').notEmpty()],
  validate,
  h(updateLeadStatus)
);

export default router;
