import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate, requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import {
  listVouchers,
  getVoucher,
  createVoucher,
  claimVoucher,
  transferVoucher,
  getMyVouchers,
  getMyCreatedVouchers,
  getMyTransfers,
  redeemVoucher,
  updateVoucherStatus,
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
  requireFeature('voucher', {
    requirePromotionId: true,
    promotionIdSource: 'body',
    promotionIdField: 'business_promotion_id',
  }),
  [
    body('business_promotion_id').isInt(),
    body('title').notEmpty(),
    body('discount_value').notEmpty(),
  ],
  validate,
  createVoucher
);
<<<<<<< Updated upstream
router.post('/:id/claim', authenticate, claimVoucher);
=======
router.post('/:id/claim', authenticate, h(claimVoucher));
router.patch('/:id/status', authenticate, [body('status').notEmpty()], validate, h(updateVoucherStatus));
router.post('/redeem', authenticate, [body('voucher_id').isInt()], validate, h(redeemVoucher));
>>>>>>> Stashed changes
router.post(
  '/transfer',
  authenticate,
  [body('voucher_id').isInt(), body('recipient_phone').notEmpty()],
  validate,
  transferVoucher
);

export default router;
