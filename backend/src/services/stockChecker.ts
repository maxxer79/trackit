import cron from 'node-cron';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../config/database';
import { sendNotificationToUser } from './notificationService';
import logger from '../utils/logger';

// User agents to rotate and avoid bot detection
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Patterns that indicate IN STOCK
const IN_STOCK_PATTERNS = [
  /"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"/i,
  /"availability"\s*:\s*"InStock"/i,
  /itemAvailability.*?InStock/i,
  /inStock.*?true/i,
  /"inStock"\s*:\s*true/i,
  /add to cart/i,
  /add to bag/i,
  /buy now/i,
  /in stock/i,
  /ships? (today|tomorrow|in \d)/i,
  /ready to ship/i,
  /available for purchase/i,
];

// Patterns that indicate OUT OF STOCK
const OUT_OF_STOCK_PATTERNS = [
  /"availability"\s*:\s*"https?:\/\/schema\.org\/OutOfStock"/i,
  /"availability"\s*:\s*"OutOfStock"/i,
  /out of stock/i,
  /sold out/i,
  /currently unavailable/i,
  /temporarily out of stock/i,
  /not available/i,
  /notify me when available/i,
  /"inStock"\s*:\s*false/i,
  /join waitlist/i,
];

async function checkUrl(url: string): Promise<'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'> {
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
      maxRedirects: 5,
    });

    const html: string = response.data;

    // Check out-of-stock first (higher priority)
    for (const pattern of OUT_OF_STOCK_PATTERNS) {
      if (pattern.test(html)) {
        return 'OUT_OF_STOCK';
      }
    }

    // Check in-stock
    for (const pattern of IN_STOCK_PATTERNS) {
      if (pattern.test(html)) {
        return 'IN_STOCK';
      }
    }

    return 'UNKNOWN';
  } catch (err: any) {
    logger.warn(`checkUrl failed for ${url}: ${err.message}`);
    return 'UNKNOWN';
  }
}

export async function fetchProductImage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': randomUA() },
      maxRedirects: 5,
    });
    const $ = cheerio.load(response.data);

    // Try og:image first (most reliable)
    const ogImage = $('meta[property="og:image"]').attr('content') ||
                    $('meta[name="og:image"]').attr('content') ||
                    $('meta[property="twitter:image"]').attr('content');

    if (ogImage) return ogImage;

    // Try common product image selectors
    const selectors = [
      '#landingImage',           // Amazon
      '.primary-image img',
      '#main-product-image img',
      '.product-image img',
      '[data-main-image]',
      'img[itemprop="image"]',
      '.product__image img',
    ];

    for (const sel of selectors) {
      const src = $(sel).first().attr('src') || $(sel).first().attr('data-src');
      if (src && src.startsWith('http')) return src;
    }

    return null;
  } catch {
    return null;
  }
}

export const checkStockForProduct = async (storeProductId: string): Promise<void> => {
  try {
    const sp = await prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: { product: true, store: true },
    });
    if (!sp) return;

    const wasInStock = sp.inStock;
    let nowInStock: boolean;

    if (sp.url) {
      const status = await checkUrl(sp.url);
      if (status === 'UNKNOWN') {
        // Don't change what we don't know — just update lastChecked
        await prisma.storeProduct.update({
          where: { id: storeProductId },
          data: { lastChecked: new Date(), checkCount: { increment: 1 } },
        });
        return;
      }
      nowInStock = status === 'IN_STOCK';
    } else {
      // No URL to check — skip
      return;
    }

    await prisma.storeProduct.update({
      where: { id: storeProductId },
      data: { inStock: nowInStock, lastChecked: new Date(), checkCount: { increment: 1 } },
    });

    // Log stock status change
    if (wasInStock !== nowInStock) {
      await (prisma as any).stockEvent.create({
        data: {
          productId: sp.productId,
          storeProductId: sp.id,
          storeName: sp.store.name,
          storeSlug: sp.store.slug,
          productName: sp.product.name,
          status: nowInStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
          price: sp.price ?? null,
          productUrl: sp.url,
        },
      });
    }

    // If stock just came back in, notify all trackers
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
        isActive: true,
      },
      select: { id: true },
    });

    logger.info(`Running stock check for ${storeProducts.length} listings`);

    // Check in batches of 5 with delay to avoid overwhelming targets
    for (let i = 0; i < storeProducts.length; i += 5) {
      const batch = storeProducts.slice(i, i + 5);
      await Promise.allSettled(batch.map(sp => checkStockForProduct(sp.id)));
      if (i + 5 < storeProducts.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    logger.info('Stock check complete');
  } catch (error) {
    logger.error('Run stock check error', error);
  }
};

export const startStockChecker = (): void => {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Stock checker triggered');
    await runStockCheck();
  });

  // Run after 30s delay on startup
  setTimeout(runStockCheck, 30000);

  logger.info('Stock checker started (every 15 minutes)');
};
