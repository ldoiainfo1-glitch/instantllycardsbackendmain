import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getProfile, updateProfile, getUserById, getUserLocation, upsertUserLocation, deleteMe } from '../controllers/userController';

const router = Router();

router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.delete('/me', authenticate, deleteMe);
router.get('/location', authenticate, getUserLocation);
router.put('/location', authenticate, upsertUserLocation);
router.get('/:id', authenticate, getUserById);

export default router;
