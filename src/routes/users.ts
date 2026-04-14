import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { getProfile, updateProfile, getUserById, getUserLocation, upsertUserLocation, deleteMe, matchContacts } from '../controllers/userController';

const router = Router();

router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.delete('/me', authenticate, deleteMe);
router.get('/location', authenticate, getUserLocation);
router.put('/location', authenticate, upsertUserLocation);
router.post(
  '/match-contacts',
  authenticate,
  [body('phones').isArray({ min: 1 }).withMessage('phones must be a non-empty array')],
  validate,
  matchContacts
);
router.get('/:id', authenticate, getUserById);

export default router;
