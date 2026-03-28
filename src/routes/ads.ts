import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { listAds, trackImpression, trackClick, getMyAds } from '../controllers/adController';

const router = Router();

router.get('/', listAds);
router.get('/my', authenticate, getMyAds);
router.post('/:id/impression', trackImpression);
router.post('/:id/click', trackClick);

export default router;
