import { Router } from 'express';
import {
  getNotifications, markAllRead, markRead, savePushToken, deletePushToken,
  getPreferences, updatePreferences, subscribePush, unsubscribePush,
  getAlerts, markAlertsRead,
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updatePreferencesSchema } from '../schemas';

const router = Router();
router.use(authenticate);

// Notification preferences (Settings page → Notification Channels)
router.get('/preferences', getPreferences);
router.put('/preferences', validate(updatePreferencesSchema), updatePreferences);

// Restock alert history (Alerts page) — sourced from the Alert table.
router.get('/alerts', getAlerts);
router.post('/alerts/read', markAlertsRead);

// Web push subscription lifecycle (browser PushSubscription.toJSON())
router.post('/push/subscribe', subscribePush);
router.post('/push/unsubscribe', unsubscribePush);

router.get('/', getNotifications);
router.put('/read-all', markAllRead);
router.put('/:id/read', markRead);
router.post('/push-token', savePushToken);
router.delete('/push-token', deletePushToken);

export default router;
