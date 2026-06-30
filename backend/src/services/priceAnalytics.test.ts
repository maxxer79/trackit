import { describe, it, expect } from 'vitest';
import { priceInsight, productPriceInsight, purchaseSavings, PriceEvent, PurchaseRow } from './priceAnalytics';

const NOW = new Date('2026-06-30T12:00:00Z');
const DAY = 86_400_000;

/** Build a priced StockEvent `daysAgo` before NOW. */
function ev(daysAgo: number, price: number | null, status = 'IN_STOCK', store = 'bestbuy'): PriceEvent {
  return {
    status,
    price,
    createdAt: new Date(NOW.getTime() - daysAgo * DAY),
    storeSlug: store,
    storeName: store,
  };
}

describe('priceInsight — time weighting', () => {
  it('weights by duration, not event count (a 1-day spike barely moves the average)', () => {
    // 100 for ~88 days, a 1-day spike to 200, back to 100 now.
    const events = [ev(89, 100), ev(2, 200), ev(1, 100)];
    const r = priceInsight(events, { now: NOW });
    // Naive mean would be (100+200+100)/3 = 133. Time-weighted is ~101.
    expect(r.timeWeightedAvg).toBeLessThan(105);
    expect(r.timeWeightedAvg).toBeGreaterThan(100);
    expect(r.windowLow).toBe(100);
    expect(r.windowHigh).toBe(200);
  });

  it('flags the window low as the best possible deal', () => {
    const events = [ev(89, 100), ev(2, 200), ev(1, 100)];
    const r = priceInsight(events, { now: NOW });
    expect(r.current).toBe(100);
    expect(r.verdict).toBe('lowest');
    expect(r.confidence).toBe('high');
  });
});

describe('priceInsight — verdicts', () => {
  it('calls a fresh drop below a long-standing high a "great" deal', () => {
    // brief low at 160, sat at 200 for most of the window, just dropped to 170.
    const events = [ev(89, 160), ev(88, 200), ev(1, 170)];
    const r = priceInsight(events, { now: NOW });
    expect(r.windowLow).toBe(160); // not the lowest, so not "lowest"
    expect(r.cheapness).toBeGreaterThan(0.85);
    expect(r.verdict).toBe('great');
  });

  it('calls a price sitting at its window peak "high"', () => {
    const events = [ev(89, 100), ev(1, 150)];
    const r = priceInsight(events, { now: NOW });
    expect(r.current).toBe(150);
    expect(r.windowHigh).toBe(150);
    expect(r.verdict).toBe('high');
  });
});

describe('priceInsight — honesty guards', () => {
  it('stays quiet (null verdict) on a single priced point', () => {
    const r = priceInsight([ev(1, 100)], { now: NOW });
    expect(r.current).toBe(100);
    expect(r.confidence).toBeNull();
    expect(r.verdict).toBeNull();
  });

  it('returns empty when there are no priced events', () => {
    const r = priceInsight([ev(5, null), ev(1, null)], { now: NOW });
    expect(r.current).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.timeWeightedAvg).toBeNull();
  });

  it('gives no verdict when the price has been perfectly flat (no spread to judge)', () => {
    const r = priceInsight([ev(89, 100), ev(40, 100), ev(2, 100)], { now: NOW });
    expect(r.confidence).toBe('high'); // we DO have plenty of data
    expect(r.windowLow).toBe(r.windowHigh);
    expect(r.verdict).toBeNull(); // ...but nothing meaningful to say
  });

  it('ignores a cheap price that was superseded before the window started', () => {
    // 50 was the price 200 days ago but rose to 300 at 100 days ago — before the
    // 90-day window — so it never holds inside the window and must not set the low.
    const events = [ev(200, 50), ev(100, 300), ev(1, 300)];
    const r = priceInsight(events, { windowDays: 90, now: NOW });
    expect(r.windowLow).toBe(300);
  });

  it('carries a pre-window price forward into the window (step function)', () => {
    // 50 held from 200 days ago until 80 days ago — so for the first 10 days of
    // the 90-day window the price genuinely WAS 50. The low must reflect that.
    const events = [ev(200, 50), ev(80, 300), ev(1, 300)];
    const r = priceInsight(events, { windowDays: 90, now: NOW });
    expect(r.windowLow).toBe(50);
  });
});

