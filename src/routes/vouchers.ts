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
  getVoucherClaims,
  getAllMyClaims,
  redeemVoucher,
  redeemVoucherByQr,
  updateVoucherStatus,
  updateVoucher,
  deleteVoucher,
  createVoucherPaymentIntent,
  verifyVoucherPayment,
} from '../controllers/voucherController';
import {
  createInstallmentPaymentIntent,
  verifyInstallmentPayment,
  getInstallmentStatus,
  getMyInstallments,
  getVoucherInstallmentLedger,
} from '../controllers/installmentController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/', h(listVouchers));
router.get('/my', authenticate, h(getMyVouchers));
router.get('/my-installments', authenticate, h(getMyInstallments));
router.get('/:voucherId/installment-ledger', authenticate, h(getVoucherInstallmentLedger));
router.get('/all-claims', authenticate, h(getAllMyClaims));
router.get('/:voucherId/claims', authenticate, h(getVoucherClaims));
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

// Installment payment routes
router.get('/claims/:claimId/installment', authenticate, h(getInstallmentStatus));
router.post('/claims/:claimId/installment/pay', authenticate, [body('amount').isFloat({ min: 1 })], validate, h(createInstallmentPaymentIntent));
router.post(
  '/claims/:claimId/installment/verify',
  authenticate,
  [
    body('razorpay_order_id').notEmpty(),
    body('razorpay_payment_id').notEmpty(),
    body('razorpay_signature').notEmpty(),
    body('amount').isFloat({ min: 1 }),
  ],
  validate,
  h(verifyInstallmentPayment)
);

router.patch('/:id/status', authenticate, [body('status').notEmpty()], validate, h(updateVoucherStatus));
router.patch('/:id', authenticate, h(updateVoucher));
router.put('/:id', authenticate, h(updateVoucher));
router.delete('/:id', authenticate, h(deleteVoucher));
router.post('/redeem', authenticate, [body('voucher_id').isInt()], validate, h(redeemVoucher));
router.post(
  '/redeem-by-qr',
  authenticate,
  [body('voucher_id').isInt(), body('claim_id').isInt()],
  validate,
  h(redeemVoucherByQr)
);
router.post(
  '/transfer',
  authenticate,
  [body('voucher_id').isInt(), body('recipient_phone').notEmpty()],
  validate,
  h(transferVoucher)
);

export default router;
