import { describe, it, expect } from 'vitest';
import {
  speedScore,
  performanceScore,
  rankRetailers,
  classifyOutage,
  confidenceLevel,
  MIN_CHECKS_FOR_CONFIDENCE,
  RetailerStat,
} from './leaderboard';

describe('speedScore', () => {
  it('is neutral (0.5) when duration is unknown', () => {
    expect(speedScore(null)).toBe(0.5);
  });
  it('is perfect at or below the fast band', () => {
    expect(speedScore(800)).toBe(1);
    expect(speedScore(200)).toBe(1);
  });
  it('is zero at or above the slow band', () => {
    expect(speedScore(12_000)).toBe(0);
    expect(speedScore(30_000)).toBe(0);
  });
  it('falls linearly between the bands', () => {
    // midpoint of 800..12000 is 6400 → ~0.5
    expect(speedScore(6400)).toBeCloseTo(0.5, 2);
  });
});

describe('performanceScore', () => {
  it('is 0 with no checks', () => {
    expect(performanceScore(0, 0, null)).toBe(0);
  });
  it('rewards a perfect, fast scraper near 100', () => {
    expect(performanceScore(100, 100, 500)).toBe(100);
  });
  it('weights success rate above speed', () => {
    // 100% success but slow still beats 50% success but instant
    const reliableSlow = performanceScore(100, 100, 12_000); // 0.85*100 + 0 = 85
    const flakyFast = performanceScore(100, 50, 200); // 0.425 + 0.15 = ~58
    expect(reliableSlow).toBeGreaterThan(flakyFast);
  });
  it('gives a fully broken scraper a low score', () => {
    expect(performanceScore(20, 0, 9000)).toBeLessThanOrEqual(5);
  });
});

describe('rankRetailers', () => {
  const stat = (over: Partial<RetailerStat>): RetailerStat => ({
    storeSlug: 's',
    storeName: 'S',
    total: 10,
    success: 10,
    avgDurationMs: 1000,
    listingsTotal: 5,
    listingsFailing: 0,
    ...over,
  });

  it('ranks the best performer first', () => {
    const ranked = rankRetailers([
      stat({ storeSlug: 'mid', storeName: 'Mid', success: 7 }),
      stat({ storeSlug: 'best', storeName: 'Best', success: 10 }),
      stat({ storeSlug: 'worst', storeName: 'Worst', success: 2 }),
    ]);
    expect(ranked.map((r) => r.storeSlug)).toEqual(['best', 'mid', 'worst']);
    expect(ranked[0].rank).toBe(1);
  });

  it('pushes no-data retailers to the bottom and flags them', () => {
    const ranked = rankRetailers([
      stat({ storeSlug: 'nodata', storeName: 'NoData', total: 0, success: 0, avgDurationMs: null }),
      stat({ storeSlug: 'live', storeName: 'Live', success: 9 }),
    ]);
    expect(ranked[0].storeSlug).toBe('live');
    expect(ranked[1].storeSlug).toBe('nodata');
    expect(ranked[1].hasData).toBe(false);
    expect(ranked[1].successRate).toBeNull();
  });

  it('breaks score ties by speed (faster first)', () => {
    const ranked = rankRetailers([
      stat({ storeSlug: 'slow', storeName: 'Slow', avgDurationMs: 9000 }),
      stat({ storeSlug: 'fast', storeName: 'Fast', avgDurationMs: 600 }),
    ]);
    expect(ranked[0].storeSlug).toBe('fast');
  });
});

describe('classifyOutage', () => {
  it('returns ok when there is too little data', () => {
    expect(classifyOutage(5, 5, 2)).toBe('ok'); // < MIN_CHECKS
  });
  it('returns ok when nothing is failing', () => {
    expect(classifyOutage(5, 0, 50)).toBe('ok');
  });
  it('flags an en-masse outage when ≥80% of listings fail', () => {
    expect(classifyOutage(5, 5, 50)).toBe('outage');
    expect(classifyOutage(10, 8, 40)).toBe('outage');
  });
  it('flags partial degradation in the 40–80% band', () => {
    expect(classifyOutage(10, 5, 40)).toBe('partial'); // 50%
  });
  it('flags an isolated bad listing when most are healthy', () => {
    expect(classifyOutage(10, 1, 40)).toBe('isolated'); // 10%
  });
  it('treats a lone failing listing as isolated, not an outage', () => {
    // Only one listing exists — can't prove the whole scraper is down.
    expect(classifyOutage(1, 1, 10)).toBe('isolated');
  });
});

describe('confidenceLevel', () => {
  it('is unverified below the minimum check count, regardless of score', () => {
    expect(confidenceLevel(100, MIN_CHECKS_FOR_CONFIDENCE - 1)).toBe('unverified');
    expect(confidenceLevel(0, 0)).toBe('unverified');
  });
  it('is high at/above 80 once there is enough data', () => {
    expect(confidenceLevel(80, MIN_CHECKS_FOR_CONFIDENCE)).toBe('high');
    expect(confidenceLevel(100, 50)).toBe('high');
  });
  it('is medium in the 50–79 band', () => {
    expect(confidenceLevel(50, 10)).toBe('medium');
    expect(confidenceLevel(79, 10)).toBe('medium');
  });
  it('is low below 50', () => {
    expect(confidenceLevel(49, 10)).toBe('low');
    expect(confidenceLevel(0, 10)).toBe('low');
  });
  it('agrees with performanceScore for a realistic flaky listing', () => {
    // 5 checks, 1 success, slow → should land as low, not silently high
    const score = performanceScore(5, 1, 11_000);
    expect(confidenceLevel(score, 5)).toBe('low');
  });
});
