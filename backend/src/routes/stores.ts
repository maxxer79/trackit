import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// GET /api/stores
router.get('/', async (_req, res: Response) => {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return res.json({ stores });
});

// GET /api/stores/:slug
router.get('/:slug', async (req, res: Response) => {
  const store = await prisma.store.findUnique({
    where: { slug: req.params.slug },
    include: {
      stockStatuses: {
        where: { status: 'IN_STOCK' },
        include: { product: true },
        take: 20,
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!store) return res.status(404).json({ error: 'Store not found' });
  return res.json({ store });
});

// POST /api/stores - Admin: add store
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    slug: z.string(),
    name: z.string(),
    logoUrl: z.string().url().optional(),
    websiteUrl: z.string().url().optional(),
    country: z.string().default('US'),
  });

  try {
    const data = schema.parse(req.body);
    const store = await prisma.store.create({ data });
    return res.status(201).json({ store });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    return res.status(500).json({ error: 'Failed to create store' });
  }
});

export default router;
