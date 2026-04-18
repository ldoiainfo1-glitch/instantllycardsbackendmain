import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  listMyBookings,
  listBusinessBookings,
  getBooking,
  createBooking,
  updateBookingStatus,
} from '../controllers/bookingController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/my', authenticate, h(listMyBookings));
router.get('/business/:businessId', authenticate, h(listBusinessBookings));
router.get('/:id', authenticate, h(getBooking));
router.post(
  '/',
  authenticate,
  [
    body('business_id').isInt(),
    body('customer_name').notEmpty(),
    body('customer_phone').notEmpty(),
  ],
  validate,
  h(createBooking)
);
router.patch(
  '/:id/status',
  authenticate,
  [body('status').notEmpty()],
  validate,
  h(updateBookingStatus)
);

export default router;
