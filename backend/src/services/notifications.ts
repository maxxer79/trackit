import { prisma } from '../config/database';
import { sendEmailAlert } from './email';
import { sendSmsAlert } from './sms';
import { sendPushAlert } from './push';
import { sendDiscordAlert } from './discord';
import logger from '../utils/logger';
import { NotificationError } from '../errors';
import { autoBuyOutcome } from './autoBuy';
import { isQuietNow } from './quietHours';

/**
 * A single notification channel failing must not block the others, so per-channel
 * errors are logged (as a typed NotificationError) rather than thrown.
 */
function logChannelFailure(
  channel: string,
  userId: string,
  productSlug: string,
  err: { message?: string }
): void {
  const e = new NotificationError(`${channel} alert failed`, { channel, cause: err?.message });
  logger.warn(e.message, { code: e.code, channel, userId, productSlug, error: err?.message });
}

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
    quietHoursEnabled?: boolean;
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
    timezone?: string | null;
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
  // 'PRICE_DROP' / 'LOW_STOCK' reuse this whole pipeline with flavored messaging.
  kind?: 'RESTOCK' | 'PRICE_DROP' | 'LOW_STOCK';
  previousPrice?: number | null;
  // Restock-proof screenshot filename (captured once per restock, shared across
  // all trackers notified for that event).
  screenshotPath?: string | null;
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
    previousPrice,
  } = payload;
  const kind = payload.kind ?? 'RESTOCK';

  // Quiet hours suppress the external pings (email/sms/push/discord) but NOT the
  // recorded Alert, the realtime socket event, or AutoBuy — you still see it in
  // the app, you just don't get pinged at 3am.
  const quiet = isQuietNow({
    quietHoursEnabled: !!user.quietHoursEnabled,
    quietHoursStart: user.quietHoursStart ?? null,
    quietHoursEnd: user.quietHoursEnd ?? null,
    timezone: user.timezone ?? null,
  });
  if (quiet) {
    logger.info('external notifications suppressed — quiet hours', {
      userId: user.id,
      productSlug: product.slug,
      kind,
    });
  }

  const results: Promise<void>[] = [];

  // Email notification
  if (!quiet && user.notifyEmail && user.email) {
    results.push(
      sendEmailAlert({
        to: user.email,
        name: user.name || 'there',
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
        kind,
        previousPrice,
      }).catch((err) => logChannelFailure('email', user.id, product.slug, err))
    );
  }

  // SMS notification
  if (!quiet && user.notifySms && user.phoneNumber) {
    results.push(
      sendSmsAlert({
        to: user.phoneNumber,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
        kind,
        previousPrice,
      }).catch((err) => logChannelFailure('sms', user.id, product.slug, err))
    );
  }

  // Web Push notification
  if (!quiet && user.notifyPush) {
    results.push(
      sendPushAlert({
        userId: user.id,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
        productSlug: product.slug,
        kind,
        previousPrice,
      }).catch((err) => logChannelFailure('push', user.id, product.slug, err))
    );
  }

  // Discord webhook notification
  if (!quiet && user.notifyDiscord && user.discordWebhook) {
    results.push(
      sendDiscordAlert({
        webhookUrl: user.discordWebhook,
        productName: product.name,
        storeName,
        productUrl,
        price,
        status,
        kind,
        previousPrice,
      }).catch((err) => logChannelFailure('discord', user.id, product.slug, err))
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
        type: kind === 'PRICE_DROP' ? 'PRICE_DROP' : kind === 'LOW_STOCK' ? 'LOW_STOCK' : 'IN_STOCK',
        status: status as any,
        price,
        productUrl,
        emailSent: user.notifyEmail && !!user.email,
        smsSent: user.notifySms && !!user.phoneNumber,
        pushSent: user.notifyPush,
        discordSent: user.notifyDiscord && !!user.discordWebhook,
        screenshotPath: payload.screenshotPath ?? null,
      },
    });
  } catch (err: any) {
    logger.error('failed to log alert', {
      userId: user.id,
      productSlug: product.slug,
      error: err.message,
    });
  }

  // AutoBuy — restock-only (a price drop on an already-in-stock item shouldn't
  // trigger a buy). Execution is still a stub, but EVERY evaluation for an
  // enabled user is written to the AutoBuyAttempt audit trail.
  if (kind === 'RESTOCK' && autoBuyEnabled && user.autoBuyEnabled) {
    const outcome = autoBuyOutcome(price, autoBuyMaxPrice);

    try {
      await prisma.autoBuyAttempt.create({
        data: {
          userId: user.id,
          productId: product.id,
          storeSlug: payload.storeSlug,
          storeName,
          productUrl,
          price: price ?? null,
          maxPrice: autoBuyMaxPrice ?? null,
          outcome,
          message:
            outcome === 'SKIPPED_OVER_MAX'
              ? `price ${price} exceeded max ${autoBuyMaxPrice}`
              : 'auto-buy conditions met (execution not yet implemented)',
        },
      });
    } catch (err: any) {
      logger.error('failed to record autobuy attempt', {
        userId: user.id,
        productSlug: product.slug,
        error: err.message,
      });
    }

    if (outcome === 'TRIGGERED') {
      logger.info('autobuy triggered', {
        userId: user.id,
        productName: product.name,
        storeName,
        price: price ?? null,
        maxPrice: autoBuyMaxPrice ?? null,
      });
      // TODO: Integrate with store-specific add-to-cart automation
      // This is intentionally left as a stub — full browser automation
      // (Puppeteer/Playwright) would be wired here per store
    }
  }
}
