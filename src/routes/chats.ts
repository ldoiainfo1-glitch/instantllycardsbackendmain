import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { getConversations, getChatMessages, findOrCreateChat, toggleMute } from '../controllers/chatController';

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

router.use(authenticate);

router.get('/', h(getConversations));
router.get('/:chatId/messages', h(getChatMessages));
router.post('/find-or-create', h(findOrCreateChat));
router.put('/:chatId/mute', h(toggleMute));

export default router;
