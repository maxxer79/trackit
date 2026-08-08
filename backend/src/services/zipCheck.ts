/**
 * On-demand multi-ZIP price & availability checks.
 *
 * The user supplies a product URL and a handful of ZIPs; we resolve each ZIP to
 * that retailer's nearest store and scrape once per store, in parallel.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------
 * 1. Never present an unresolved ZIP's price. If storeLocator can't map a ZIP to
 *    a store, the scraper would silently answer from its default store. We
 *    return locationResolved:false and NO price rather than a plausible lie.
 *
 * 2. Never touch the normal price history. Results land in ZipPriceCheck, which
 *    nothing in priceAnalytics reads. Multi-ZIP prices in StockEvent would skew
 *    the time-weighted average behind the good-deal badge and target-price
 *    suggestions.
 */
import { createHash } from 'crypto';
import type { LocationContext, StockStatus, ZipCheckResult } from '@shared';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { getScraperForStore, storeSlugFromUrl } from '../scrapers';
import { isValidUsZip, normalizeZip } from './pickup';
import { isZipCheckSupported, locatorConfidence, resolveStore, ZIP_CHECK_STORES } from './storeLocator';

/** Hard cap per request — each ZIP is a separate scrape against one retailer. */
export const MAX_ZIPS_PER_CHECK = 5;

/** Results younger than this are served from cache instead of re-scraping. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ZipCheckInput {
  productUrl: string;
  zips: string[];
  /** Optional retailer item id, passed through to the scraper. */
  storeProductId?: string;
  /** Skip the cache and force a live scrape. */
  force?: boolean;
}

export class UnsupportedRetailerError extends Error {
  constructor(public readonly host: string | null) {
    super(
      host
        ? `ZIP price checks aren't supported for ${host}. Supported: ${ZIP_CHECK_STORES.join(', ')}.`
        : 'Could not identify a retailer from that URL.'
    );
    this.name = 'UnsupportedRetailerError';
  }
}

const urlKeyOf = (url: string) => createHash('sha256').update(url).digest('hex');

/** Dedupe, validate and cap the requested ZIPs. Order is preserved. */
export function normalizeZips(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const z = normalizeZip(r);
    if (!z || !isValidUsZip(z) || seen.has(z)) continue;
    seen.add(z);
    out.push(z);
    if (out.length >= MAX_ZIPS_PER_CHECK) break;
  }
  return out;
}

/** Check one ZIP: resolve the store, then scrape from it. */
async function checkOneZip(
  storeSlug: string,
  zip: string,
  productUrl: string,
  storeProductId: string | undefined
): Promise<ZipCheckResult> {
  const base = { zip, storeSlug, checkedAt: new Date().toISOString(), cached: false };

  const store = await resolveStore(storeSlug, zip);
  if (!store) {
    // Rule 1: no store, no price. Scraping now would answer from the default
    // store and we'd label it with this ZIP.
    return {
      ...base,
      status: 'UNKNOWN' as StockStatus,
      locationResolved: false,
      message: `Couldn't find a ${storeSlug} store for ${zip} — no price shown rather than a possibly wrong one.`,
    };
  }

  const location: LocationContext = {
    zip,
    storeId: store.storeId,
    state: store.state,
    latitude: store.latitude,
    longitude: store.longitude,
    storeName: store.storeName,
  };

  try {
    const scraper = getScraperForStore(storeSlug, productUrl);
    const result = await scraper.checkStock(productUrl, storeProductId, location);

    return {
      ...base,
      storeId: store.storeId,
      storeName: store.storeName,
      status: result.status,
      price: result.price,
      pickupAvailable: result.pickupAvailable,
      pickupLocation: result.pickupLocation,
      locationResolved: true,
      message:
        result.message ??
        (locatorConfidence(storeSlug) === 'unverified'
          ? 'Store lookup for this retailer is not yet verified against live traffic — sanity-check the store name.'
          : undefined),
    };
  } catch (err: unknown) {
    logger.warn(`[zipCheck] ${storeSlug} ${zip} scrape failed: ${(err as Error)?.message}`);
    return {
      ...base,
      storeId: store.storeId,
      storeName: store.storeName,
      status: 'UNKNOWN' as StockStatus,
      locationResolved: true,
      message: (err as Error)?.message ?? 'Check failed',
    };
  }
}

