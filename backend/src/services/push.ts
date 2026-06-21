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
  kind?: 'RESTOCK' | 'PRICE_DROP' | 'LOW_STOCK' | 'PICKUP';
  previousPrice?: number | null;
  pickupLocation?: string | null;
}

export async function sendPushAlert(payload: PushPayload): Promise<void> {
  const { userId, productName, storeName, productUrl, price, status, productSlug, kind, previousPrice, pickupLocation } = payload;

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️ VAPID keys not configured, skipping push notifications');
    return;
  }

  const subscriptions = await prisma.pushToken.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const priceStr = price ? ` — $${price.toFixed(2)}` : '';
  const isDrop = kind === 'PRICE_DROP';
  const isLow = kind === 'LOW_STOCK';
  const isPickup = kind === 'PICKUP';
  const statusLabel = status === 'LIMITED' ? 'Limited Stock' : status === 'PREORDER' ? 'Pre-order Available' : 'In Stock';
  const wasStr = previousPrice ? ` (was $${previousPrice.toFixed(2)})` : '';
  const pickupAt = pickupLocation ? `${storeName} (${pickupLocation})` : storeName;
  const title = isPickup
    ? `🏪 ${productName} ready for pickup`
    : isDrop
      ? `💸 Price drop: ${productName}`
      : isLow
        ? `⚠️ ${productName} is running low`
        : `🟢 ${productName} is ${statusLabel}!`;
  const body = isPickup
    ? `Available for in-store pickup at ${pickupAt}${priceStr}. Tap to reserve.`
    : isDrop
      ? `Now $${price?.toFixed(2) ?? '?'}${wasStr} at ${storeName}. Tap to shop.`
      : isLow
        ? `Limited stock at ${storeName}${priceStr}. Grab it before it sells out.`
        : `Available at ${storeName}${priceStr}. Tap to shop now.`;
  const tagPrefix = isPickup ? 'pickup' : isDrop ? 'pricedrop' : isLow ? 'lowstock' : 'stock';

  const notification = JSON.stringify({
    title,
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    url: productUrl,
    productSlug,
    tag: `${tagPrefix}-${productSlug}-${storeName.toLowerCase().replace(/\s/g, '-')}`,
    renotify: true,
    // Action buttons drawn on the notification itself. Platforms cap at
    // Notification.maxActions (usually 2), so we ship exactly two: jump to the
    // retailer, or snooze this item for a day.
    //   shop → opens the retailer product URL (data.url)
    //   mute → opens the app mute deep-link (data.muteUrl); the snooze is applied
    //          in-app where the auth token lives — the SW can't call the API.
    actions: [
      { action: 'shop', title: isDrop ? '💸 Buy now' : '🛒 Shop' },
      { action: 'mute', title: '🔕 Mute 1d' },
    ],
    data: {
      url: productUrl,
      productUrl,
      productSlug,
      // Relative path — the service worker resolves it against the app origin,
      // so it stays correct across dev / prod / custom domains.
      muteUrl: `/product/${productSlug}?mute=1d`,
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
