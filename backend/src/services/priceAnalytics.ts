/**
 * Pure price-intelligence aggregation over a product's StockEvent history.
 *
 * StockEvent rows fire on status OR price change, so the price stream is SPARSE:
 * a price holds until the next event for that listing. Every statistic here is
 * therefore TIME-WEIGHTED (the price is treated as a step function held until
 * the next point) — never a naive mean of event prices, which would let a brief
 * price spike dominate a listing that actually sat at one price for months.
 *
 * No DB access here — fed StockEvent rows by the controller so the math stays
 * unit-testable. Mirrors the shape and conventions of analytics.ts.
 */

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

const IN_STOCK_STATUSES = new Set(['IN_STOCK', 'LIMITED', 'PREORDER']);
const isInStock = (status: string): boolean => IN_STOCK_STATUSES.has(status);

export interface PriceEvent {
  status: string;
  price: number | null;
  createdAt: Date | string;
  storeSlug?: string | null;
  storeName?: string | null;
}

/**
 * Where the current price sits versus its own trailing-window history.
 *   lowest    — at/under the window low
 *   great     — cheaper than it's been ~85%+ of the window
 *   below_avg — clearly below the typical price
 *   average   — around the typical price
 *   above_avg — clearly above
 *   high      — at/near the window peak
 */
export type DealVerdict =
  | 'lowest'
  | 'great'
  | 'below_avg'
  | 'average'
  | 'above_avg'
  | 'high'
  | null;

export type PriceConfidence = 'low' | 'medium' | 'high' | null;

export interface SeriesInsight {
  current: number | null; // last known price within the window
  windowLow: number | null;
  windowHigh: number | null;
  timeWeightedAvg: number | null;
  /** Fraction of window-time (0..1) the price was strictly above `current`. High ⇒ a good deal now. */
  cheapness: number | null;
  verdict: DealVerdict;
  confidence: PriceConfidence;
  windowDays: number;
  spanDays: number; // observed span of priced points within the window
  samples: number; // distinct priced points within the window
}

export interface ProductPriceInsight extends SeriesInsight {
  storeSlug: string | null;
  storeName: string | null;
  inStock: boolean; // is the headline store currently in stock
}

interface PricePoint {
  at: number; // epoch ms
  price: number;
  status: string;
}

function toPoints(events: PriceEvent[]): PricePoint[] {
  return events
    .filter((e) => e.price != null && Number.isFinite(e.price))
    .map((e) => ({
      at: (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)).getTime(),
      price: e.price as number,
      status: e.status,
    }))
    .filter((p) => !Number.isNaN(p.at))
    .sort((a, b) => a.at - b.at);
}

const EMPTY: SeriesInsight = {
  current: null,
  windowLow: null,
  windowHigh: null,
  timeWeightedAvg: null,
  cheapness: null,
  verdict: null,
  confidence: null,
  windowDays: 0,
  spanDays: 0,
  samples: 0,
};

/**
 * Time-weighted price insight for a SINGLE listing's priced events.
 *
 * Each price point holds until the next point (step function); the final point
 * holds until `now`. Segments are clipped to the trailing window and weighted by
 * their duration. `current` is the most recent price; `cheapness` is the share
 * of window-time the price sat strictly above `current`.
 */
