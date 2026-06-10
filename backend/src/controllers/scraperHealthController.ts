/**
 * Scraper health checks — lets the admin verify each retailer's scraper
 * with a green/red light, individually or all at once.
 *
 *   green = scraper reached the site and got a definitive answer
 *           (IN_STOCK / OUT_OF_STOCK / LIMITED / PREORDER)
 *   red   = scraper could not determine status (bot-blocked, JS shell,
 *           network error, markup change) or threw an error
 *   gray  = store has no product listings to test against
 */
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { getScraperForStore } from '../scrapers/index';
import logger from '../utils/logger';

const PER_STORE_TIMEOUT_MS = 100000; // browser/FlareSolverr fallbacks queue up and can take 60s+

export interface ScraperTestResult {
  storeSlug: string;
  storeName: string;
  light: 'green' | 'red' | 'gray';
  status: string;
  price?: number;
  message?: string;
  testedUrl?: string;
  productName?: string;
  durationMs: number;
}

async function runTestForStore(storeSlug: string): Promise<ScraperTestResult> {
  const start = Date.now();

  const store = await prisma.store.findUnique({ where: { slug: storeSlug } });
  const storeName = store?.name ?? storeSlug;

  // Pick a sample listing for this store — most recently checked first so we
  // test the same kind of URL the scheduler actually uses.
  const listing = await prisma.storeProduct.findFirst({
    where: { store: { slug: storeSlug }, isActive: true, url: { not: '' } },
    orderBy: { lastChecked: 'desc' },
    include: { product: true },
  });

  if (!listing || !listing.url) {
    return {
      storeSlug,
      storeName,
      light: 'gray',
      status: 'NO_LISTINGS',
      message: 'No product listings to test for this store',
      durationMs: Date.now() - start,
    };
  }

  try {
    const scraper = getScraperForStore(storeSlug);

    const result = await Promise.race([
      scraper.checkStock(listing.url, listing.id),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${PER_STORE_TIMEOUT_MS / 1000}s`)), PER_STORE_TIMEOUT_MS)
      ),
    ]);

    const definitive =
      result.status === 'IN_STOCK' ||
      result.status === 'OUT_OF_STOCK' ||
      result.status === 'LIMITED' ||
      result.status === 'PREORDER';

    return {
      storeSlug,
      storeName,
      light: definitive ? 'green' : 'red',
      status: result.status,
      price: result.price,
      message: definitive
        ? `Scraper working — site reports ${result.status.replace(/_/g, ' ').toLowerCase()}`
        : result.message ?? 'Could not determine stock status (likely bot-blocked or JS-rendered page)',
      testedUrl: listing.url,
      productName: listing.product?.name,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      storeSlug,
      storeName,
      light: 'red',
      status: 'ERROR',
      message: error.message,
      testedUrl: listing.url,
      productName: listing.product?.name,
      durationMs: Date.now() - start,
    };
  }
}

/** POST /admin/scrapers/:slug/test — test one store's scraper */
export const testScraper = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    logger.info(`[ScraperHealth] Testing scraper for ${slug}`);
    const result = await runTestForStore(slug);
    res.json(result);
  } catch (error: any) {
    logger.error('testScraper error', error);
    res.status(500).json({ error: 'Scraper test failed', message: error.message });
  }
};

/** POST /admin/scrapers/test-all — test every store that has listings */
export const testAllScrapers = async (req: Request, res: Response): Promise<void> => {
  try {
    // Only test stores that actually have active listings
    const stores = await prisma.store.findMany({
      where: { isActive: true, products: { some: { isActive: true } } },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true },
    });

    logger.info(`[ScraperHealth] Testing ${stores.length} store scrapers`);

    // Run in small batches so we don't hammer the box (eBay uses a browser)
    const results: ScraperTestResult[] = [];
    const BATCH = 4;
    for (let i = 0; i < stores.length; i += BATCH) {
      const batch = stores.slice(i, i + BATCH);
      const settled = await Promise.allSettled(batch.map((s) => runTestForStore(s.slug)));
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        if (s.status === 'fulfilled') {
          results.push(s.value);
        } else {
          results.push({
            storeSlug: batch[j].slug,
            storeName: batch[j].slug,
            light: 'red',
            status: 'ERROR',
            message: String(s.reason?.message ?? s.reason),
            durationMs: 0,
          });
        }
      }
    }

    const green = results.filter((r) => r.light === 'green').length;
    const red = results.filter((r) => r.light === 'red').length;
    const gray = results.filter((r) => r.light === 'gray').length;

    res.json({ summary: { total: results.length, green, red, gray }, results });
  } catch (error: any) {
    logger.error('testAllScrapers error', error);
    res.status(500).json({ error: 'Scraper test-all failed', message: error.message });
  }
};
