# Multi-Retailer Product Search + One-Click Track — Implementation Plan

Goal: let a user type a product name, search across our working retailers, see
results ranked cheapest-first, and hit **Track it** on any row to auto-create the
product and start tracking it.

## What already exists (so we don't rebuild it)

The codebase is further along than it looks. Before writing anything new, note
these existing pieces the feature will lean on:

- **One-click track is basically done.** `importTracking`
  (`backend/src/controllers/trackingController.ts`, `POST /api/tracking/import`)
  already: detects the retailer from a URL, fetches `og:`/`twitter:` metadata for
  name + image, dedupes by URL, creates the `Product` + `StoreProduct`, enforces
  the tracking limit, and creates/reactivates the `Tracking`. A search "Track it"
  button just needs to feed a URL into this same path.
- **eBay already scrapes a search-results page.** `EbayScraper.parseResults`
  (`backend/src/scrapers/ebay.ts`) fetches `ebay.com/sch/i.html?_nkw=…`, counts
  listings, and extracts the lowest price — it just discards the per-item detail
  and returns a single `StockResult`. It's the template for a search adapter.
- **Search-URL templates already exist.** `store.searchUrl` (Prisma `Store`
  model) and `STORE_SEARCH_URLS` (`backend/src/data/searchUrls.ts`) map every
  store slug to a `{query}` search URL, already surfaced to the frontend as
  `storeSearchUrl`. We reuse these to know where to search each retailer.
- **Fetch + anti-bot infra is shared.** `BaseScraper.fetchPage`, the per-store
  `scraperRateLimiter`, `withRetry`, `isBotBlocked`, and
  `browserFetch.fetchRenderedHtml` (FlareSolverr / headless Chromium) all work on
  any URL — including a search-results URL — with no changes.
- **Data model needs no new columns.** `Product → StoreProduct → Store` and
  `Tracking` cover everything. Since our schema is reconciled at boot via
  `ADD COLUMN IF NOT EXISTS`, and we add none, there is **no schema/boot-SQL work**.

## The one genuinely new concept: a search adapter

Today a scraper is `checkStock(url) → StockResult` — a *known URL in, one status
out*. Search is the inverse: *a query in, a list of candidate products out*. That
is a new interface, separate from `BaseScraper`.

```ts
// backend/src/search/types.ts
export interface SearchCandidate {
  storeSlug: string;
  title: string;
  url: string;            // canonical product URL we will track
  price?: number;
  currency?: string;      // default 'USD'
  imageUrl?: string;
  inStock: boolean;       // best-effort from the results row
  condition?: 'NEW' | 'OPEN_BOX' | 'USED' | 'REFURBISHED';
}

export interface SearchAdapter {
  storeSlug: string;
  /** Returns [] for a genuine no-results page; throws on bot-block/unknown. */
  search(query: string, opts?: { limit?: number }): Promise<SearchCandidate[]>;
}
```

Each adapter:
1. Builds the search URL from `store.searchUrl ?? STORE_SEARCH_URLS[slug]` via the
   existing `buildSearchUrl(template, query)`.
2. Fetches it through the **existing** pipeline (rate limiter → `fetchPage` →
   `fetchRenderedHtml` fallback), so pacing/retry/anti-bot are free.
3. Parses the results HTML with cheerio into `SearchCandidate[]` — per-retailer
   selectors, exactly like `EbayScraper.parseResults` but *returning the rows*
   instead of counting them.

Critical rule (mirror the existing UNKNOWN discipline): a bot-blocked or
unrecognized results page must **throw / report "couldn't search this store"** —
never return `[]`, because `[]` means "genuinely no matches." Reuse the
`isBotBlocked` + `isGenuineEmptyResults` guards eBay already has.

## Aggregator

```ts
// backend/src/search/aggregate.ts
searchAllStores(query, { stores?, limitPerStore = 5 }):
  - resolve the enabled adapters (subset or all)
  - run with Promise.allSettled + bounded concurrency (e.g. 4 at a time)
  - each adapter is already per-store rate-limited by scraperRateLimiter
  - flatten candidates; drop price-less rows for ranking
  - sort ascending by price
  - return { results: SearchCandidate[], errors: {storeSlug, message}[] }
```

Add a short **Redis cache** (config already in `backend/src/config/redis.ts`)
keyed by normalized query + store set, ~10 min TTL. Live search triggers browser
renders, so caching identical queries matters. Also consider giving search its own
rate-limit bucket so a big fan-out doesn't starve the scheduled Bull stock checks
that share `scraperRateLimiter`.

## Endpoints

