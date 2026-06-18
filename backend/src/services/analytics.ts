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

export function restockFrequency(
  rows: StatusRow[],
  opts: { minIntervals?: number } = {}
): RestockFrequency {
  const minIntervals = opts.minIntervals ?? 2; // ≥2 intervals ⇒ ≥3 restocks

  const sorted = rows
    .map((r) => ({ status: r.status, at: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt) }))
    .filter((r) => !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const restockTimes: Date[] = [];
  let prevInStock: boolean | null = null;
  for (const r of sorted) {
    const nowIn = isInStock(r.status);
    // A restock is a transition into stock from a known out-of-stock state.
    if (nowIn && prevInStock === false) restockTimes.push(r.at);
    // UNKNOWN never flips the stock state (matches the scraper rule).
    if (r.status !== 'UNKNOWN') prevInStock = nowIn;
  }

  const intervals: number[] = [];
  for (let i = 1; i < restockTimes.length; i++) {
    intervals.push((restockTimes[i].getTime() - restockTimes[i - 1].getTime()) / 86_400_000);
  }

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
