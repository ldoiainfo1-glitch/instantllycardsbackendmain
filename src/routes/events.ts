import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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
import {
  createTicketTier,
  updateTicketTier,
  deleteTicketTier,
  listTicketTiers,
} from '../controllers/ticketTierController';
import {
  joinWaitlist,
  promoteWaitlist,
} from '../controllers/waitlistController';
import {
  cancelEvent,
  refundRegistration,
  partialCancelTickets,
} from '../controllers/eventRefundController';
import { getEventAnalytics } from '../controllers/eventAnalyticsController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

// ── Phase 5+ — Rate limit registration & payment-intent endpoints.
//   Keyed by authenticated userId so users behind a shared NAT/proxy aren't
//   throttled together. Falls back to IP for unauthenticated calls (which
//   `authenticate` blocks anyway, but the limiter runs first).
//   Limit: 5 attempts per minute per user — protects against accidental
//   client retry storms and brute-force registration scripts without
//   impacting normal flow.
const registerRateLimit =
  process.env.NODE_ENV === 'test'
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        message: {
          error: 'Too many registration attempts, please slow down',
          code: 'RATE_LIMITED',
        },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: any) => {
          const uid = req.user?.userId;
          return uid ? `user:${uid}` : `ip:${ipKeyGenerator(req)}`;
        },
      });

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
router.post('/:id/payment-intent', authenticate, registerRateLimit, h(createEventPaymentIntent));
router.post('/:id/register', authenticate, registerRateLimit, h(registerForEvent));
router.post('/verify', authenticate, h(verifyRegistration));

// Phase 3 — Ticket tier CRUD (organizer/admin only for write paths)
router.get('/:id/tickets', h(listTicketTiers));
router.post(
  '/:id/tickets',
  authenticate,
  requireRole('business', 'admin'),
  h(createTicketTier),
);
router.put(
  '/:id/tickets/:tierId',
  authenticate,
  requireRole('business', 'admin'),
  h(updateTicketTier),
);
router.delete(
  '/:id/tickets/:tierId',
  authenticate,
  requireRole('business', 'admin'),
  h(deleteTicketTier),
);

// Phase 4 — Waitlist
router.post('/:id/waitlist', authenticate, h(joinWaitlist));
router.post(
  '/:id/waitlist/promote',
  authenticate,
  requireRole('business', 'admin'),
  h(promoteWaitlist),
);

// Phase 5 — Lifecycle: cancel event, refund registration, analytics
router.post(
  '/:id/cancel',
  authenticate,
  requireRole('business', 'admin'),
  h(cancelEvent),
);
router.post(
  '/:id/refund',
  authenticate,
  requireRole('business', 'admin'),
  h(refundRegistration),
);
// Partial ticket cancellation by the ticket holder themselves
router.post(
  '/:id/partial-cancel',
  authenticate,
  h(partialCancelTickets),
);
router.get(
  '/:id/analytics',
  authenticate,
  requireRole('business', 'admin'),
  h(getEventAnalytics),
);

export default router;
