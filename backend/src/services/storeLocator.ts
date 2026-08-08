/**
 * ZIP → nearest-store resolution, per retailer.
 *
 * WHY THIS EXISTS
 * ---------------
 * Walmart, Target, Home Depot and Lowe's all price per-store. Their scrapers
 * accept a LocationContext, but that context needs the retailer's OWN store id
 * — HD "277", Lowe's "0592", Target "3991". A ZIP alone is not enough.
 *
 * The dangerous failure mode is passing a new ZIP with a stale store id: the
 * retailer happily answers with the OLD store's price, and we'd label it with
 * the NEW ZIP. That's silently wrong, which is worse than an error. So the
 * contract here is deliberately strict:
 *
 *   resolve() returns a fully-formed store, or null. Never a partial merge,
 *   never a fallback to the scraper's default store.
 *
 * Callers (see zipCheck.ts) must treat null as "cannot check this ZIP" and
 * surface it as unresolved, NOT scrape with defaults and present the result.
 *
 * VERIFICATION STATUS
 * -------------------
 * Every adapter carries a `confidence`. `verified` means the request shape was
 * captured from a real browser session (the standard the HD GraphQL and Lowe's
 * wpd endpoints were built to). `unverified` means the shape is inferred and
 * has NOT been confirmed against live traffic — those adapters log their raw
 * response on first use so a real run reveals the true shape, and zipCheck
 * marks their rows accordingly.
 */
import axios from 'axios';
import { prisma } from '../config/database';
import logger from '../utils/logger';
import { isValidUsZip, normalizeZip } from './pickup';
import {
  fetchJsonWithSolverrCookies,
  fetchRawJson,
  fetchRenderedHtml,
  extractJsonFromRendered,
  getSolverrSession,
} from '../scrapers/browserFetch';

export interface ResolvedStore {
  storeId: string;
  storeName?: string;
  zip: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}

export type LocatorConfidence = 'verified' | 'unverified';

