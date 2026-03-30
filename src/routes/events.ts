import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listEvents,
  getEvent,
  listMyEvents,
  createEvent,
  updateEvent,
  registerForEvent,
  getEventRegistrations,
  getMyRegistrations,
} from '../controllers/eventController';

const router = Router();

router.get('/', listEvents);
router.get('/my', authenticate, requireRole('business', 'admin'), listMyEvents);
router.get('/registrations/my', authenticate, getMyRegistrations);
router.get('/:id', getEvent);
router.get('/:id/registrations', authenticate, getEventRegistrations);
router.post(
  '/',
  authenticate,
  requireRole('business', 'admin'),
  [
    body('business_id').notEmpty().toInt(),
    body('title').notEmpty(),
    body('date').notEmpty(),
    body('time').notEmpty(),
  ],
  validate,
  createEvent
);
router.put('/:id', authenticate, updateEvent);
router.post('/:id/register', authenticate, registerForEvent);

export default router;
