/**
 * Pure scraper-leaderboard + outage classification over ScraperLog aggregates.
 * No DB access here — the controller groups the rows and feeds counts in, so
 * every rule below is deterministic and unit-testable.
 *
 * Two questions this answers:
 *   1. Leaderboard — rank retailers best→worst by a composite performance score
 *      (success rate weighted heavily, response speed as a tie-breaker).
 *   2. Outage detector — when a retailer IS failing, is the whole scraper down
 *      (most/all of its listings failing == "en masse") or is it just one dead
 *      listing among healthy ones ("isolated")? The distinction tells the admin
 *      whether to fix the scraper or just deactivate a bad URL.
 */

/** A retailer is "failing en masse" only if it has enough listings to judge. */
export const MIN_LISTINGS_FOR_OUTAGE = 2;
/** Below this many total checks in the window we don't cry wolf. */
export const MIN_CHECKS_FOR_OUTAGE = 3;
/** Fraction of distinct listings failing that flips a retailer to "outage". */
export const OUTAGE_FRACTION = 0.8;
/** …and to "partial". */
export const PARTIAL_FRACTION = 0.4;

/** Weight of success rate vs raw speed in the 0–100 performance score. */
export const SUCCESS_WEIGHT = 0.85;
export const SPEED_WEIGHT = 0.15;
/** Speed scoring band: ≤fast == perfect, ≥slow == zero, linear between. */
export const FAST_MS = 800;
export const SLOW_MS = 12_000;

export interface RetailerStat {
  storeSlug: string;
  storeName: string;
  total: number; // total checks in window
  success: number; // definitive success checks
  avgDurationMs: number | null; // mean check duration, null if none recorded
  listingsTotal: number; // distinct listings checked
  listingsFailing: number; // distinct listings that mostly failed
}

export interface LeaderboardEntry extends RetailerStat {
  rank: number; // 1-based; entries with no data share the bottom
  successRate: number | null; // 0..1, null when total === 0
  score: number; // 0..100 composite
  hasData: boolean;
}

export type OutageSeverity = 'outage' | 'partial' | 'isolated' | 'ok';

export interface OutageEntry {
  storeSlug: string;
  storeName: string;
  severity: OutageSeverity;
  listingsTotal: number;
  listingsFailing: number;
  failingFraction: number; // 0..1 of distinct listings failing
}

/** 1.0 when as fast as FAST_MS or quicker, 0.0 at/over SLOW_MS, linear between. */
export function speedScore(avgDurationMs: number | null): number {
  if (avgDurationMs == null) return 0.5; // unknown speed → neutral, never punished as if slow
  if (avgDurationMs <= FAST_MS) return 1;
  if (avgDurationMs >= SLOW_MS) return 0;
  return 1 - (avgDurationMs - FAST_MS) / (SLOW_MS - FAST_MS);
}

/**
 * Composite 0–100. Success rate dominates; speed is a small tie-breaker so a
 * fast-but-broken scraper never outranks a slower reliable one. No data → 0.
 */
export function performanceScore(total: number, success: number, avgDurationMs: number | null): number {
  if (total <= 0) return 0;
  const successRate = success / total;
  const raw = successRate * SUCCESS_WEIGHT + speedScore(avgDurationMs) * SPEED_WEIGHT;
  return Math.round(raw * 100);
}

/**
 * Rank retailers best→worst. Sort key: score desc, then success rate desc, then
 * faster avg first, then name for stability. Retailers with zero checks keep a
 * rank but are flagged hasData=false so the UI can grey them out / skip medals.
 */
export function rankRetailers(stats: RetailerStat[]): LeaderboardEntry[] {
  const scored = stats.map((s) => ({
    ...s,
    successRate: s.total > 0 ? s.success / s.total : null,
    score: performanceScore(s.total, s.success, s.avgDurationMs),
    hasData: s.total > 0,
  }));

  scored.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1; // data before no-data
    if (b.score !== a.score) return b.score - a.score;
    const ar = a.successRate ?? 0;
    const br = b.successRate ?? 0;
    if (br !== ar) return br - ar;
    const ad = a.avgDurationMs ?? Number.POSITIVE_INFINITY;
    const bd = b.avgDurationMs ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.storeName.localeCompare(b.storeName);
  });

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Is this retailer's failure an en-masse outage or an isolated bad listing?
 *   outage   — many listings checked and ≥80% of them failing (scraper-wide)
 *   partial  — ≥2 listings and 40–80% failing (degrading, watch closely)
 *   isolated — at least one failing listing but the rest are fine
 *   ok       — nothing failing, or too little data to judge
 */
export function classifyOutage(
  listingsTotal: number,
  listingsFailing: number,
  totalChecks: number
): OutageSeverity {
  if (totalChecks < MIN_CHECKS_FOR_OUTAGE) return 'ok';
  if (listingsFailing <= 0) return 'ok';
  const frac = listingsTotal > 0 ? listingsFailing / listingsTotal : 0;
  if (listingsTotal >= MIN_LISTINGS_FOR_OUTAGE && frac >= OUTAGE_FRACTION) return 'outage';
  if (listingsTotal >= MIN_LISTINGS_FOR_OUTAGE && frac >= PARTIAL_FRACTION) return 'partial';
  return 'isolated';
}
