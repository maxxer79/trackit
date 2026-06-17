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
import { classifyHealth, ScraperHealthLabel } from '../scrapers/health';
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
    const scraper = getScraperForStore(storeSlug, listing.url);

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

export interface ScraperHealthRow {
  storeSlug: string;
  storeName: string;
  isActive: boolean;
  total: number;
  success: number;
  unknown: number;
  blocked: number;
  error: number;
  successRate: number | null;
  avgDurationMs: number | null;
  lastSuccessAt: Date | null;
  lastCheckedAt: Date | null;
  health: ScraperHealthLabel;
}

/**
 * GET /admin/scrapers/health?hours=24 — aggregate the ScraperLog rows the
 * scheduled worker writes into a per-retailer health view (success rate, last
 * success, avg response time). Advisory only — it never disables a scraper.
 */
export const getScraperHealth = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? '24'), 10) || 24, 1), 24 * 30);
    const since = new Date(Date.now() - hours * 3_600_000);

    const [byStatus, totals, lastSuccess, lastAttempt, stores] = await Promise.all([
      prisma.scraperLog.groupBy({
        by: ['storeSlug', 'status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.scraperLog.groupBy({
        by: ['storeSlug'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { duration: true },
      }),
      prisma.scraperLog.groupBy({
        by: ['storeSlug'],
        where: { status: 'success' },
        _max: { createdAt: true },
      }),
      prisma.scraperLog.groupBy({
        by: ['storeSlug'],
        _max: { createdAt: true },
      }),
      prisma.store.findMany({ where: { isActive: true }, select: { slug: true, name: true, isActive: true } }),
    ]);

    const totalsBy = new Map(totals.map((t) => [t.storeSlug, t]));
    const lastSuccessBy = new Map(lastSuccess.map((t) => [t.storeSlug, t._max.createdAt]));
    const lastAttemptBy = new Map(lastAttempt.map((t) => [t.storeSlug, t._max.createdAt]));
    const nameBy = new Map(stores.map((s) => [s.slug, s.name]));
    const activeBy = new Map(stores.map((s) => [s.slug, s.isActive]));

    const statusBy = new Map<string, Record<string, number>>();
    for (const row of byStatus) {
      const m = statusBy.get(row.storeSlug) ?? {};
      m[row.status] = row._count._all;
      statusBy.set(row.storeSlug, m);
    }

    // Union of active stores and any store that has logs in the window.
    const slugs = new Set<string>([...stores.map((s) => s.slug), ...statusBy.keys()]);

    const rows: ScraperHealthRow[] = [...slugs].map((slug) => {
      const counts = statusBy.get(slug) ?? {};
      const success = counts.success ?? 0;
      const unknown = counts.unknown ?? 0;
      const blocked = counts.blocked ?? 0;
      const error = counts.error ?? 0;
      const total = totalsBy.get(slug)?._count._all ?? success + unknown + blocked + error;
      const avg = totalsBy.get(slug)?._avg.duration ?? null;
      return {
        storeSlug: slug,
        storeName: nameBy.get(slug) ?? slug,
        isActive: activeBy.get(slug) ?? true,
        total,
        success,
        unknown,
        blocked,
        error,
        successRate: total > 0 ? success / total : null,
        avgDurationMs: avg != null ? Math.round(avg) : null,
        lastSuccessAt: lastSuccessBy.get(slug) ?? null,
        lastCheckedAt: lastAttemptBy.get(slug) ?? null,
        health: classifyHealth(total, success),
      };
    });

    // Worst first so problems surface at the top.
    const order: Record<ScraperHealthLabel, number> = { down: 0, degraded: 1, healthy: 2, no_data: 3 };
    rows.sort(
      (a, b) => order[a.health] - order[b.health] || (a.successRate ?? 1) - (b.successRate ?? 1)
    );

    res.json({ windowHours: hours, generatedAt: new Date().toISOString(), stores: rows });
  } catch (error: any) {
    logger.error('getScraperHealth error', error);
    res.status(500).json({ error: 'Failed to compute scraper health', message: error.message });
  }
};
