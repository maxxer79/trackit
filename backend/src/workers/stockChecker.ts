import Bull from 'bull';
import { prisma } from '../config/database';
import { getScraperForStore } from '../scrapers/index';
import { isInStock, stockEventChanged } from '../scrapers/stockState';
import { isPriceDrop } from '../services/priceDrop';
import { sendNotifications } from '../services/notifications';
import { passesAlertRules } from '../services/alertRules';
import { ScraperError } from '../errors';
import { evaluateStaleness } from './workerHealth';
import logger from '../utils/logger';

/**
 * Redis connection config. Prefers discrete REDIS_HOST/PORT/PASSWORD env
 * vars over REDIS_URL — passwords with special characters (@ : / # ?)
 * break URL parsing and caused "max retries per request" at startup,
 * which silently killed all scheduled stock checks.
 */
function redisConfig() {
  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379'),
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379, password: undefined };
  }
}

export const stockCheckerQueue = new Bull('stock-checker', {
  redis: redisConfig(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

stockCheckerQueue.on('error', (err) => {
  logger.error('stock-checker queue (Redis) error', { error: err.message });
});

interface StockCheckJob {
  productId: string;
  priority?: number;
}

// Process stock check jobs
stockCheckerQueue.process(
  parseInt(process.env.SCRAPER_CONCURRENCY || '5'),
  async (job) => {
    const { productId } = job.data as StockCheckJob;
    const jobId = String(job.id);

    const product = await prisma.product.findUnique({
      where: { id: productId, isActive: true },
      include: {
        storeListings: {
          where: { isActive: true },
          include: { store: true },
        },
      },
    });

    if (!product) {
      logger.warn('stock-check job skipped — product missing or inactive', { jobId, productId });
      return;
    }

    logger.debug('stock-check job start', {
      jobId,
      productId,
      productSlug: product.slug,
      listings: product.storeListings.length,
    });

    const results = await Promise.allSettled(
      product.storeListings.map(async (listing) => {
        const storeSlug = listing.store.slug;
        const scraper = getScraperForStore(storeSlug, listing.url);
        const startTime = Date.now();
        let logStatus = 'success';
        let logMessage: string | undefined;
        // Correlation context attached to every log line for this listing check.
        const ctx = {
          jobId,
          productId: product.id,
          productSlug: product.slug,
          storeSlug,
          listingId: listing.id,
        };

        try {
          const result = await scraper.checkStock(listing.url, listing.id);

          // UNKNOWN means we couldn't determine status (bot-block, JS shell,
          // network error). NEVER flip stock status on UNKNOWN — keep the
          // last known value and just record that we checked.
          if (result.status === 'UNKNOWN') {
            await prisma.storeProduct.update({
              where: { id: listing.id },
              data: { lastChecked: new Date(), checkCount: { increment: 1 } },
            });
            await prisma.scraperLog.create({
              data: {
                storeSlug,
                productSlug: product.slug,
                status: 'unknown',
                message: result.message ?? 'status unknown — kept previous value',
                duration: Date.now() - startTime,
              },
            });
            logger.info('listing status unknown — kept previous value', {
              ...ctx,
              durationMs: Date.now() - startTime,
              message: result.message,
            });
            return { listingId: listing.id, inStock: listing.inStock };
          }

          const wasInStock = listing.inStock;
          // PREORDER counts as in stock — a sellable preorder is buyable.
          // (predicate extracted to scrapers/stockState.ts and unit-tested)
          const isNowInStock = isInStock(result.status);

          // Update store listing with latest stock info. `listing` still holds
          // the PREVIOUS values in memory (the update mutates the DB row, not
          // this object), so we can diff against it just below.
          await prisma.storeProduct.update({
            where: { id: listing.id },
            data: {
              inStock: isNowInStock,
              stockStatus: result.status,
              price: result.price ?? listing.price,
              lastChecked: new Date(),
              checkCount: { increment: 1 },
            },
          });

          // Record a history point when status OR price changed. This is what
          // populates StockEvent / the price-history chart from the SCHEDULED
          // path (previously only the admin/manual checker wrote these, so
          // history was sparse). Non-critical: never let it break the check.
          if (
            stockEventChanged(
              { status: listing.stockStatus, price: listing.price },
              { status: result.status, price: result.price ?? null }
            )
          ) {
            try {
              await prisma.stockEvent.create({
                data: {
                  productId: product.id,
                  storeProductId: listing.id,
                  storeName: listing.store.name,
                  storeSlug,
                  productName: product.name,
                  status: result.status,
                  price: result.price ?? listing.price ?? null,
                  productUrl: result.productUrl ?? listing.url,
                },
              });
            } catch (err: any) {
              logger.warn('failed to write stock event', { ...ctx, error: err.message });
            }
          }

          // If just came into stock, notify trackers
          if (!wasInStock && isNowInStock) {
            // Emit real-time update
            const { getIO } = await import('../socket/index');
            const io = getIO();
            io?.emit('stock-update', {
              productId: product.id,
              productSlug: product.slug,
              productName: product.name,
              storeSlug,
              storeName: listing.store.name,
              status: result.status,
              price: result.price,
              productUrl: listing.url,
            });

            // Find all users tracking this product
            const trackers = await prisma.tracking.findMany({
              where: {
                productId: product.id,
                isActive: true,
                OR: [
                  { watchStores: { isEmpty: true } },
                  { watchStores: { has: storeSlug } },
                ],
              },
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    emailAlerts: true,
                    notifySms: true,
                    pushAlerts: true,
                    notifyDiscord: true,
                    phoneNumber: true,
                    discordWebhook: true,
                    autoBuyEnabled: true,
                    quietHoursEnabled: true,
                    quietHoursStart: true,
                    quietHoursEnd: true,
                    timezone: true,
                  },
                },
              },
            });

            logger.info('restock detected — notifying trackers', {
              ...ctx,
              status: result.status,
              price: result.price,
              trackerCount: trackers.length,
            });

            // Send notifications to each tracker
            for (const tracker of trackers) {
              // Per-item advanced alert rules (price ceiling + allowed days).
              if (
                !passesAlertRules(
                  {
                    alertMaxPrice: tracker.alertMaxPrice != null ? Number(tracker.alertMaxPrice) : null,
                    alertDays: tracker.alertDays,
                  },
                  { price: result.price ?? null, timezone: tracker.user.timezone }
                )
              ) {
                continue;
              }
              await sendNotifications({
                user: {
                  ...tracker.user,
                  // Effective channel = user's global pref AND this item's opt-in.
                  notifyEmail: tracker.user.emailAlerts && tracker.notifyEmail,
                  notifyPush: tracker.user.pushAlerts && tracker.notifyPush,
                  autoBuyEnabled: tracker.user.autoBuyEnabled,
                },
                product,
                storeSlug,
                storeName: listing.store.name,
                productUrl: result.productUrl ?? listing.url,
                price: result.price,
                status: result.status,
                autoBuyEnabled: tracker.autoBuyEnabled,
                autoBuyMaxPrice: tracker.autoBuyMaxPrice ? Number(tracker.autoBuyMaxPrice) : undefined,
              });
            }
          }

          // Price-drop alerts (opt-in): in stock AND a meaningful drop vs the
          // previously stored price. Independent of the restock transition above.
          if (isInStock(result.status) && isPriceDrop(listing.price, result.price)) {
            const dropTrackers = await prisma.tracking.findMany({
              where: {
                productId: product.id,
                isActive: true,
                user: { notifyPriceDrop: true },
                OR: [
                  { watchStores: { isEmpty: true } },
                  { watchStores: { has: storeSlug } },
                ],
              },
              include: {
                user: {
                  select: {
                    id: true, email: true, name: true, emailAlerts: true,
                    notifySms: true, pushAlerts: true, notifyDiscord: true,
                    phoneNumber: true, discordWebhook: true, autoBuyEnabled: true,
                    quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true, timezone: true,
                  },
                },
              },
            });

            if (dropTrackers.length > 0) {
              logger.info('price drop detected — notifying trackers', {
                ...ctx,
                price: result.price,
                previousPrice: listing.price,
                trackerCount: dropTrackers.length,
              });

              const { getIO } = await import('../socket/index');
              getIO()?.emit('price-drop', {
                productId: product.id,
                productSlug: product.slug,
                productName: product.name,
                storeSlug,
                storeName: listing.store.name,
                status: result.status,
                price: result.price,
                previousPrice: listing.price,
                productUrl: result.productUrl ?? listing.url,
              });

              for (const tracker of dropTrackers) {
                if (
                  !passesAlertRules(
                    {
                      alertMaxPrice: tracker.alertMaxPrice != null ? Number(tracker.alertMaxPrice) : null,
                      alertDays: tracker.alertDays,
                    },
                    { price: result.price ?? null, timezone: tracker.user.timezone }
                  )
                ) {
                  continue;
                }
                await sendNotifications({
                  user: {
                    ...tracker.user,
                    // Effective channel = user's global pref AND this item's opt-in.
                    notifyEmail: tracker.user.emailAlerts && tracker.notifyEmail,
                    notifyPush: tracker.user.pushAlerts && tracker.notifyPush,
                    autoBuyEnabled: tracker.user.autoBuyEnabled,
                  },
                  product,
                  storeSlug,
                  storeName: listing.store.name,
                  productUrl: result.productUrl ?? listing.url,
                  price: result.price,
                  status: result.status,
                  kind: 'PRICE_DROP',
                  previousPrice: listing.price,
                });
              }
            }
          }

          // Low-stock alerts (opt-in): an item that WAS fully in stock has
          // dropped to LIMITED. Distinct from a restock (OUT→in already alerts)
          // — this is the "selling out, grab it" signal.
          if (listing.stockStatus === 'IN_STOCK' && result.status === 'LIMITED') {
            const lowTrackers = await prisma.tracking.findMany({
              where: {
                productId: product.id,
                isActive: true,
                user: { notifyLowStock: true },
                OR: [{ watchStores: { isEmpty: true } }, { watchStores: { has: storeSlug } }],
              },
              include: {
                user: {
                  select: {
                    id: true, email: true, name: true, emailAlerts: true,
                    notifySms: true, pushAlerts: true, notifyDiscord: true,
                    phoneNumber: true, discordWebhook: true, autoBuyEnabled: true,
                    quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true, timezone: true,
                  },
                },
              },
            });

            if (lowTrackers.length > 0) {
              logger.info('low stock detected — notifying trackers', {
                ...ctx,
                price: result.price,
                trackerCount: lowTrackers.length,
              });

              for (const tracker of lowTrackers) {
                if (
                  !passesAlertRules(
                    {
                      alertMaxPrice: tracker.alertMaxPrice != null ? Number(tracker.alertMaxPrice) : null,
                      alertDays: tracker.alertDays,
                    },
                    { price: result.price ?? null, timezone: tracker.user.timezone }
                  )
                ) {
                  continue;
                }
                await sendNotifications({
                  user: {
                    ...tracker.user,
                    notifyEmail: tracker.user.emailAlerts && tracker.notifyEmail,
                    notifyPush: tracker.user.pushAlerts && tracker.notifyPush,
                    autoBuyEnabled: tracker.user.autoBuyEnabled,
                  },
                  product,
                  storeSlug,
                  storeName: listing.store.name,
                  productUrl: result.productUrl ?? listing.url,
                  price: result.price,
                  status: result.status,
                  kind: 'LOW_STOCK',
                });
              }
            }
          }

          await prisma.scraperLog.create({
            data: {
              storeSlug,
              productSlug: product.slug,
              status: logStatus,
              duration: Date.now() - startTime,
            },
          });

          logger.debug('listing checked', {
            ...ctx,
            status: result.status,
            inStock: isNowInStock,
            durationMs: Date.now() - startTime,
          });

          return { listingId: listing.id, inStock: isNowInStock };
        } catch (error: any) {
          // Classify from the ORIGINAL error first so HTTP 429 → 'blocked' is
          // preserved, then wrap as a typed ScraperError for a stable log code.
          logStatus = error.response?.status === 429 ? 'blocked' : 'error';
          logMessage = error.message;
          const scraperError =
            error instanceof ScraperError ? error : new ScraperError(error.message, { storeSlug, cause: error });

          logger.warn('listing check failed', {
            ...ctx,
            code: scraperError.code,
            logStatus,
            durationMs: Date.now() - startTime,
            error: logMessage,
          });

          await prisma.scraperLog.create({
            data: {
              storeSlug,
              productSlug: product.slug,
              status: logStatus,
              message: logMessage,
              duration: Date.now() - startTime,
            },
          });
        }
      })
    );

    return results;
  }
);

