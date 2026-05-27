import cron from 'node-cron';
import axios from 'axios';
import { prisma } from '../config/database';
import { sendNotificationToUser } from './notificationService';
import logger from '../utils/logger';

export const checkStockForProduct = async (storeProductId: string): Promise<void> => {
  try {
    const sp = await prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: { product: true, store: true },
    });
    if (!sp) return;

    // Simulate stock check (in production, replace with real scraper per store)
    const wasInStock = sp.inStock;
    // Randomize for demo; real impl would HTTP-check the URL
    const nowInStock = Math.random() > 0.6;

    await prisma.storeProduct.update({
      where: { id: storeProductId },
      data: { inStock: nowInStock, lastChecked: new Date(), checkCount: { increment: 1 } },
    });

    // If stock changed from out → in, notify all trackers
    if (!wasInStock && nowInStock) {
      const trackings = await prisma.tracking.findMany({
        where: { productId: sp.productId, isActive: true },
        include: { user: true },
      });

      for (const tracking of trackings) {
        await sendNotificationToUser({
          userId: tracking.userId,
          title: `${sp.product.name} is now IN STOCK!`,
          body: `Available at ${sp.store.name}${sp.price ? ` for $${sp.price}` : ''}. Tap to buy now!`,
          url: sp.url,
          imageUrl: sp.product.imageUrl || undefined,
          storeProductId: sp.id,
          type: 'IN_STOCK',
        });
      }

      logger.info(`Stock alert sent for ${sp.product.name} at ${sp.store.name}`);
    }
  } catch (error) {
    logger.error(`Stock check error for ${storeProductId}`, error);
  }
};

export const runStockCheck = async (): Promise<void> => {
  try {
    const storeProducts = await prisma.storeProduct.findMany({
      where: {
        product: { isActive: true },
        store: { isActive: true },
      },
      select: { id: true },
    });

    logger.info(`Running stock check for ${storeProducts.length} listings`);

    // Check in batches of 10
    for (let i = 0; i < storeProducts.length; i += 10) {
      const batch = storeProducts.slice(i, i + 10);
      await Promise.allSettled(batch.map(sp => checkStockForProduct(sp.id)));
      // Small delay between batches to avoid overwhelming targets
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (error) {
    logger.error('Run stock check error', error);
  }
};

export const startStockChecker = (): void => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Stock checker triggered');
    await runStockCheck();
  });

  // Run immediately on startup after 10s delay
  setTimeout(runStockCheck, 10000);

  logger.info('Stock checker started (every 5 minutes)');
};
