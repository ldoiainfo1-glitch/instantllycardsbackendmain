import { Router, RequestHandler, raw } from 'express';
import { handleRazorpayWebhook } from '../controllers/razorpayWebhookController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

// IMPORTANT: webhook MUST receive the raw body so we can verify the
// HMAC signature against the exact bytes Razorpay sent. The global
// express.json() middleware in index.ts is mounted BEFORE this router,
// so we override per-route here. We also stash the raw string on req
// for the controller to read.
router.post(
  '/razorpay',
  raw({ type: 'application/json', limit: '1mb' }),
  (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
      (req as any).rawBody = req.body.toString('utf8');
    }
    next();
  },
  h(handleRazorpayWebhook),
);

export default router;