describe('productPriceInsight — per-store headline', () => {
  it('picks the in-stock store with the lowest current price', () => {
    const events: PriceEvent[] = [
      ev(89, 520, 'IN_STOCK', 'bestbuy'), ev(2, 500, 'IN_STOCK', 'bestbuy'),
      ev(89, 470, 'IN_STOCK', 'amazon'), ev(2, 450, 'IN_STOCK', 'amazon'),
    ];
    const r = productPriceInsight(events, { now: NOW });
    expect(r.storeSlug).toBe('amazon');
    expect(r.current).toBe(450);
    expect(r.inStock).toBe(true);
  });

  it('skips a cheaper store that is currently out of stock', () => {
    const events: PriceEvent[] = [
      ev(89, 520, 'IN_STOCK', 'bestbuy'), ev(2, 500, 'IN_STOCK', 'bestbuy'),
      ev(89, 470, 'IN_STOCK', 'amazon'), ev(2, 450, 'OUT_OF_STOCK', 'amazon'),
    ];
    const r = productPriceInsight(events, { now: NOW });
    expect(r.storeSlug).toBe('bestbuy');
    expect(r.inStock).toBe(true);
  });
});

describe('purchaseSavings', () => {
  const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
  const events = new Map<string, PriceEvent[]>([
    ['p1', [ev(120, 200, 'IN_STOCK', 'bb'), ev(30, 200, 'IN_STOCK', 'bb'), ev(10, 160, 'IN_STOCK', 'bb')]],
  ]);

  it('values a purchase against its typical price at purchase time', () => {
    const rows: PurchaseRow[] = [
      { id: 'a', productId: 'p1', price: 150, storeSlug: 'bb', purchasedAt: at(5), productName: 'X', storeName: 'bb' },
    ];
    const r = purchaseSavings(rows, events, {});
    expect(r.rows[0].reference).toBeCloseTo(197.78, 1);
    expect(r.rows[0].saved).toBeCloseTo(47.78, 1);
    expect(r.rows[0].confidence).toBe('high');
    expect(r.counted).toBe(1);
    expect(r.totalSaved).toBeCloseTo(47.78, 1);
  });

  it('reports a negative saved when you overpaid', () => {
    const rows: PurchaseRow[] = [{ id: 'b', productId: 'p1', price: 250, storeSlug: 'bb', purchasedAt: at(5) }];
    const r = purchaseSavings(rows, events, {});
    expect(r.rows[0].saved).toBeLessThan(0);
    expect(r.counted).toBe(1);
  });

  it('skips purchases with no usable price history (no hindsight, no guess)', () => {
    const rows: PurchaseRow[] = [{ id: 'c', productId: 'unknown', price: 100, purchasedAt: at(5) }];
    const r = purchaseSavings(rows, events, {});
    expect(r.rows[0].saved).toBeNull();
    expect(r.counted).toBe(0);
    expect(r.totalSaved).toBe(0);
  });

  it('scopes the reference to the store the user bought from', () => {
    const noisy = new Map<string, PriceEvent[]>([
      ['p1', [ev(120, 200, 'IN_STOCK', 'bb'), ev(30, 200, 'IN_STOCK', 'bb'), ev(10, 160, 'IN_STOCK', 'bb'),
        ev(60, 999, 'IN_STOCK', 'ebay'), ev(20, 5, 'IN_STOCK', 'ebay')]],
    ]);
    const rows: PurchaseRow[] = [{ id: 'd', productId: 'p1', price: 150, storeSlug: 'bb', purchasedAt: at(5) }];
    const r = purchaseSavings(rows, noisy, {});
    expect(r.rows[0].reference).toBeCloseTo(197.78, 1);
  });
});