- `GET /api/search?q=…&stores=…` (authenticated — ties into abuse control and the
  user's store prefs) → `{ results, errors }`, ranked cheapest-first.
- `POST /api/search/track` body `{ url, title, imageUrl, price, storeSlug, condition }`
  → create-or-find product + tracking, seeded with the price/stock we already have
  so the card isn't blank until the first scheduled check.

Refactor the create-or-find core out of `importTracking` into a shared helper so
both the paste-URL flow and search reuse it:

```ts
// backend/src/services/trackByUrl.ts
createTrackedProductFromListing(user, {
  url, storeSlug, name?, imageUrl?, price?, inStock?, condition?
}): Promise<{ product, tracking, created }>
```

`importTracking` keeps doing its own metadata fetch; the search path passes name/
image/price straight through (no re-fetch needed — the results page already gave us
those). Both funnel into the same limit-check + dedupe + create logic.

## Cross-retailer "lowest price" — be honest, not clever

The same query returns *different products* at each retailer, and the cheapest raw
hit is often an accessory or wrong variant. So:

- Rank ascending by price but **show store + title + image** per row — the user
  eyeballs the match. Don't crown a single global "lowest" blindly.
- Phase-2 refinement: token-overlap similarity between the query and each title to
  down-rank/flag obvious mismatches (cheap junk), and optional grouping of
  near-identical titles.
- Once an item is tracked, the existing `lowestPrice`-across-in-stock-listings
  logic in `productController.toCardShape` already does true cross-store lowest for
  *that* product.

## Frontend

- New live-search view (or a "Search retailers" toggle on the existing catalog
  search, which today only queries our internal `Product` table via `getProducts`).
- Results list sorted by price; each row: image, title, store logo, price,
  in-stock badge, **Track it** button → `POST /api/search/track` → toast +
  optional navigate to the product page.
- Reuse the `stockStatuses`/`ProductCard` shape where possible; surface per-store
  errors quietly ("couldn't reach Newegg").
- Bump `frontend/src/version.ts` (house rule: every change).

## Phasing

**Phase 0 — plumbing + prove end-to-end (eBay only).**
`SearchAdapter`/`SearchCandidate` types, aggregator, `GET /api/search`,
`createTrackedProductFromListing` helper, `POST /api/search/track`. Refactor
`EbayScraper.parseResults` to also emit candidates and wrap it as the first
adapter. Minimal frontend results list. Ships a working search→track loop on one
retailer.

**Phase 1 — breadth + real UI.**
Adapters for the retailers that already have dedicated scrapers (selectors are
understood): Amazon, Best Buy, Walmart, Target, Newegg. Polished search page,
Track-it button, loading/error states.

**Phase 2 — polish.**
Redis result caching, SSE streaming of per-store results (reuse the
`liveCheckProduct` SSE pattern so rows stream in as each store lands),
title-similarity matching, inline good-deal badge via `priceAnalytics`, swap the
eBay adapter to the **eBay Browse API** once the App ID lands (clean keyword search
behind the same interface), then extend to generic-scraper stores.

## New / changed files at a glance

| File | Change |
|---|---|
| `backend/src/search/types.ts` | new — `SearchAdapter`, `SearchCandidate` |
| `backend/src/search/adapters/ebay.ts` | new — refactor eBay results parse to emit candidates |
| `backend/src/search/adapters/{amazon,bestbuy,walmart,target,newegg}.ts` | new (Phase 1) |
| `backend/src/search/aggregate.ts` | new — fan-out, rank, cache |
| `backend/src/services/trackByUrl.ts` | new — shared create-or-find + track helper |
| `backend/src/controllers/searchController.ts` | new — `GET /api/search`, `POST /api/search/track` |
| `backend/src/routes/search.ts` + `app.ts` | new route wiring |
| `backend/src/controllers/trackingController.ts` | refactor `importTracking` onto the shared helper |
| `frontend/src/pages/Search*.tsx` + `frontend/src/lib/api.ts` | new search UI + API calls |
| `frontend/src/version.ts` | version bump |

## Risks / watch-items (Trackit-specific)

- Results pages are heavier than product pages → more FlareSolverr renders →
  slower and more block-prone. Caching + bounded concurrency are load-bearing, not
  optional.
- Shared `scraperRateLimiter` means a fan-out search competes with scheduled Bull
  checks; give search its own bucket or cap concurrency.
- Keep the UNKNOWN discipline end-to-end: never render a bot-blocked store as
  "no results."
- No new DB columns, so nothing for the boot-time schema reconciler to do — but do
  seed the new `StoreProduct` with the search-result price/stock so the first view
  isn't empty.
