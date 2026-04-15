import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getGroups,
  createGroup,
  joinGroup,
  getGroupDetail,
  getGroupMessages,
  updateGroup,
  removeMember,
  addMembers,
} from '../controllers/groupController';

const router = Router();

router.use(authenticate);

router.get('/', getGroups as any);
router.post('/', createGroup as any);
router.post('/join', joinGroup as any);
router.get('/:groupId', getGroupDetail as any);
router.put('/:groupId', updateGroup as any);
router.get('/:groupId/messages', getGroupMessages as any);
router.post('/:groupId/members', addMembers as any);
router.delete('/:groupId/members/:memberId', removeMember as any);

export default router;
