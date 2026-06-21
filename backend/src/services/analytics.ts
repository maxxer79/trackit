/**
 * Pure aggregation for personal restock analytics. Buckets a user's restock
 * events (out→in transitions, from the Alert table) by local hour-of-day,
 * day-of-week, and retailer, and computes an honest restocks/month rate. No DB
 * here — unit-testable. "Local" uses the user's timezone via Intl.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface RestockRow {
  createdAt: Date | string;
  storeSlug: string;
}
export interface RetailerCount {
  storeSlug: string;
  count: number;
}
export interface RestockSummary {
  total: number;
  spanDays: number;
  restocksPerMonth: number | null; // null until there's enough data to be honest
  peakHour: number | null; // 0..23 in the user's tz
  byHour: number[]; // length 24
  byDayOfWeek: number[]; // length 7, 0 = Sunday
  topRetailers: RetailerCount[];
  firstAt: Date | null;
  lastAt: Date | null;
}

function hourInTz(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(d)) % 24;
}
function dowInTz(d: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return Math.max(0, WEEKDAYS.indexOf(wd));
}
const round1 = (n: number): number => Math.round(n * 10) / 10;

// ── Per-product restock frequency ────────────────────────────────────────────
// How often a single product comes back in stock. Source is StockEvent, which
// fires on status OR price change — so consecutive in-stock rows can exist. We
// collapse to true out→in transitions before measuring intervals.

export interface StatusRow {
  status: string;
  createdAt: Date | string;
}
export interface RestockFrequency {
  restockCount: number; // true out→in transitions observed
  lastRestockAt: Date | null;
  avgIntervalDays: number | null; // null until enough intervals to be honest
  medianIntervalDays: number | null;
  intervalsCount: number;
}

const IN_STOCK_STATUSES = new Set(['IN_STOCK', 'LIMITED', 'PREORDER']);
const isInStock = (status: string): boolean => IN_STOCK_STATUSES.has(status);

/**
 * Collapse raw StockEvent rows (which fire on status OR price change) into the
 * chronological list of true out→in restock instants. UNKNOWN never flips the
 * stock state (matches the scraper rule). Shared by restockFrequency and
 * restockPrediction so both measure the exact same events.
 */
export function extractRestockTimes(rows: StatusRow[]): Date[] {
  const sorted = rows
    .map((r) => ({ status: r.status, at: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt) }))
    .filter((r) => !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const restockTimes: Date[] = [];
  let prevInStock: boolean | null = null;
  for (const r of sorted) {
    const nowIn = isInStock(r.status);
    if (nowIn && prevInStock === false) restockTimes.push(r.at);
    if (r.status !== 'UNKNOWN') prevInStock = nowIn;
  }
  return restockTimes;
}

function intervalsBetween(times: Date[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) {
    out.push((times[i].getTime() - times[i - 1].getTime()) / 86_400_000);
  }
  return out;
}

