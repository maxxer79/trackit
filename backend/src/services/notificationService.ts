import { prisma } from '../config/database';
import { sendPushNotification } from './webPushService';
import { sendStockAlertEmail } from './emailService';
import logger from '../utils/logger';

interface NotifyPayload {
  userId: string;
  title: string;
  body: string;
  url?: string;
  imageUrl?: string;
  storeProductId: string;
  type: string;
}

export const sendNotificationToUser = async (payload: NotifyPayload): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { pushTokens: true },
    });
    if (!user || !user.isActive) return;

    // Save in-app notification
    await prisma.notification.create({
      data: {
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        imageUrl: payload.imageUrl,
        type: 'stock_alert',
      },
    });

    // Save alert record
    await prisma.alert.create({
      data: {
        userId: payload.userId,
        storeProductId: payload.storeProductId,
        type: payload.type as any,
      },
    });

    // Send push notifications
    if (user.pushAlerts && user.pushTokens.length > 0) {
      for (const token of user.pushTokens) {
        await sendPushNotification(token, {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          image: payload.imageUrl,
        });
      }
    }

    // Send email notification
    if (user.emailAlerts) {
      await sendStockAlertEmail({
        to: user.email,
        name: user.name,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        imageUrl: payload.imageUrl,
      });
    }

    // Emit real-time socket notification (imported lazily to avoid circular deps)
    try {
      const { getIO } = await import('../socket/index');
      const io = getIO();
      io?.to(`user:${payload.userId}`).emit('notification', {
        title: payload.title,
        body: payload.body,
        url: payload.url,
      });
    } catch { /* Socket not always available */ }

    logger.info(`Notifications sent to user ${payload.userId}`);
  } catch (error) {
    logger.error('Send notification error', error);
  }
};
