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
      include: { storeLinks: { where: { isActive: true } } },
    });

    if (!product) return;

    const results = await Promise.allSettled(
      product.storeLinks.map(async (link) => {
        const scraper = getScraperForStore(link.storeSlug);
        const startTime = Date.now();
        let logStatus = 'success';
        let logMessage: string | undefined;

        try {
          const result = await scraper.checkStock(link.productUrl, link.storeProductId || undefined);
          const duration = Date.now() - startTime;

          // Get the store
          const store = await prisma.store.findUnique({ where: { slug: link.storeSlug } });
          if (!store) return;

          // Get previous status
          const prevStatus = await prisma.stockStatus.findUnique({
            where: { productId_storeId: { productId: product.id, storeId: store.id } },
          });

          // Update stock status
          const stockStatus = await prisma.stockStatus.upsert({
            where: { productId_storeId: { productId: product.id, storeId: store.id } },
            update: {
              status: result.status,
              price: result.price,
              productUrl: result.productUrl,
              lastCheckedAt: new Date(),
              checkCount: { increment: 1 },
              inStockAt: result.status === 'IN_STOCK' ? new Date() : undefined,
              outOfStockAt: result.status === 'OUT_OF_STOCK' ? new Date() : undefined,
            },
            create: {
              productId: product.id,
              storeId: store.id,
              status: result.status,
              price: result.price,
              productUrl: result.productUrl,
              inStockAt: result.status === 'IN_STOCK' ? new Date() : undefined,
              outOfStockAt: result.status === 'OUT_OF_STOCK' ? new Date() : undefined,
            },
          });

          // Check if status changed to IN_STOCK
          const wasOutOfStock = !prevStatus || prevStatus.status !== 'IN_STOCK';
          const isNowInStock = result.status === 'IN_STOCK' || result.status === 'LIMITED';

          if (wasOutOfStock && isNowInStock) {
            // Emit real-time update
            const { getIO } = await import('../socket/index');
            const io = getIO();
            io?.emit('stock-update', {
              productId: product.id,
              productSlug: product.slug,
              productName: product.name,
              storeSlug: link.storeSlug,
              storeName: store.name,
              status: result.status,
              price: result.price,
              productUrl: result.productUrl,
            });

            // Find all users tracking this product
            const trackers = await prisma.trackingItem.findMany({
              where: {
                productId: product.id,
                isActive: true,
                OR: [
                  { watchStores: { isEmpty: true } }, // watching all stores
                  { watchStores: { has: link.storeSlug } }, // watching this store
                ],
              },
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    notifyEmail: true,
                    notifySms: true,
                    notifyPush: true,
                    notifyDiscord: true,
                    phoneNumber: true,
                    discordWebhook: true,
                    autoBuyEnabled: true,
                    pushSubscriptions: true,
                  },
                },
              },
            });

            // Send notifications to each tracker
            for (const tracker of trackers) {
              await sendNotifications({
                user: tracker.user,
                product,
                storeSlug: link.storeSlug,
                storeName: store.name,
                productUrl: result.productUrl,
                price: result.price,
                status: result.status,
                autoBuyEnabled: tracker.autoBuyEnabled,
                autoBuyMaxPrice: tracker.autoBuyMaxPrice ? Number(tracker.autoBuyMaxPrice) : undefined,
              });
            }
          }

          await prisma.scraperLog.create({
            data: {
              storeSlug: link.storeSlug,
              productSlug: product.slug,
              status: logStatus,
              duration: Date.now() - startTime,
            },
          });

          return stockStatus;
        } catch (error: any) {
          logStatus = error.response?.status === 429 ? 'blocked' : 'error';
          logMessage = error.message;

          await prisma.scraperLog.create({
            data: {
              storeSlug: link.storeSlug,
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
    // Stagger jobs to avoid hammering all at once
    await stockCheckerQueue.add(
      { productId: products[i].id },
      {
        delay: i * 1000, // 1 second between each product start
        repeat: { every: intervalMinutes * 60 * 1000 },
      }
    );
  }

  console.log(`✅ Scheduled ${products.length} products for stock checking every ${intervalMinutes} minutes`);
}

export default stockCheckerQueue;
