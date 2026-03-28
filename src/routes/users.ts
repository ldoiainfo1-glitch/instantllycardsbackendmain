import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getProfile, updateProfile, getUserById, getUserLocation, upsertUserLocation } from '../controllers/userController';

const router = Router();

router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.get('/location', authenticate, getUserLocation);
router.put('/location', authenticate, upsertUserLocation);
router.get('/:id', authenticate, getUserById);

export default router;
