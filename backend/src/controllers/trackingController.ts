import { Request, Response } from 'express';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

export const getMyTrackings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const trackings = await prisma.tracking.findMany({
      where: { userId: req.user!.id, isActive: true },
      include: {
        product: {
          include: {
            storeListings: {
              include: { store: true },
              orderBy: [{ inStock: 'desc' }, { price: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(trackings);
  } catch (error) {
    logger.error('GetMyTrackings error', error);
    res.status(500).json({ error: 'Failed to fetch trackings' });
  }
};

export const addTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.body;
    const user = req.user!;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const existing = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
    });

    if (existing) {
      if (!existing.isActive) {
        await prisma.tracking.update({ where: { id: existing.id }, data: { isActive: true } });
        res.json({ message: 'Tracking re-enabled', tracking: existing });
        return;
      }
      res.status(409).json({ error: 'Already tracking this product' });
      return;
    }

    // Check tracking limit
    if (user.trackingLimit !== -1) {
      const count = await prisma.tracking.count({ where: { userId: user.id, isActive: true } });
      if (count >= user.trackingLimit) {
        res.status(403).json({
          error: `Tracking limit reached (${user.trackingLimit} item${user.trackingLimit > 1 ? 's' : ''}). Upgrade your account to track more.`,
          limitReached: true,
          currentCount: count,
          limit: user.trackingLimit,
        });
        return;
      }
    }

    const tracking = await prisma.tracking.create({
      data: { userId: user.id, productId },
      include: { product: { include: { storeListings: { include: { store: true } } } } },
    });

    res.status(201).json({ tracking, message: 'Tracking started' });
  } catch (error) {
    logger.error('AddTracking error', error);
    res.status(500).json({ error: 'Failed to add tracking' });
  }
};

export const removeTracking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const tracking = await prisma.tracking.findUnique({
      where: { userId_productId: { userId: req.user!.id, productId } },
    });

    if (!tracking) { res.status(404).json({ error: 'Tracking not found' }); return; }

    await prisma.tracking.update({ where: { id: tracking.id }, data: { isActive: false } });
    res.json({ message: 'Tracking removed' });
  } catch (error) {
    logger.error('RemoveTracking error', error);
    res.status(500).json({ error: 'Failed to remove tracking' });
  }
};

export const getAlertHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where: { userId: req.user!.id },
        include: {
          storeProduct: {
            include: { product: true, store: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.alert.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({ alerts, total });
  } catch (error) {
    logger.error('GetAlertHistory error', error);
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
};
