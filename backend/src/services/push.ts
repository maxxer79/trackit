import webpush from 'web-push';
import { prisma } from '../config/database';

// Configure VAPID keys (set once at module load)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'alerts@trackit.app'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface PushPayload {
  userId: string;
  productName: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
  productSlug: string;
}

export async function sendPushAlert(payload: PushPayload): Promise<void> {
  const { userId, productName, storeName, productUrl, price, status, productSlug } = payload;

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️ VAPID keys not configured, skipping push notifications');
    return;
  }

  const subscriptions = await prisma.pushToken.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const priceStr = price ? ` — $${price.toFixed(2)}` : '';
  const statusLabel = status === 'LIMITED' ? 'Limited Stock' : status === 'PREORDER' ? 'Pre-order Available' : 'In Stock';

  const notification = JSON.stringify({
    title: `🟢 ${productName} is ${statusLabel}!`,
    body: `Available at ${storeName}${priceStr}. Tap to shop now.`,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    url: productUrl,
    productSlug,
    tag: `stock-${productSlug}-${storeName.toLowerCase().replace(/\s/g, '-')}`,
    data: {
      productUrl,
      productSlug,
    },
  });

  const sendPromises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        notification
      );
    } catch (error: any) {
      // 410 Gone or 404 Not Found = subscription expired, clean it up
      if (error.statusCode === 410 || error.statusCode === 404) {
        await prisma.pushToken.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        console.error(`Push notification failed for subscription ${sub.id}:`, error.message);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}
