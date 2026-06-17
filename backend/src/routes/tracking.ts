import { Router } from 'express';
import { getMyTrackings, addTracking, removeTracking, getAlertHistory } from '../controllers/trackingController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { addTrackingSchema } from '../schemas';

const router = Router();

router.use(authenticate);
router.get('/', getMyTrackings);
router.post('/', validate(addTrackingSchema), addTracking);
router.delete('/:productId', removeTracking);
router.get('/alerts/history', getAlertHistory);

export default router;
