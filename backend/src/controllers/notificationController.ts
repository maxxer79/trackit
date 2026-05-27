import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', unreadOnly } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const where: any = { userId: req.user!.id };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, skip, take: parseInt(limit as string), orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    logger.error('GetNotifications error', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

export const markAllRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
};

export const markRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.notification.update({
      where: { id, userId: req.user!.id },
      data: { isRead: true },
    });
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

export const savePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { endpoint, p256dh, auth, platform = 'web' } = req.body;
    if (!endpoint || !p256dh || !auth) { res.status(400).json({ error: 'Invalid push subscription' }); return; }

    await prisma.pushToken.upsert({
      where: { endpoint },
      update: { p256dh, auth, userId: req.user!.id },
      create: { userId: req.user!.id, endpoint, p256dh, auth, platform },
    });

    res.json({ message: 'Push token saved' });
  } catch (error) {
    logger.error('SavePushToken error', error);
    res.status(500).json({ error: 'Failed to save push token' });
  }
};

export const deletePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { endpoint } = req.body;
    await prisma.pushToken.deleteMany({ where: { endpoint, userId: req.user!.id } });
    res.json({ message: 'Push token removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove push token' });
  }
};
