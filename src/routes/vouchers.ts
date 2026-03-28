import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listVouchers,
  getVoucher,
  createVoucher,
  claimVoucher,
  transferVoucher,
  getMyVouchers,
  getMyCreatedVouchers,
  getMyTransfers,
} from '../controllers/voucherController';

const router = Router();

router.get('/', listVouchers);
router.get('/my', authenticate, getMyVouchers);
router.get('/created', authenticate, requireRole('business', 'admin'), getMyCreatedVouchers);
router.get('/transfers', authenticate, getMyTransfers);
router.get('/:id', getVoucher);
router.post(
  '/',
  authenticate,
  requireRole('business', 'admin'),
  [
    body('business_id').isInt(),
    body('title').notEmpty(),
    body('discount_value').notEmpty(),
  ],
  validate,
  createVoucher
);
router.post('/:id/claim', authenticate, claimVoucher);
router.post(
  '/transfer',
  authenticate,
  [body('voucher_id').isInt(), body('recipient_phone').notEmpty()],
  validate,
  transferVoucher
);

export default router;
