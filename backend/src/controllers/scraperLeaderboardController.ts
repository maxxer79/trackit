/**
 * Scraper Performance Leaderboard + Retailer Outage Detector.
 *
 * Reuses the ScraperLog rows the scheduled worker already writes — no new
 * table. Aggregates the rolling window two ways:
 *   • leaderboard — every active retailer ranked best→worst by a composite
 *     performance score (success rate weighted, response speed as tie-break).
 *   • outages — retailers currently failing, each classified as an en-masse
 *     outage (whole scraper down) vs an isolated bad listing, with the dominant
 *     failure reason (blocked / error / unknown) so the admin knows the cause.
 *
 * Advisory only — like the health view, it never disables a scraper.
 */
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import {
  rankRetailers,
  classifyOutage,
  RetailerStat,
  OutageEntry,
  OutageSeverity,
} from '../scrapers/leaderboard';
import logger from '../utils/logger';

/** A listing counts as "failing" once this share of its checks are non-success. */
const LISTING_FAIL_THRESHOLD = 0.7;
/** …and only once it has at least this many checks (avoid one-off noise). */
const LISTING_MIN_ATTEMPTS = 3;

type FailureType = 'blocked' | 'error' | 'unknown';

export interface LeaderboardOutageEntry extends OutageEntry {
  dominantFailureType: FailureType | null;
}

/** GET /admin/scrapers/leaderboard?hours=24 */
export const getScraperLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? '24'), 10) || 24, 1), 24 * 30);
    const since = new Date(Date.now() - hours * 3_600_000);

    const [byStatus, totals, perListing, perListingFails, failTypeCounts, stores] = await Promise.all([
      // status mix per store (success / unknown / blocked / error)
      prisma.scraperLog.groupBy({
        by: ['storeSlug', 'status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // total checks + avg duration per store
      prisma.scraperLog.groupBy({
        by: ['storeSlug'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { duration: true },
      }),
      // checks per (store, listing) — for distinct-listing counts
      prisma.scraperLog.groupBy({
        by: ['storeSlug', 'productSlug'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // non-success checks per (store, listing) — for the failing-listing test
      prisma.scraperLog.groupBy({
        by: ['storeSlug', 'productSlug'],
        where: { createdAt: { gte: since }, status: { not: 'success' } },
        _count: { _all: true },
      }),
      // non-success status mix per store — to name the dominant failure reason
      prisma.scraperLog.groupBy({
        by: ['storeSlug', 'status'],
        where: { createdAt: { gte: since }, status: { not: 'success' } },
        _count: { _all: true },
      }),
      // only retailers that still exist AND have an active listing
      prisma.store.findMany({
        where: { isActive: true, products: { some: { isActive: true } } },
        select: { slug: true, name: true },
      }),
    ]);

    const nameBy = new Map(stores.map((s) => [s.slug, s.name]));
    const slugs = stores.map((s) => s.slug);

    const totalsBy = new Map(totals.map((t) => [t.storeSlug, t]));

    const successBy = new Map<string, number>();
    for (const row of byStatus) {
      if (row.status === 'success') successBy.set(row.storeSlug, row._count._all);
    }

    // distinct listings + failing listings per store
    const failByKey = new Map(perListingFails.map((f) => [`${f.storeSlug}|${f.productSlug}`, f._count._all]));
    const listingsTotalBy = new Map<string, number>();
    const listingsFailingBy = new Map<string, number>();
    for (const l of perListing) {
      listingsTotalBy.set(l.storeSlug, (listingsTotalBy.get(l.storeSlug) ?? 0) + 1);
      const attempts = l._count._all;
      if (attempts < LISTING_MIN_ATTEMPTS) continue;
      const failed = failByKey.get(`${l.storeSlug}|${l.productSlug}`) ?? 0;
      if (failed / attempts >= LISTING_FAIL_THRESHOLD) {
        listingsFailingBy.set(l.storeSlug, (listingsFailingBy.get(l.storeSlug) ?? 0) + 1);
      }
    }

    // dominant failure type per store
    const failTypeBy = new Map<string, Record<string, number>>();
    for (const row of failTypeCounts) {
      const m = failTypeBy.get(row.storeSlug) ?? {};
      m[row.status] = row._count._all;
      failTypeBy.set(row.storeSlug, m);
    }
    const dominantFailure = (slug: string): FailureType | null => {
      const m = failTypeBy.get(slug);
      if (!m) return null;
      let best: FailureType | null = null;
      let bestN = 0;
      for (const t of ['blocked', 'error', 'unknown'] as FailureType[]) {
        if ((m[t] ?? 0) > bestN) {
          bestN = m[t];
          best = t;
        }
      }
      return best;
    };

    const stats: RetailerStat[] = slugs.map((slug) => ({
      storeSlug: slug,
      storeName: nameBy.get(slug) ?? slug,
      total: totalsBy.get(slug)?._count._all ?? 0,
      success: successBy.get(slug) ?? 0,
      avgDurationMs:
        totalsBy.get(slug)?._avg.duration != null ? Math.round(totalsBy.get(slug)!._avg.duration!) : null,
      listingsTotal: listingsTotalBy.get(slug) ?? 0,
      listingsFailing: listingsFailingBy.get(slug) ?? 0,
    }));

    const leaderboard = rankRetailers(stats);

    const severityOrder: Record<OutageSeverity, number> = { outage: 0, partial: 1, isolated: 2, ok: 3 };
    const outages: LeaderboardOutageEntry[] = stats
      .map((s) => {
        const severity = classifyOutage(s.listingsTotal, s.listingsFailing, s.total);
        return {
          storeSlug: s.storeSlug,
          storeName: s.storeName,
          severity,
          listingsTotal: s.listingsTotal,
          listingsFailing: s.listingsFailing,
          failingFraction: s.listingsTotal > 0 ? s.listingsFailing / s.listingsTotal : 0,
          dominantFailureType: dominantFailure(s.storeSlug),
        };
      })
      .filter((o) => o.severity !== 'ok')
      .sort(
        (a, b) =>
          severityOrder[a.severity] - severityOrder[b.severity] ||
          b.failingFraction - a.failingFraction ||
          b.listingsFailing - a.listingsFailing
      );

    res.json({ windowHours: hours, generatedAt: new Date().toISOString(), leaderboard, outages });
  } catch (error: any) {
    logger.error('getScraperLeaderboard error', error);
    res.status(500).json({ error: 'Failed to compute scraper leaderboard', message: error.message });
  }
};
