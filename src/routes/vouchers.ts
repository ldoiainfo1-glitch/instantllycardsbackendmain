import { Router, RequestHandler } from 'express';
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
  createVoucherPaymentIntent,
  verifyVoucherPayment,
} from '../controllers/voucherController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/', h(listVouchers));
router.get('/my', authenticate, h(getMyVouchers));
router.get('/created', authenticate, requireRole('business', 'admin'), h(getMyCreatedVouchers));
router.get('/transfers', authenticate, h(getMyTransfers));
router.get('/:id', h(getVoucher));
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
  h(createVoucher)
);
router.post('/:id/claim', authenticate, h(claimVoucher));
router.post('/:id/payment-intent', authenticate, h(createVoucherPaymentIntent));
router.post(
  '/:id/verify-payment',
  authenticate,
  [
    body('razorpay_order_id').notEmpty(),
    body('razorpay_payment_id').notEmpty(),
    body('razorpay_signature').notEmpty(),
  ],
  validate,
  h(verifyVoucherPayment)
);
router.patch('/:id/status', authenticate, [body('status').notEmpty()], validate, h(updateVoucherStatus));
router.post('/redeem', authenticate, [body('voucher_id').isInt()], validate, h(redeemVoucher));
router.post(
  '/transfer',
  authenticate,
  [body('voucher_id').isInt(), body('recipient_phone').notEmpty()],
  validate,
  h(transferVoucher)
);

export default router;