interface StoreLocatorAdapter {
  slug: string;
  confidence: LocatorConfidence;
  resolve(zip: string): Promise<ResolvedStore | null>;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const TIMEOUT = 12000;

/** Log a truncated payload once per retailer so unverified shapes get revealed. */
const shapeLogged = new Set<string>();
function logShapeOnce(slug: string, payload: unknown): void {
  if (shapeLogged.has(slug)) return;
  shapeLogged.add(slug);
  logger.info(
    `[storeLocator:${slug}] first response shape (truncated): ${JSON.stringify(payload ?? null).slice(0, 800)}`
  );
}

/**
 * GET a JSON endpoint, falling back to a real browser when the retailer blocks
 * a plain request.
 *
 * Lowe's, Home Depot and Walmart all sit behind Akamai, which answers bare HTTP
 * clients with 403 (observed 2026-08-08: every locator lookup 403'd in under
 * 50ms). The product scrapers already handle this; the locator originally did
 * not, which is why every ZIP came back unresolved. Same escalation ladder as
 * scrapers/target.ts:
 *   1. direct GET (fast when the retailer allows it)
 *   2. FlareSolverr solves the URL, replay its cookies in a plain GET
 *   3. raw network response via puppeteer
 *   4. FlareSolverr rendered body + JSON extraction
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJsonResilient(url: string, slug: string, headers: Record<string, string>): Promise<any> {
  try {
    const { data } = await axios.get(url, { timeout: TIMEOUT, headers });
    return data;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    logger.info(`[storeLocator:${slug}] direct GET ${status ?? 'failed'} - escalating to browser fetch`);
  }

  const replayed = await fetchJsonWithSolverrCookies(url);
  if (replayed) return replayed;

  const raw = await fetchRawJson(url);
  if (raw) return raw;

  const body = await fetchRenderedHtml(url);
  if (body) {
    const parsed = extractJsonFromRendered(body);
    if (parsed) return parsed;
    logger.warn(`[storeLocator:${slug}] rendered body had no parseable JSON (${body.length} bytes)`);
  }

  return null;
}

/**
 * Last-resort store id for Lowe's: fetch the human store-finder page through a
 * browser and pull store numbers straight out of the links.
 *
 * Confirmed URL shape (2026-08-08, from the live site):
 *   https://www.lowes.com/store/VA-Roanoke/0419
 * so any /store/{ST}-{City}/{4-digit} link on the results page is a real store,
 * listed nearest-first. This survives the JSON API changing shape or path.
 */
async function lowesStoreIdFromHtml(zip: string): Promise<{ storeId: string; state?: string } | null> {
  const url = `https://www.lowes.com/store/search?zipcode=${encodeURIComponent(zip)}`;
  const html = await fetchRenderedHtml(url);
  if (!html) return null;

  const match = html.match(/\/store\/([A-Z]{2})-[^/"']+\/(\d{4})/);
  if (!match) {
    logger.warn(`[storeLocator:lowes] no /store/{ST}-{City}/{id} links found for ${zip} (${html.length} bytes)`);
    return null;
  }
  logger.info(`[storeLocator:lowes] ${zip} resolved from store-finder HTML: #${match[2]} (${match[1]})`);
  return { storeId: match[2], state: match[1] };
}

// ── Target ───────────────────────────────────────────────────────────────────
// Redsky's nearby_stores aggregation, same host and API key the product
// endpoints in scrapers/target.ts already use.
const targetLocator: StoreLocatorAdapter = {
  slug: 'target',
  confidence: 'unverified',
  async resolve(zip) {
    const url =
      `https://redsky.target.com/redsky_aggregations/v1/web/nearby_stores_v1` +
      `?key=9f36aeafbe60771e321a7cc95a78140772ab3e96` +
      `&limit=1&within=100&place=${encodeURIComponent(zip)}`;
    try {
      const data = await fetchJsonResilient(url, 'target', {
        Accept: 'application/json',
        'User-Agent': UA,
        Referer: 'https://www.target.com/',
      });
      logShapeOnce('target', data);

      const store = data?.data?.nearby_stores?.stores?.[0];
      if (!store?.store_id) return null;

      return {
        storeId: String(store.store_id),
        storeName: store.location_name ?? store.store_name ?? undefined,
        zip,
        state: store.mailing_address?.address?.state ?? store.address?.state ?? undefined,
        latitude: store.geographic_specifications?.latitude ?? store.latitude ?? undefined,
        longitude: store.geographic_specifications?.longitude ?? store.longitude ?? undefined,
      };
    } catch (err: unknown) {
      logger.warn(`[storeLocator:target] ${zip} failed: ${(err as Error)?.message}`);
      return null;
    }
  },
};

// ── Home Depot ───────────────────────────────────────────────────────────────
// HD exposes store search on the same federation gateway the fulfillment query
// already uses, so it inherits that host's behaviour (and its Akamai quirks).
const HD_GQL = 'https://apionline.homedepot.com/federation-gateway/graphql';
const HD_STORE_QUERY = `query storeSearch($address: String!, $radius: Float) {
  storeSearch(address: $address, radius: $radius) {
    stores {
      storeId
      name
      address { city state postalCode __typename }
      coordinates { lat lng __typename }
      __typename
    }
    __typename
  }
}`;

const homeDepotLocator: StoreLocatorAdapter = {
  slug: 'homedepot',
  confidence: 'unverified',
  async resolve(zip) {
    // Same two-step as scrapers/homedepot.ts: cookie-less POST first, then
    // retry with an Akamai-validated session from FlareSolverr on failure.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = async (cookie?: string, userAgent?: string): Promise<any> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://www.homedepot.com',
        Referer: 'https://www.homedepot.com/',
        'User-Agent': userAgent || UA,
        'x-experience-name': 'general-merchandise',
        'x-hd-dc': 'origin',
      };
      if (cookie) headers.Cookie = cookie;
      const { data } = await axios.post(
        `${HD_GQL}?opname=storeSearch`,
        { operationName: 'storeSearch', variables: { address: zip, radius: 50 }, query: HD_STORE_QUERY },
        { timeout: TIMEOUT, headers }
      );
      return data;
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = null;
      try {
        data = await post();
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        logger.info(`[storeLocator:homedepot] cookie-less POST ${status ?? 'failed'} - retrying with FlareSolverr session`);
      }

      if (!data?.data?.storeSearch?.stores?.length) {
        const session = await getSolverrSession('https://www.homedepot.com/');
        if (session) {
          try {
            data = await post(session.cookieHeader, session.userAgent);
          } catch (err: unknown) {
            logger.warn(`[storeLocator:homedepot] session POST failed: ${(err as Error)?.message}`);
          }
        }
      }

      logShapeOnce('homedepot', data);

      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        logger.warn(`[storeLocator:homedepot] GraphQL errors: ${data.errors[0]?.message ?? 'unknown'}`);
      }

      const store = data?.data?.storeSearch?.stores?.[0];
      if (!store?.storeId) return null;

      return {
        storeId: String(store.storeId),
        storeName: store.name ?? undefined,
        zip,
        state: store.address?.state ?? undefined,
        latitude: store.coordinates?.lat ?? undefined,
        longitude: store.coordinates?.lng ?? undefined,
      };
    } catch (err: unknown) {
      logger.warn(`[storeLocator:homedepot] ${zip} failed: ${(err as Error)?.message}`);
      return null;
    }
  },
};

