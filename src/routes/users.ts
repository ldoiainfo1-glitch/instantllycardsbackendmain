import { Router, RequestHandler } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { getProfile, updateProfile, getUserById, getUserLocation, upsertUserLocation, deleteMe, matchContacts } from '../controllers/userController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.get('/profile', authenticate, h(getProfile));
router.put('/profile', authenticate, h(updateProfile));
router.delete('/me', authenticate, h(deleteMe));
router.get('/location', authenticate, h(getUserLocation));
router.put('/location', authenticate, h(upsertUserLocation));
router.post(
  '/match-contacts',
  authenticate,
  [body('phones').isArray({ min: 1 }).withMessage('phones must be a non-empty array')],
  validate,
  h(matchContacts)
);
router.get('/:id', authenticate, h(getUserById));

export default router;
