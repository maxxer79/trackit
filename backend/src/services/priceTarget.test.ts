import { describe, it, expect } from 'vitest';
import { crossedPriceTarget, isNewLow } from './priceTarget';

describe('crossedPriceTarget', () => {
  it('fires on a downward crossing through the target', () => {
    expect(crossedPriceTarget(120, 95, 100)).toBe(true);
    expect(crossedPriceTarget(100.01, 100, 100)).toBe(true); // exactly at target
  });
  it('fires once on first observation already at/below target', () => {
    expect(crossedPriceTarget(null, 90, 100)).toBe(true);
    expect(crossedPriceTarget(undefined, 100, 100)).toBe(true);
  });
  it('does not re-fire while the price stays at/below target', () => {
    expect(crossedPriceTarget(95, 90, 100)).toBe(false);
    expect(crossedPriceTarget(100, 100, 100)).toBe(false);
  });
  it('does not fire when the price is above the target', () => {
    expect(crossedPriceTarget(120, 110, 100)).toBe(false);
  });
  it('does not fire without a usable target or price', () => {
    expect(crossedPriceTarget(120, 90, null)).toBe(false);
    expect(crossedPriceTarget(120, 90, 0)).toBe(false);
    expect(crossedPriceTarget(120, null, 100)).toBe(false);
    expect(crossedPriceTarget(120, 0, 100)).toBe(false);
  });
});

describe('isNewLow', () => {
  it('is true for the first known price', () => {
    expect(isNewLow(null, 50)).toBe(true);
    expect(isNewLow(0, 50)).toBe(true);
  });
  it('is true only when strictly below the recorded low', () => {
    expect(isNewLow(50, 49.99)).toBe(true);
    expect(isNewLow(50, 50)).toBe(false);
    expect(isNewLow(50, 60)).toBe(false);
  });
  it('ignores missing/non-positive new prices', () => {
    expect(isNewLow(50, null)).toBe(false);
    expect(isNewLow(50, 0)).toBe(false);
    expect(isNewLow(null, undefined)).toBe(false);
  });
});
