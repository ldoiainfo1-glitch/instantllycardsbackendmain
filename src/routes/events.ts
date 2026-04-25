import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listEvents,
  getEvent,
  listMyEvents,
  createEvent,
  updateEvent,
  createEventPaymentIntent,
  registerForEvent,
  getEventRegistrations,
  getMyRegistrations,
  verifyRegistration,
} from '../controllers/eventController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/', h(listEvents));
router.get('/my', authenticate, requireRole('business', 'admin'), h(listMyEvents));
router.get('/registrations/my', authenticate, h(getMyRegistrations));
router.get('/:id', h(getEvent));
router.get('/:id/registrations', authenticate, h(getEventRegistrations));
router.post(
  '/',
  authenticate,
  requireRole('business', 'admin'),
  [
    body('business_promotion_id').notEmpty().toInt(),
    body('title').notEmpty(),
    body('date').notEmpty(),
    body('time').notEmpty(),
  ],
  validate,
  h(createEvent)
);
router.put('/:id', authenticate, h(updateEvent));
router.post('/:id/payment-intent', authenticate, h(createEventPaymentIntent));
router.post('/:id/register', authenticate, h(registerForEvent));
router.post('/verify', authenticate, h(verifyRegistration));

export default router;
