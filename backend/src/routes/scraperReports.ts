import { Router } from 'express';
import { createScraperReport } from '../controllers/scraperReportController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createScraperReportSchema } from '../schemas';

const router = Router();

router.use(authenticate);
router.post('/', validate(createScraperReportSchema), createScraperReport);

export default router;
