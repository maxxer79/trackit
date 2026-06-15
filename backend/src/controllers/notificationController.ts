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

/**
 * GET /api/notifications/preferences
 * Returns the user's notification settings in the shape the Settings page
 * expects (NotifPrefs). Maps DB columns → frontend field names.
 */
export const getPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        emailAlerts: true,
        pushAlerts: true,
        notifySms: true,
        notifyDiscord: true,
        phoneNumber: true,
        discordWebhook: true,
        autoBuyEnabled: true,
      },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    res.json({
      data: {
        emailEnabled: user.emailAlerts,
        smsEnabled: user.notifySms,
        pushEnabled: user.pushAlerts,
        discordEnabled: user.notifyDiscord,
        phone: user.phoneNumber,
        discordWebhook: user.discordWebhook,
        autoBuyEnabled: user.autoBuyEnabled,
        autoBuyMaxPrice: null,
      },
    });
  } catch (error) {
    logger.error('GetPreferences error', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
};

/**
 * PUT /api/notifications/preferences
 * Saves the user's notification settings. Only updates fields present in the
 * body (partial). Maps frontend field names → DB columns.
 */
export const updatePreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { emailEnabled, smsEnabled, pushEnabled, discordEnabled, phone, discordWebhook, autoBuyEnabled } = req.body;

    const data: Record<string, unknown> = {};
    if (emailEnabled !== undefined) data.emailAlerts = !!emailEnabled;
    if (smsEnabled !== undefined) data.notifySms = !!smsEnabled;
    if (pushEnabled !== undefined) data.pushAlerts = !!pushEnabled;
    if (discordEnabled !== undefined) data.notifyDiscord = !!discordEnabled;
    if (phone !== undefined) data.phoneNumber = phone || null;
    if (discordWebhook !== undefined) data.discordWebhook = discordWebhook || null;
    if (autoBuyEnabled !== undefined) data.autoBuyEnabled = !!autoBuyEnabled;

    await prisma.user.update({ where: { id: req.user!.id }, data });
    res.json({ message: 'Preferences saved' });
  } catch (error) {
    logger.error('UpdatePreferences error', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
};

/**
 * POST /api/notifications/push/subscribe
 * Accepts a PushSubscription.toJSON() payload ({ endpoint, keys: { p256dh, auth } })
 * — the shape the browser produces — and upserts it as a push token.
 */
export const subscribePush = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { endpoint, keys, p256dh: flatP256dh, auth: flatAuth, platform = 'web' } = req.body;
    const p256dh = keys?.p256dh ?? flatP256dh;
    const auth = keys?.auth ?? flatAuth;
    if (!endpoint || !p256dh || !auth) { res.status(400).json({ error: 'Invalid push subscription' }); return; }

    await prisma.pushToken.upsert({
      where: { endpoint },
      update: { p256dh, auth, userId: req.user!.id },
      create: { userId: req.user!.id, endpoint, p256dh, auth, platform },
    });

    // Turn the push channel on now that this device is registered.
    await prisma.user.update({ where: { id: req.user!.id }, data: { pushAlerts: true } });

    res.json({ message: 'Push subscription saved' });
  } catch (error) {
    logger.error('SubscribePush error', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
};

/**
 * POST /api/notifications/push/unsubscribe
 * Removes a device's push token by endpoint.
 */
export const unsubscribePush = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await prisma.pushToken.deleteMany({ where: { endpoint, userId: req.user!.id } });
    }
    res.json({ message: 'Push subscription removed' });
  } catch (error) {
    logger.error('UnsubscribePush error', error);
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
};
