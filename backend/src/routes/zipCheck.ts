import { Router } from 'express';
import { postZipCheck, getZipCheckStores } from '../controllers/zipCheckController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { zipCheckSchema } from '../schemas';

const router = Router();

// Authenticated: each check fans out to several live scrapes, so it isn't
// something we want open to anonymous callers.
router.use(authenticate);

router.get('/stores', getZipCheckStores);
router.post('/', validate(zipCheckSchema), postZipCheck);

export default router;
