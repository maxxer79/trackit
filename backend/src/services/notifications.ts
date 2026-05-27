import { prisma } from '../config/database';
import { sendEmailAlert } from './email';
import { sendSmsAlert } from './sms';
import { sendPushAlert } from './push';
import { sendDiscordAlert } from './discord';

interface NotificationPayload {
  user: {
    id: string;
    email: string;
    name: string | null;
    notifyEmail: boolean;
    notifySms: boolean;
    notifyPush: boolean;
    notifyDiscord: boolean;
    phoneNumber: string | null;
    discordWebhook: string | null;
    autoBuyEnabled: boolean;
    pushSubscriptions?: any[];
  };
  product: {
    id: string;
    name: string;
    slug: string;
  };
  storeSlug: string;
  storeName: string;
  productUrl: string;
  price?: number | null;
  status: string;
  autoBuyEnabled?: boolean;
  autoBuyMaxPrice?: number;
}

export async function sendNotifications(payload: NotificationPayload): Promise<void> {
  const {
    user,
    product,
    storeName,
    productUrl,
    price,
    status,
    autoBuyEnabled,
    autoBuyMaxPrice,
  } = payload;

  const results: Promise<void>[] = [];

  // Email notification
  if (user.notifyEmail && user.email) {
    results.push(
      sendEmailAlert({
        to: user.email,
        name: user.name || 'there',
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
      }).catch((err) => console.error('Email alert failed:', err.message))
    );
  }

  // SMS notification
  if (user.notifySms && user.phoneNumber) {
    results.push(
      sendSmsAlert({
        to: user.phoneNumber,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
      }).catch((err) => console.error('SMS alert failed:', err.message))
    );
  }

  // Web Push notification
  if (user.notifyPush) {
    results.push(
      sendPushAlert({
        userId: user.id,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
        productSlug: product.slug,
      }).catch((err) => console.error('Push alert failed:', err.message))
    );
  }

  // Discord webhook notification
  if (user.notifyDiscord && user.discordWebhook) {
    results.push(
      sendDiscordAlert({
        webhookUrl: user.discordWebhook,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
      }).catch((err) => console.error('Discord alert failed:', err.message))
    );
  }

  // Fire all notifications in parallel
  await Promise.allSettled(results);

  // Record alert in database
  try {
    await prisma.alert.create({
      data: {
        userId: user.id,
        productId: product.id,
        storeSlug: payload.storeSlug,
        storeName,
        status: status as any,
        price,
        productUrl,
        emailSent: user.notifyEmail && !!user.email,
        smsSent: user.notifySms && !!user.phoneNumber,
        pushSent: user.notifyPush,
        discordSent: user.notifyDiscord && !!user.discordWebhook,
      },
    });
  } catch (err: any) {
    console.error('Failed to log alert:', err.message);
  }

  // AutoBuy logic — log attempt if enabled and within price limit
  if (autoBuyEnabled && user.autoBuyEnabled) {
    const priceOk = !autoBuyMaxPrice || !price || price <= autoBuyMaxPrice;
    if (priceOk) {
      console.log(`🛒 AutoBuy triggered for ${user.email} — ${product.name} at ${storeName} ($${price ?? 'N/A'})`);
      // TODO: Integrate with store-specific add-to-cart automation
      // This is intentionally left as a stub — full browser automation
      // (Puppeteer/Playwright) would be wired here per store
    }
  }
}