// Schedule all active products for checking.
//
// Idempotent: every existing repeatable is cleared first, then each product is
// (re)scheduled with a STABLE jobId. Without this, re-running on every boot (or
// changing SCRAPER_INTERVAL_MINUTES) could leave orphaned repeatable schedulers
// firing for the same product — checking it more often than intended and
// amplifying bot-blocks. A stable jobId makes the repeat key deterministic so a
// product can only ever have one active schedule.
export async function scheduleAllProducts() {
  const intervalMinutes = parseInt(process.env.SCRAPER_INTERVAL_MINUTES || '5', 10);

  // Clear any pre-existing repeatables (orphans from prior boots / interval changes).
  const existing = await stockCheckerQueue.getRepeatableJobs();
  for (const r of existing) {
    await stockCheckerQueue.removeRepeatableByKey(r.key);
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const p of products) {
    await stockCheckerQueue.add(
      { productId: p.id },
      {
        jobId: `product:${p.id}`, // stable → re-scheduling is idempotent
        repeat: { every: intervalMinutes * 60 * 1000 },
      }
    );
  }

  logger.info('scheduled products for stock checking', {
    count: products.length,
    intervalMinutes,
    clearedRepeatables: existing.length,
  });
}

/**
 * Liveness/health of the worker itself (not just the HTTP server). Surfaced at
 * GET /health/worker so a monitor can detect a silently-dead scheduler — Redis
 * unreachable, or no scrape recorded within ~3 cycles.
 */
export async function getWorkerHealth() {
  const intervalMinutes = parseInt(process.env.SCRAPER_INTERVAL_MINUTES || '5', 10);

  let redisOk = true;
  // Derive the type straight from the method so it can't drift from Bull's API.
  let counts: Awaited<ReturnType<typeof stockCheckerQueue.getJobCounts>> | null = null;
  try {
    counts = await stockCheckerQueue.getJobCounts();
  } catch {
    redisOk = false;
  }

  let lastCheckAt: Date | null = null;
  try {
    const last = await prisma.scraperLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    lastCheckAt = last?.createdAt ?? null;
  } catch {
    lastCheckAt = null;
  }

  const { stale, ageMs, staleAfterMs } = evaluateStaleness(lastCheckAt, intervalMinutes);
  return {
    healthy: redisOk && !stale,
    redisOk,
    stale,
    lastCheckAt,
    lastCheckAgeMs: ageMs,
    staleAfterMs,
    intervalMinutes,
    counts,
  };
}

export default stockCheckerQueue;
