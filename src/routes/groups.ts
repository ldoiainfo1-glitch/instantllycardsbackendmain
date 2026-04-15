import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getGroups,
  createGroup,
  joinGroup,
  getGroupDetail,
  getGroupMessages,
  getGroupMedia,
  updateGroup,
  removeMember,
  addMembers,
  startSharing,
  stopSharing,
} from '../controllers/groupController';

const router = Router();

router.use(authenticate);

router.get('/', getGroups as any);
router.post('/', createGroup as any);
router.post('/join', joinGroup as any);
router.get('/:groupId', getGroupDetail as any);
router.put('/:groupId', updateGroup as any);
router.get('/:groupId/messages', getGroupMessages as any);
router.get('/:groupId/media', getGroupMedia as any);
router.post('/:groupId/start-sharing', startSharing as any);
router.post('/:groupId/stop-sharing', stopSharing as any);
router.post('/:groupId/members', addMembers as any);
router.delete('/:groupId/members/:memberId', removeMember as any);

export default router;
