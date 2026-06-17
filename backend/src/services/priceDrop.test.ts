import { describe, it, expect } from 'vitest';
import { isPriceDrop } from './priceDrop';

describe('isPriceDrop', () => {
  it('fires on a meaningful drop (>= 1% by default)', () => {
    expect(isPriceDrop(100, 90)).toBe(true);
    expect(isPriceDrop(100, 99)).toBe(true); // exactly 1%
  });

  it('ignores tiny sub-threshold wobbles', () => {
    expect(isPriceDrop(100, 99.5)).toBe(false); // 0.5%
  });

  it('does not fire on increases or equal price', () => {
    expect(isPriceDrop(100, 110)).toBe(false);
    expect(isPriceDrop(100, 100)).toBe(false);
  });

  it('needs both prices known and positive', () => {
    expect(isPriceDrop(null, 90)).toBe(false);
    expect(isPriceDrop(100, null)).toBe(false);
    expect(isPriceDrop(0, -5)).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(isPriceDrop(100, 96, 0.05)).toBe(false); // 4% < 5%
    expect(isPriceDrop(100, 94, 0.05)).toBe(true); // 6% >= 5%
  });
});
