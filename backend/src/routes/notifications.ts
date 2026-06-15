import { Router } from 'express';
import {
  getNotifications, markAllRead, markRead, savePushToken, deletePushToken,
  getPreferences, updatePreferences, subscribePush, unsubscribePush,
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Notification preferences (Settings page → Notification Channels)
router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);

// Web push subscription lifecycle (browser PushSubscription.toJSON())
router.post('/push/subscribe', subscribePush);
router.post('/push/unsubscribe', unsubscribePush);

router.get('/', getNotifications);
router.put('/read-all', markAllRead);
router.put('/:id/read', markRead);
router.post('/push-token', savePushToken);
router.delete('/push-token', deletePushToken);

export default router;