export function priceInsight(
  events: PriceEvent[],
  opts: { windowDays?: number; now?: Date } = {}
): SeriesInsight {
  const windowDays = opts.windowDays ?? 90;
  const now = (opts.now ?? new Date()).getTime();
  const windowStart = now - windowDays * DAY_MS;

  const points = toPoints(events);
  if (points.length === 0) return { ...EMPTY, windowDays };

  // Build duration-weighted segments clipped to [windowStart, now]. A point at
  // t_i holds [t_i, t_{i+1}); the last point holds [t_last, now]. We also let a
  // point that began BEFORE the window carry its price into the window's start.
  const segs: { price: number; weight: number; status: string }[] = [];
  let firstInWindow = Infinity;
  let lastInWindow = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const segStart = points[i].at;
    const segEnd = i + 1 < points.length ? points[i + 1].at : now;
    const lo = Math.max(segStart, windowStart);
    const hi = Math.min(segEnd, now);
    if (hi <= lo) continue;
    segs.push({ price: points[i].price, weight: hi - lo, status: points[i].status });
    firstInWindow = Math.min(firstInWindow, lo);
    lastInWindow = Math.max(lastInWindow, hi);
  }
  if (segs.length === 0) return { ...EMPTY, windowDays };

  const totalWeight = segs.reduce((s, seg) => s + seg.weight, 0);
  const weightedSum = segs.reduce((s, seg) => s + seg.price * seg.weight, 0);
  const timeWeightedAvg = round2(weightedSum / totalWeight);
  const windowLow = round2(Math.min(...segs.map((s) => s.price)));
  const windowHigh = round2(Math.max(...segs.map((s) => s.price)));

  // `current` = most recent priced point (its price holds through `now`).
  const current = round2(points[points.length - 1].price);

  // Share of window-time spent strictly above the current price.
  const aboveWeight = segs.filter((s) => s.price > current).reduce((s, seg) => s + seg.weight, 0);
  const cheapness = round2(aboveWeight / totalWeight);

  // Distinct priced points inside the window drive the confidence guard.
  const samples = segs.length;
  const spanDays = round2(Math.max(lastInWindow - firstInWindow, 0) / DAY_MS);

  // Confidence: enough distinct points AND enough observed span to be honest.
  // Price points are sparse (only logged on change), so 3 well-spread points
  // over a couple of weeks is already a confident read.
  let confidence: PriceConfidence;
  if (samples >= 3 && spanDays >= 14) confidence = 'high';
  else if (samples >= 2 && spanDays >= 7) confidence = 'medium';
  else if (samples >= 2 && spanDays >= 2) confidence = 'low';
  else confidence = null;

  // Stay quiet (null verdict) until there's enough history to judge fairly, and
  // when the window has been totally flat (no high/low spread to position within).
  let verdict: DealVerdict = null;
  if (confidence != null && windowHigh > windowLow) {
    if (current <= windowLow) verdict = 'lowest';
    else if (cheapness >= 0.85) verdict = 'great';
    else if (cheapness >= 0.6) verdict = 'below_avg';
    else if (cheapness > 0.4) verdict = 'average';
    else if (cheapness > 0.15) verdict = 'above_avg';
    else verdict = 'high';
  }

  return {
    current,
    windowLow,
    windowHigh,
    timeWeightedAvg,
    cheapness,
    verdict,
    confidence,
    windowDays,
    spanDays,
    samples,
  };
}

/**
 * Product-level headline insight. Prices differ by retailer (a Best Buy SKU vs
 * eBay's noisy "lowest active listing"), so we judge each store against its OWN
 * history rather than blending them into one meaningless distribution. The
 * headline is the store with the lowest CURRENT price that is in stock; if none
 * is in stock, the store with the richest history (most samples) is shown for
 * context.
 */
