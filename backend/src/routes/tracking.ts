import { Router } from 'express';
import { getMyTrackings, addTracking, removeTracking, getAlertHistory, exportTrackings, exportAlerts } from '../controllers/trackingController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { addTrackingSchema } from '../schemas';

const router = Router();

router.use(authenticate);
router.get('/', getMyTrackings);
router.get('/export', exportTrackings);
router.post('/', validate(addTrackingSchema), addTracking);
router.delete('/:productId', removeTracking);
router.get('/alerts/history', getAlertHistory);
router.get('/alerts/export', exportAlerts);

export default router;
