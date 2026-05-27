import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Placeholder for additional user routes
router.get('/me', (_req, res) => res.json({ message: 'Use /api/auth/me' }));

export default router;
