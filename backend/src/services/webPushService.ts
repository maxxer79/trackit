import webPush from 'web-push';
import logger from '../utils/logger';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@trackit.io'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  image?: string;
}

export const sendPushNotification = async (
  token: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<void> => {
  try {
    await webPush.sendNotification(
      { endpoint: token.endpoint, keys: { p256dh: token.p256dh, auth: token.auth } },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        url: payload.url || '/',
        image: payload.image,
        data: { url: payload.url },
      })
    );
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      // Token expired - should remove from DB
      logger.warn(`Push token expired: ${token.endpoint}`);
    } else {
      logger.error('Push notification error', error);
    }
  }
};