// ── Lowe's ───────────────────────────────────────────────────────────────────
const lowesLocator: StoreLocatorAdapter = {
  slug: 'lowes',
  confidence: 'unverified',
  async resolve(zip) {
    const url = `https://www.lowes.com/store/api/searchStores?searchTerm=${encodeURIComponent(zip)}&maxResults=1`;
    try {
      const data = await fetchJsonResilient(url, 'lowes', {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': UA,
        Referer: 'https://www.lowes.com/store/',
      });
      logShapeOnce('lowes', data);

      const store = Array.isArray(data?.stores) ? data.stores[0] : (data?.[0] ?? null);
      const storeId = store?.storeNumber ?? store?.id ?? store?.storeId;

      // JSON path gave nothing usable - fall back to scraping the store-finder
      // page, whose /store/{ST}-{City}/{id} links are a confirmed shape.
      if (!storeId) {
        const fromHtml = await lowesStoreIdFromHtml(zip);
        if (!fromHtml) return null;
        return { storeId: fromHtml.storeId, zip, state: fromHtml.state };
      }

      // Lowe's store numbers are zero-padded to 4 chars in the wpd path.
      return {
        storeId: String(storeId).padStart(4, '0'),
        storeName: store?.name ?? store?.storeName ?? undefined,
        zip,
        state: store?.state ?? store?.address?.state ?? undefined,
        latitude: store?.latitude ?? undefined,
        longitude: store?.longitude ?? undefined,
      };
    } catch (err: unknown) {
      logger.warn(`[storeLocator:lowes] ${zip} JSON path failed (${(err as Error)?.message}) - trying store-finder HTML`);
      const fromHtml = await lowesStoreIdFromHtml(zip);
      if (!fromHtml) return null;
      return { storeId: fromHtml.storeId, zip, state: fromHtml.state };
    }
  },
};

// ── Walmart ──────────────────────────────────────────────────────────────────
const walmartLocator: StoreLocatorAdapter = {
  slug: 'walmart',
  confidence: 'unverified',
  async resolve(zip) {
    const url = `https://www.walmart.com/store/api/finder?singleLineAddr=${encodeURIComponent(zip)}&distance=50`;
    try {
      const data = await fetchJsonResilient(url, 'walmart', {
        Accept: 'application/json',
        'User-Agent': UA,
        Referer: 'https://www.walmart.com/store/finder',
      });
      logShapeOnce('walmart', data);

      const store =
        (Array.isArray(data?.payload?.storesData?.stores) ? data.payload.storesData.stores[0] : null) ??
        (Array.isArray(data?.stores) ? data.stores[0] : null);
      const storeId = store?.id ?? store?.storeId ?? store?.no;
      if (!storeId) return null;

      return {
        storeId: String(storeId),
        storeName: store?.displayName ?? store?.name ?? undefined,
        zip,
        state: store?.address?.state ?? undefined,
        latitude: store?.geoPoint?.latitude ?? store?.latitude ?? undefined,
        longitude: store?.geoPoint?.longitude ?? store?.longitude ?? undefined,
      };
    } catch (err: unknown) {
      logger.warn(`[storeLocator:walmart] ${zip} failed: ${(err as Error)?.message}`);
      return null;
    }
  },
};

const ADAPTERS: Record<string, StoreLocatorAdapter> = {
  target: targetLocator,
  homedepot: homeDepotLocator,
  lowes: lowesLocator,
  walmart: walmartLocator,
};

/** Retailers this feature supports at all. */
export const ZIP_CHECK_STORES = Object.keys(ADAPTERS);

export function isZipCheckSupported(storeSlug: string): boolean {
  return storeSlug in ADAPTERS;
}

export function locatorConfidence(storeSlug: string): LocatorConfidence | null {
  return ADAPTERS[storeSlug]?.confidence ?? null;
}

/** Store resolutions are stable for a long time; re-check monthly. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve a ZIP to a store for one retailer, using the cache when fresh.
 * Returns null when the ZIP cannot be resolved — callers MUST NOT fall back to
 * a default store, because that produces a right-looking wrong price.
 */
export async function resolveStore(storeSlug: string, rawZip: string): Promise<ResolvedStore | null> {
  const zip = normalizeZip(rawZip);
  if (!zip || !isValidUsZip(zip)) return null;

  const adapter = ADAPTERS[storeSlug];
  if (!adapter) return null;

  const cached = await prisma.storeLocation.findUnique({
    where: { storeSlug_zip: { storeSlug, zip } },
  });
  if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
    return {
      storeId: cached.storeId,
      storeName: cached.storeName ?? undefined,
      zip: cached.zip,
      state: cached.state ?? undefined,
      latitude: cached.latitude ?? undefined,
      longitude: cached.longitude ?? undefined,
    };
  }

  const resolved = await adapter.resolve(zip);
  if (!resolved) {
    // Keep a stale cache entry rather than nothing — an old resolution is still
    // a real store for this ZIP, and beats failing the whole check.
    if (cached) {
      logger.warn(`[storeLocator:${storeSlug}] ${zip} re-resolution failed; serving stale cache`);
      return {
        storeId: cached.storeId,
        storeName: cached.storeName ?? undefined,
        zip: cached.zip,
        state: cached.state ?? undefined,
        latitude: cached.latitude ?? undefined,
        longitude: cached.longitude ?? undefined,
      };
    }
    return null;
  }

  await prisma.storeLocation.upsert({
    where: { storeSlug_zip: { storeSlug, zip } },
    create: {
      storeSlug,
      zip,
      storeId: resolved.storeId,
      storeName: resolved.storeName ?? null,
      state: resolved.state ?? null,
      latitude: resolved.latitude ?? null,
      longitude: resolved.longitude ?? null,
    },
    update: {
      storeId: resolved.storeId,
      storeName: resolved.storeName ?? null,
      state: resolved.state ?? null,
      latitude: resolved.latitude ?? null,
      longitude: resolved.longitude ?? null,
    },
  });

  return resolved;
}
