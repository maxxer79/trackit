import { Router } from 'express';
import { getMyPurchases, createPurchase, updatePurchase, deletePurchase, refreshPurchaseTracking } from '../controllers/purchaseController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPurchaseSchema, updatePurchaseSchema } from '../schemas';

const router = Router();

router.use(authenticate);
router.get('/', getMyPurchases);
router.post('/', validate(createPurchaseSchema), createPurchase);
router.patch('/:id', validate(updatePurchaseSchema), updatePurchase);
router.post('/:id/refresh-tracking', refreshPurchaseTracking);
router.delete('/:id', deletePurchase);

export default router;
