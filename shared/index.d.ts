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
