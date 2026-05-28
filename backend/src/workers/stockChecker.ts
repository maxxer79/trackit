import Bull from 'bull';
import { prisma } from '../config/database';
import { getScraperForStore } from '../scrapers/index';
import { sendNotifications } from '../services/notifications';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const stockCheckerQueue = new Bull('stock-checker', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
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

    const product = await prisma.product.findUnique({
      where: { id: productId, isActive: true },
      include: {
        storeListings: {
          where: { isActive: true },
          include: { store: true },
        },
      },
    });

    if (!product) return;

    const results = await Promise.allSettled(
      product.storeListings.map(async (listing) => {
        const storeSlug = listing.store.slug;
        const scraper = getScraperForStore(storeSlug);
        const startTime = Date.now();
        let logStatus = 'success';
        let logMessage: string | undefined;

        try {
          const result = await scraper.checkStock(listing.url, listing.id);

          const wasInStock = listing.inStock;
          const isNowInStock = result.status === 'IN_STOCK' || result.status === 'LIMITED';

          // Update store listing with latest stock info
          await prisma.storeProduct.update({
            where: { id: listing.id },
            data: {
              inStock: isNowInStock,
              price: result.price ?? listing.price,
              lastChecked: new Date(),
              checkCount: { increment: 1 },
            },
          });

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
                  },
                },
              },
            });

            // Send notifications to each tracker
            for (const tracker of trackers) {
              await sendNotifications({
                user: {
                  ...tracker.user,
                  notifyEmail: tracker.user.emailAlerts,
                  notifyPush: tracker.user.pushAlerts,
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

          await prisma.scraperLog.create({
            data: {
              storeSlug,
              productSlug: product.slug,
              status: logStatus,
              duration: Date.now() - startTime,
            },
          });

          return { listingId: listing.id, inStock: isNowInStock };
        } catch (error: any) {
          logStatus = error.response?.status === 429 ? 'blocked' : 'error';
          logMessage = error.message;

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

// Schedule all active products for checking
export async function scheduleAllProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const intervalMinutes = parseInt(process.env.SCRAPER_INTERVAL_MINUTES || '5');

  for (let i = 0; i < products.length; i++) {
    await stockCheckerQueue.add(
      { productId: products[i].id },
      {
        delay: i * 1000,
        repeat: { every: intervalMinutes * 60 * 1000 },
      }
    );
  }

  console.log(`Scheduled ${products.length} products for stock checking every ${intervalMinutes} minutes`);
}

export default stockCheckerQueue;
