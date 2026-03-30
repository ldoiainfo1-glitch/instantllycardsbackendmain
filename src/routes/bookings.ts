import { Router } from 'express';
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

router.get('/my', authenticate, listMyBookings);
router.get('/business/:businessId', authenticate, listBusinessBookings);
router.get('/:id', authenticate, getBooking);
router.post(
  '/',
  authenticate,
  [
    body('business_id').isInt(),
    body('customer_name').notEmpty(),
    body('customer_phone').notEmpty(),
  ],
  validate,
  createBooking
);
router.patch(
  '/:id/status',
  authenticate,
  [body('status').notEmpty()],
  validate,
  updateBookingStatus
);

export default router;
