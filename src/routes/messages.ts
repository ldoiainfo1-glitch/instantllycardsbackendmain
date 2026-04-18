import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { sendMessage, deleteMessage } from '../controllers/messageController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.use(authenticate);

router.post('/send', h(sendMessage));
router.delete('/:messageId', h(deleteMessage));

export default router;
