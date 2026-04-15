import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { sendMessage, deleteMessage } from '../controllers/messageController';

const router = Router();

router.use(authenticate);

router.post('/send', sendMessage as any);
router.delete('/:messageId', deleteMessage as any);

export default router;
