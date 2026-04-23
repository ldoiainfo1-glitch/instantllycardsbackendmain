import { Router, Request, Response, RequestHandler } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { getProfile, updateProfile, getUserById, getUserLocation, upsertUserLocation, deleteMe, matchContacts, updatePushToken } from '../controllers/userController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

// ─── TEMPORARY DEBUG — remove after FCM is confirmed working ─────────────────
router.post('/debug-push', (req: Request, res: Response) => {
  console.log('[DEBUG-PUSH] Hit from:', req.headers['user-agent']);
  console.log('[DEBUG-PUSH] Body:', JSON.stringify(req.body));
  console.log('[DEBUG-PUSH] Auth header:', req.headers['authorization'] ? 'present' : 'missing');
  res.json({ received: true, apiUrl: 'backend is reachable', body: req.body });
});
// ─────────────────────────────────────────────────────────────────────────────

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
router.put('/push-token', authenticate, h(updatePushToken));
router.get('/:id', authenticate, h(getUserById));

export default router;
