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