/** Linear-interpolated percentile (p in 0..1) over an unsorted numeric array. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function restockFrequency(
  rows: StatusRow[],
  opts: { minIntervals?: number } = {}
): RestockFrequency {
  const minIntervals = opts.minIntervals ?? 2; // ≥2 intervals ⇒ ≥3 restocks

  const restockTimes = extractRestockTimes(rows);
  const intervals = intervalsBetween(restockTimes);

  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const avg = intervals.length ? round1(intervals.reduce((s, n) => s + n, 0) / intervals.length) : null;
  let median: number | null = null;
  if (intervals.length) {
    const s = [...intervals].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    median = round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
  }
  const enough = intervals.length >= minIntervals;

  return {
    restockCount: restockTimes.length,
    lastRestockAt: restockTimes.length ? restockTimes[restockTimes.length - 1] : null,
    avgIntervalDays: enough ? avg : null,
    medianIntervalDays: enough ? median : null,
    intervalsCount: intervals.length,
  };
}

// ── Restock prediction ────────────────────────────────────────────────────────
// Project the NEXT likely restock from the historical interval distribution.
// Point estimate = last restock + median interval. The window is the 25th–75th
// percentile of intervals added to the last restock ("half the time it's back
// within this window"). Confidence reflects sample size AND regularity (a low
// coefficient of variation = a steady cadence we can trust).

export type RestockConfidence = 'low' | 'medium' | 'high';

export interface RestockPrediction {
  predictedNextAt: string | null; // ISO; last restock + median interval
  windowStart: string | null; // ISO; last restock + p25 interval
  windowEnd: string | null; // ISO; last restock + p75 interval
  etaDays: number | null; // days from `now` to the point estimate (negative = due/overdue)
  overdue: boolean; // now is past the predicted window
  confidence: RestockConfidence | null; // null until there's enough data to predict
  intervalsCount: number;
  medianIntervalDays: number | null;
  cv: number | null; // coefficient of variation of intervals (spread / mean)
}

export function restockPrediction(
  rows: StatusRow[],
  now: Date = new Date(),
  opts: { minIntervals?: number } = {}
): RestockPrediction {
  const minIntervals = opts.minIntervals ?? 2;
  const round1 = (n: number): number => Math.round(n * 10) / 10;

  const times = extractRestockTimes(rows);
  const intervals = intervalsBetween(times);
  const empty: RestockPrediction = {
    predictedNextAt: null,
    windowStart: null,
    windowEnd: null,
    etaDays: null,
    overdue: false,
    confidence: null,
    intervalsCount: intervals.length,
    medianIntervalDays: null,
    cv: null,
  };

  if (intervals.length < minIntervals) return empty;

  const last = times[times.length - 1];
  const mean = intervals.reduce((s, n) => s + n, 0) / intervals.length;
  const median = percentile(intervals, 0.5);
  const p25 = percentile(intervals, 0.25);
  const p75 = percentile(intervals, 0.75);
  const variance = intervals.reduce((s, n) => s + (n - mean) ** 2, 0) / intervals.length;
  const stdev = Math.sqrt(variance);
  const cv = mean > 0 ? stdev / mean : 0;

  const addDays = (d: Date, days: number): string => new Date(d.getTime() + days * 86_400_000).toISOString();
  const predictedNextAt = addDays(last, median);
  const windowStart = addDays(last, p25);
  const windowEnd = addDays(last, p75);
  const etaDays = round1((new Date(predictedNextAt).getTime() - now.getTime()) / 86_400_000);
  const overdue = now.getTime() > new Date(windowEnd).getTime();

  // Confidence: more intervals + steadier cadence ⇒ more trust.
  let confidence: RestockConfidence = 'low';
  if (intervals.length >= 4 && cv <= 0.35) confidence = 'high';
  else if (intervals.length >= 3 && cv <= 0.6) confidence = 'medium';

  return {
    predictedNextAt,
    windowStart,
    windowEnd,
    etaDays,
    overdue,
    confidence,
    intervalsCount: intervals.length,
    medianIntervalDays: round1(median),
    cv: round1(cv),
  };
}

// ── Stock timeline ────────────────────────────────────────────────────────────
// Collapse a product's per-store StockEvent rows into overall in/out periods.
// The product is "in stock" whenever ANY store is in stock. Replays events in
// time order, tracking each store's last known state; UNKNOWN never changes a
// store's state. Produces colored segments for a visual timeline.

export interface TimelineEvent {
  status: string;
  createdAt: Date | string;
  storeSlug?: string | null;
  storeName?: string | null;
}
export interface TimelineSegment {
  state: 'in' | 'out';
  start: string; // ISO
  end: string; // ISO
  days: number;
}
export interface StockTimeline {
  segments: TimelineSegment[];
  restockCount: number;
  firstAt: string | null;
}

export function buildStockTimeline(events: TimelineEvent[], now: Date = new Date()): StockTimeline {
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const sorted = events
    .map((e) => ({
      status: e.status,
      at: e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt),
      key: e.storeSlug || e.storeName || '_',
    }))
    .filter((e) => !Number.isNaN(e.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const storeState = new Map<string, boolean>();
  const segments: TimelineSegment[] = [];
  let current: 'in' | 'out' | null = null;
  let segStart: Date | null = null;
  let restockCount = 0;
  let firstAt: Date | null = null;

  const pushSeg = (state: 'in' | 'out', start: Date, end: Date): void => {
    segments.push({
      state,
      start: start.toISOString(),
      end: end.toISOString(),
      days: round1(Math.max((end.getTime() - start.getTime()) / 86_400_000, 0)),
    });
  };

  for (const ev of sorted) {
    if (!firstAt) firstAt = ev.at;
    if (ev.status !== 'UNKNOWN') storeState.set(ev.key, IN_STOCK_STATUSES.has(ev.status));
    const overall: 'in' | 'out' = [...storeState.values()].some(Boolean) ? 'in' : 'out';

    if (current === null) {
      current = overall;
      segStart = ev.at;
    } else if (overall !== current) {
      pushSeg(current, segStart!, ev.at);
      if (overall === 'in') restockCount++;
      current = overall;
      segStart = ev.at;
    }
  }
  if (current !== null && segStart) pushSeg(current, segStart, now);

  return { segments, restockCount, firstAt: firstAt ? firstAt.toISOString() : null };
}

export function summarizeRestocks(
  rows: RestockRow[],
  timezone: string,
  now: Date = new Date(),
  opts: { minEvents?: number; minSpanDays?: number } = {}
): RestockSummary {
  const minEvents = opts.minEvents ?? 3;
  const minSpanDays = opts.minSpanDays ?? 14;
  const tz = timezone || 'UTC';

  const byHour = new Array(24).fill(0);
  const byDayOfWeek = new Array(7).fill(0);
  const retailer = new Map<string, number>();
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (const r of rows) {
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    let h: number;
    let dow: number;
    try {
      h = hourInTz(d, tz);
      dow = dowInTz(d, tz);
    } catch {
      h = hourInTz(d, 'UTC');
      dow = dowInTz(d, 'UTC');
    }
    byHour[h]++;
    byDayOfWeek[dow]++;
    retailer.set(r.storeSlug, (retailer.get(r.storeSlug) ?? 0) + 1);
    if (!firstAt || d < firstAt) firstAt = d;
    if (!lastAt || d > lastAt) lastAt = d;
  }

  const total = rows.length;
  const spanDays = firstAt ? Math.max((now.getTime() - firstAt.getTime()) / 86_400_000, 0) : 0;
  // Only report a rate once there's a meaningful sample AND enough history —
  // otherwise a couple of events over a few days extrapolates to nonsense.
  const restocksPerMonth =
    total >= minEvents && spanDays >= minSpanDays ? round1(total / (spanDays / 30.4375)) : null;
  const peakHour = total > 0 ? byHour.indexOf(Math.max(...byHour)) : null;
  const topRetailers = [...retailer.entries()]
    .map(([storeSlug, count]) => ({ storeSlug, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    spanDays: round1(spanDays),
    restocksPerMonth,
    peakHour,
    byHour,
    byDayOfWeek,
    topRetailers,
    firstAt,
    lastAt,
  };
}