export function productPriceInsight(
  events: PriceEvent[],
  opts: { windowDays?: number; now?: Date } = {}
): ProductPriceInsight {
  const byStore = new Map<string, PriceEvent[]>();
  for (const e of events) {
    const key = e.storeSlug || e.storeName || '_';
    const arr = byStore.get(key);
    if (arr) arr.push(e);
    else byStore.set(key, [e]);
  }

  type Candidate = {
    insight: SeriesInsight;
    storeSlug: string | null;
    storeName: string | null;
    inStock: boolean;
  };

  const candidates: Candidate[] = [];
  for (const [, group] of byStore) {
    const insight = priceInsight(group, opts);
    if (insight.current == null) continue;
    // Currently in stock = the store's most recent event is an in-stock status.
    const sorted = group
      .map((e) => ({ at: (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)).getTime(), e }))
      .filter((r) => !Number.isNaN(r.at))
      .sort((a, b) => a.at - b.at);
    const last = sorted[sorted.length - 1]?.e;
    candidates.push({
      insight,
      storeSlug: last?.storeSlug ?? null,
      storeName: last?.storeName ?? null,
      inStock: last ? isInStock(last.status) : false,
    });
  }

  const fallback: ProductPriceInsight = { ...EMPTY, windowDays: opts.windowDays ?? 90, storeSlug: null, storeName: null, inStock: false };
  if (candidates.length === 0) return fallback;

  const inStock = candidates.filter((c) => c.inStock);
  const priceOf = (c: Candidate): number => c.insight.current ?? Infinity;
  const pool = inStock.length > 0 ? inStock : candidates;
  const byPrice = inStock.length > 0;
  let chosen: Candidate = pool[0];
  for (const c of pool) {
    const better = byPrice
      ? priceOf(c) < priceOf(chosen)
      : c.insight.samples > chosen.insight.samples;
    if (better) chosen = c;
  }

  return { ...chosen.insight, storeSlug: chosen.storeSlug, storeName: chosen.storeName, inStock: chosen.inStock };
}

// ── Money saved ────────────────────────────────────────────────────────────────
// How much each purchase beat the item's typical price. The reference is the
// time-weighted average over the window ENDING at the purchase instant (no
// hindsight — only history that existed when you bought). Prefer the store you
// bought from; fall back to all stores when that store's history is too thin.
// A purchase only counts toward the total when its reference is confident.

export interface PurchaseRow {
  id: string;
  productId: string;
  price: number | null;
  storeSlug?: string | null;
  purchasedAt: Date | string;
  productName?: string | null;
  storeName?: string | null;
}

export interface SavingsRow {
  id: string;
  productName: string | null;
  storeName: string | null;
  purchasedAt: string;
  paid: number | null;
  reference: number | null; // typical price at purchase time
  saved: number | null; // reference - paid (signed: negative = overpaid)
  confidence: PriceConfidence;
}

export interface SavingsSummary {
  totalSaved: number; // net across counted purchases
  counted: number; // purchases with a confident reference
  rows: SavingsRow[];
}

export function purchaseSavings(
  purchases: PurchaseRow[],
  eventsByProduct: Map<string, PriceEvent[]>,
  opts: { windowDays?: number } = {}
): SavingsSummary {
  const windowDays = opts.windowDays ?? 90;
  const rows: SavingsRow[] = [];
  let totalSaved = 0;
  let counted = 0;

  for (const p of purchases) {
    const paid = p.price ?? null;
    const at = p.purchasedAt instanceof Date ? p.purchasedAt : new Date(p.purchasedAt);
    let reference: number | null = null;
    let saved: number | null = null;
    let confidence: PriceConfidence = null;

    const all = eventsByProduct.get(p.productId) ?? [];
    if (paid != null && all.length > 0 && !Number.isNaN(at.getTime())) {
      const cutoff = at.getTime();
      const upto = all.filter((e) => {
        const t = (e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)).getTime();
        return !Number.isNaN(t) && t <= cutoff;
      });
      const scoped = p.storeSlug ? upto.filter((e) => e.storeSlug === p.storeSlug) : upto;
      const useEvents = scoped.length >= 2 ? scoped : upto;
      const insight = priceInsight(useEvents, { now: at, windowDays });
      if (insight.timeWeightedAvg != null && insight.confidence != null) {
        reference = insight.timeWeightedAvg;
        saved = round2(reference - paid);
        confidence = insight.confidence;
        totalSaved += saved;
        counted++;
      }
    }

    rows.push({
      id: p.id,
      productName: p.productName ?? null,
      storeName: p.storeName ?? null,
      purchasedAt: Number.isNaN(at.getTime()) ? '' : at.toISOString(),
      paid,
      reference,
      saved,
      confidence,
    });
  }

  return { totalSaved: round2(totalSaved), counted, rows };
}
