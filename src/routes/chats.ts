import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getConversations, getChatMessages, findOrCreateChat, toggleMute } from '../controllers/chatController';

const router = Router();

router.use(authenticate);

router.get('/', getConversations as any);
router.get('/:chatId/messages', getChatMessages as any);
router.post('/find-or-create', findOrCreateChat as any);
router.put('/:chatId/mute', toggleMute as any);

export default router;
