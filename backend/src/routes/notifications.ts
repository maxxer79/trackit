import { Router } from 'express';
import { getNotifications, markAllRead, markRead, savePushToken, deletePushToken } from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', getNotifications);
router.put('/read-all', markAllRead);
router.put('/:id/read', markRead);
router.post('/push-token', savePushToken);
router.delete('/push-token', deletePushToken);

export default router;
