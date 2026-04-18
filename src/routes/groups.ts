import { Router, RequestHandler } from 'express';
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
const h = (fn: Function) => fn as RequestHandler;

router.use(authenticate);

router.get('/', h(getGroups));
router.post('/', h(createGroup));
router.post('/join', h(joinGroup));
router.get('/:groupId', h(getGroupDetail));
router.put('/:groupId', h(updateGroup));
router.get('/:groupId/messages', h(getGroupMessages));
router.get('/:groupId/media', h(getGroupMedia));
router.post('/:groupId/start-sharing', h(startSharing));
router.post('/:groupId/stop-sharing', h(stopSharing));
router.post('/:groupId/members', h(addMembers));
router.delete('/:groupId/members/:memberId', h(removeMember));

export default router;