/** Read any cached rows still inside the TTL, keyed by ZIP. */
async function readCache(
  storeSlug: string,
  urlKey: string,
  zips: string[]
): Promise<Map<string, ZipCheckResult>> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const rows = await prisma.zipPriceCheck.findMany({
    where: { storeSlug, urlKey, zip: { in: zips }, checkedAt: { gte: cutoff } },
  });

  const map = new Map<string, ZipCheckResult>();
  for (const r of rows) {
    map.set(r.zip, {
      zip: r.zip,
      storeSlug: r.storeSlug,
      storeId: r.resolvedStoreId ?? undefined,
      storeName: r.storeName ?? undefined,
      status: r.status as StockStatus,
      price: r.price ?? undefined,
      pickupAvailable: r.pickupAvailable ?? undefined,
      pickupLocation: r.pickupLocation ?? undefined,
      locationResolved: r.locationResolved,
      message: r.message ?? undefined,
      checkedAt: r.checkedAt.toISOString(),
      cached: true,
    });
  }
  return map;
}

async function writeCache(
  storeSlug: string,
  urlKey: string,
  productUrl: string,
  results: ZipCheckResult[]
): Promise<void> {
  await Promise.all(
    results.map((r) =>
      prisma.zipPriceCheck
        .upsert({
          where: { storeSlug_zip_urlKey: { storeSlug, zip: r.zip, urlKey } },
          create: {
            storeSlug,
            zip: r.zip,
            urlKey,
            productUrl,
            resolvedStoreId: r.storeId ?? null,
            storeName: r.storeName ?? null,
            locationResolved: r.locationResolved,
            status: r.status,
            price: r.price ?? null,
            pickupAvailable: r.pickupAvailable ?? null,
            pickupLocation: r.pickupLocation ?? null,
            message: r.message ?? null,
            checkedAt: new Date(r.checkedAt),
          },
          update: {
            resolvedStoreId: r.storeId ?? null,
            storeName: r.storeName ?? null,
            locationResolved: r.locationResolved,
            status: r.status,
            price: r.price ?? null,
            pickupAvailable: r.pickupAvailable ?? null,
            pickupLocation: r.pickupLocation ?? null,
            message: r.message ?? null,
            checkedAt: new Date(r.checkedAt),
          },
        })
        .catch((e: Error) => logger.warn(`[zipCheck] cache write failed for ${r.zip}: ${e.message}`))
    )
  );
}

/**
 * Run a multi-ZIP check. Throws UnsupportedRetailerError for a URL we can't
 * price per-store; otherwise always resolves with one row per requested ZIP.
 */
export async function runZipCheck(input: ZipCheckInput): Promise<{
  storeSlug: string;
  productUrl: string;
  results: ZipCheckResult[];
}> {
  const { productUrl, storeProductId, force } = input;

  const storeSlug = storeSlugFromUrl(productUrl);
  if (!storeSlug || !isZipCheckSupported(storeSlug)) {
    let host: string | null = null;
    try {
      host = new URL(productUrl).hostname;
    } catch {
      /* leave null */
    }
    throw new UnsupportedRetailerError(host);
  }

  const zips = normalizeZips(input.zips);
  if (zips.length === 0) {
    return { storeSlug, productUrl, results: [] };
  }

  const urlKey = urlKeyOf(productUrl);
  const cached = force ? new Map<string, ZipCheckResult>() : await readCache(storeSlug, urlKey, zips);
  const toCheck = zips.filter((z) => !cached.has(z));

  // Parallel across ZIPs. Requests still serialize per retailer inside
  // scraperRateLimiter (BaseScraper's request interceptor), so this fans out
  // without stampeding a single store.
  const fresh = await Promise.all(
    toCheck.map((zip) => checkOneZip(storeSlug, zip, productUrl, storeProductId))
  );

  if (fresh.length > 0) {
    await writeCache(storeSlug, urlKey, productUrl, fresh);
  }

  const byZip = new Map<string, ZipCheckResult>(cached);
  for (const r of fresh) byZip.set(r.zip, r);

  // Return in the order the user typed them.
  const results = zips.map((z) => byZip.get(z)!).filter(Boolean);

  logger.info(
    `[zipCheck] ${storeSlug} ${zips.length} zip(s), ${fresh.length} live / ${cached.size} cached, ` +
      `${results.filter((r) => !r.locationResolved).length} unresolved`
  );

  return { storeSlug, productUrl, results };
}
