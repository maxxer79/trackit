/**
 * Shared, framework-agnostic type contracts used by BOTH backend and frontend.
 *
 * This is a declaration file (.d.ts) on purpose: the types here are erased at
 * compile time, so adding them changes NEITHER build's emitted output — the
 * backend `dist/` layout, its `CMD`, and the frontend bundle are all unaffected.
 * Always import from here with `import type` so nothing survives to runtime.
 *
 * Consumed via the `@shared` path alias (see backend/tsconfig.json and
 * frontend/tsconfig.json). The folder is copied into each Docker image at build
 * time (build context is the repo root); the image mirrors the repo layout so
 * the `../shared` path resolves identically in local dev and in CI/Docker.
 *
 * Keep this type-only. If shared *runtime* values are ever needed (e.g. a list
 * of store slugs), introduce a sibling `.ts` and adjust the builds then.
 */

/** Stock state a scraper can resolve a listing to. */
export type StockStatus =
  | 'IN_STOCK'
  | 'OUT_OF_STOCK'
  | 'LIMITED'
  | 'PREORDER'
  | 'UNKNOWN';

/**
 * Canonical scraper return contract: every store scraper resolves a listing to
 * one of these. `UNKNOWN` means "couldn't determine" and must never flip stored
 * stock state (see backend/src/scrapers/base.ts and the Bull worker).
 */
export interface StockResult {
  storeSlug: string;
  status: StockStatus;
  price?: number;
  originalPrice?: number;
  productUrl: string;
  message?: string;
  /**
   * In-store pickup signal, populated only by scrapers that can resolve it
   * (e.g. Home Depot fulfillment). `undefined` = the scraper didn't determine
   * pickup for this listing — it must never be treated as "unavailable" or used
   * to flip online stock state.
   */
  pickupAvailable?: boolean;
  /** Human-readable pickup location (store name/city) when known. */
  pickupLocation?: string;
}

/**
 * Where a scrape should be performed FROM. Walmart, Target, Home Depot and
 * Lowe's all price and stock per-store, so a check without this context
 * silently returns whatever the scraper's default store happens to be.
 *
 * `storeId` is the retailer's OWN store identifier (HD "277", Lowe's "0592",
 * Target "3991") and is what actually drives per-store pricing — the ZIP alone
 * is not enough. Resolve it with services/storeLocator.ts; never guess it.
 */
export interface LocationContext {
  /** 5-digit US ZIP (or ZIP+4). Validate with pickup.ts isValidUsZip. */
  zip: string;
  /** Retailer-specific store id. Required for per-store pricing to be real. */
  storeId: string;
  /** 2-letter state — Lowe's wpd endpoint wants it alongside the ZIP. */
  state?: string;
  /**
   * Target's Redsky endpoints send lat/long next to store_id and zip. Passing a
   * new ZIP while leaving the old coordinates produces an incoherent request,
   * so the locator resolves all of them together or none of them.
   */
  latitude?: number;
  longitude?: number;
  /** Human-readable store name, for display in results. */
  storeName?: string;
}

/** One retailer's answer for one ZIP, as returned by POST /api/zip-check. */
export interface ZipCheckResult {
  zip: string;
  storeSlug: string;
  /** Resolved store for this ZIP; absent when resolution failed. */
  storeId?: string;
  storeName?: string;
  status: StockStatus;
  price?: number;
  pickupAvailable?: boolean;
  pickupLocation?: string;
  /**
   * True when this row reflects a store we actually resolved for the ZIP.
   * False means the ZIP could NOT be resolved and the row is informational
   * only — the UI must not present it as that ZIP's price. See storeLocator.
   */
  locationResolved: boolean;
  /** Why the check failed or is untrustworthy, for display. */
  message?: string;
  /** When this row was produced (cache hits carry the original time). */
  checkedAt: string;
  /** True when served from the ZipPriceCheck cache rather than a live scrape. */
  cached: boolean;
}
