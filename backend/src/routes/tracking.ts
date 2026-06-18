import { Router } from 'express';
import { getMyTrackings, addTracking, removeTracking, updateTracking, importTracking, getAlertHistory, exportTrackings, exportAlerts, getTrackingAnalytics, bulkTracking } from '../controllers/trackingController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { addTrackingSchema, updateTrackingSchema, importTrackingSchema, bulkTrackingSchema } from '../schemas';

const router = Router();

router.use(authenticate);
router.get('/', getMyTrackings);
router.get('/export', exportTrackings);
router.get('/analytics', getTrackingAnalytics);
router.post('/', validate(addTrackingSchema), addTracking);
router.post('/import', validate(importTrackingSchema), importTracking);
router.post('/bulk', validate(bulkTrackingSchema), bulkTracking);
router.patch('/:productId', validate(updateTrackingSchema), updateTracking);
router.delete('/:productId', removeTracking);
router.get('/alerts/history', getAlertHistory);
router.get('/alerts/export', exportAlerts);

export default router;
