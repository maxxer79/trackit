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
      const { data } = await axios.get(url, {
        timeout: TIMEOUT,
        headers: { Accept: 'application/json', 'User-Agent': UA, Referer: 'https://www.target.com/' },
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
    try {
      const { data } = await axios.post(
        `${HD_GQL}?opname=storeSearch`,
        { operationName: 'storeSearch', variables: { address: zip, radius: 50 }, query: HD_STORE_QUERY },
        {
          timeout: TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            Origin: 'https://www.homedepot.com',
            Referer: 'https://www.homedepot.com/',
            'User-Agent': UA,
            'x-experience-name': 'general-merchandise',
            'x-hd-dc': 'origin',
          },
        }
      );
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
      const { data } = await axios.get(url, {
        timeout: TIMEOUT,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': UA,
          Referer: 'https://www.lowes.com/store/',
        },
      });
      logShapeOnce('lowes', data);

      const store = Array.isArray(data?.stores) ? data.stores[0] : (data?.[0] ?? null);
      const storeId = store?.storeNumber ?? store?.id ?? store?.storeId;
      if (!storeId) return null;

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
      logger.warn(`[storeLocator:lowes] ${zip} failed: ${(err as Error)?.message}`);
      return null;
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
      const { data } = await axios.get(url, {
        timeout: TIMEOUT,
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://www.walmart.com/store/finder',
        },
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
