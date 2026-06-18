import { describe, it, expect } from 'vitest';
import { summarizeRestocks, restockFrequency } from './analytics';

const day = (n: number) => new Date(2026, 0, n).toISOString(); // Jan n, local

describe('restockFrequency', () => {
  it('returns empty for no events', () => {
    const f = restockFrequency([]);
    expect(f.restockCount).toBe(0);
    expect(f.lastRestockAt).toBeNull();
    expect(f.medianIntervalDays).toBeNull();
    expect(f.intervalsCount).toBe(0);
  });

  it('counts only true out→in transitions, not price-change repeats', () => {
    const rows = [
      { status: 'OUT_OF_STOCK', createdAt: day(1) },
      { status: 'IN_STOCK', createdAt: day(2) }, // restock #1
      { status: 'IN_STOCK', createdAt: day(3) }, // price change while in stock — not a restock
      { status: 'OUT_OF_STOCK', createdAt: day(5) },
      { status: 'IN_STOCK', createdAt: day(12) }, // restock #2 (10d later)
      { status: 'OUT_OF_STOCK', createdAt: day(13) },
      { status: 'IN_STOCK', createdAt: day(22) }, // restock #3 (10d later)
    ];
    const f = restockFrequency(rows);
    expect(f.restockCount).toBe(3);
    expect(f.intervalsCount).toBe(2);
    expect(f.medianIntervalDays).toBe(10);
    expect(f.avgIntervalDays).toBe(10);
  });

  it('ignores UNKNOWN so it never fabricates a transition', () => {
    const rows = [
      { status: 'OUT_OF_STOCK', createdAt: day(1) },
      { status: 'UNKNOWN', createdAt: day(2) },
      { status: 'IN_STOCK', createdAt: day(3) }, // still a restock vs the OOS before UNKNOWN
    ];
    const f = restockFrequency(rows);
    expect(f.restockCount).toBe(1);
  });

  it('withholds an interval estimate until there are enough intervals', () => {
    const rows = [
      { status: 'OUT_OF_STOCK', createdAt: day(1) },
      { status: 'IN_STOCK', createdAt: day(2) },
      { status: 'OUT_OF_STOCK', createdAt: day(3) },
      { status: 'IN_STOCK', createdAt: day(8) }, // only 1 interval
    ];
    const f = restockFrequency(rows);
    expect(f.restockCount).toBe(2);
    expect(f.intervalsCount).toBe(1);
    expect(f.medianIntervalDays).toBeNull(); // not enough yet
    expect(f.lastRestockAt).not.toBeNull(); // but we still know the last restock
  });
});

const NOW = new Date('2026-06-30T12:00:00Z');

describe('summarizeRestocks', () => {
  it('returns an honest empty summary for no events', () => {
    const s = summarizeRestocks([], 'UTC', NOW);
    expect(s.total).toBe(0);
    expect(s.restocksPerMonth).toBeNull();
    expect(s.peakHour).toBeNull();
    expect(s.byHour).toHaveLength(24);
    expect(s.byHour.every((n) => n === 0)).toBe(true);
    expect(s.topRetailers).toEqual([]);
  });

  it('buckets by local hour and finds the peak', () => {
    const rows = [
      { createdAt: '2026-06-01T14:00:00Z', storeSlug: 'amazon' },
      { createdAt: '2026-06-02T14:30:00Z', storeSlug: 'amazon' },
      { createdAt: '2026-06-03T09:00:00Z', storeSlug: 'bestbuy' },
    ];
    const s = summarizeRestocks(rows, 'UTC', NOW);
    expect(s.byHour[14]).toBe(2);
    expect(s.byHour[9]).toBe(1);
    expect(s.peakHour).toBe(14);
  });

  it('shifts the hour into the user timezone', () => {
    // 14:00 UTC = 10:00 in New York (EDT)
    const s = summarizeRestocks([{ createdAt: '2026-06-01T14:00:00Z', storeSlug: 'amazon' }], 'America/New_York', NOW);
    expect(s.peakHour).toBe(10);
  });

  it('ranks retailers by frequency', () => {
    const rows = [
      { createdAt: '2026-06-01T10:00:00Z', storeSlug: 'amazon' },
      { createdAt: '2026-06-02T10:00:00Z', storeSlug: 'bestbuy' },
      { createdAt: '2026-06-03T10:00:00Z', storeSlug: 'bestbuy' },
    ];
    const s = summarizeRestocks(rows, 'UTC', NOW);
    expect(s.topRetailers[0]).toEqual({ storeSlug: 'bestbuy', count: 2 });
    expect(s.topRetailers[1]).toEqual({ storeSlug: 'amazon', count: 1 });
  });

  it('reports a per-month rate only with enough events AND history', () => {
    // 8 events spread over ~58 days → a real rate.
    const rows = Array.from({ length: 8 }, (_, i) => ({
      createdAt: new Date(NOW.getTime() - (58 - i * 7) * 86_400_000).toISOString(),
      storeSlug: 'amazon',
    }));
    const s = summarizeRestocks(rows, 'UTC', NOW);
    expect(s.restocksPerMonth).not.toBeNull();
    expect(s.restocksPerMonth!).toBeGreaterThan(0);

    // 2 events over 3 days → not enough; null rather than extrapolating.
    const few = [
      { createdAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), storeSlug: 'amazon' },
      { createdAt: new Date(NOW.getTime() - 1 * 86_400_000).toISOString(), storeSlug: 'amazon' },
    ];
    expect(summarizeRestocks(few, 'UTC', NOW).restocksPerMonth).toBeNull();
  });
});
