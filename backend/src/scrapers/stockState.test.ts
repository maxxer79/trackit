import { describe, it, expect } from 'vitest';
import { isInStock, isUnknown } from './stockState';

describe('isInStock', () => {
  it('treats IN_STOCK, LIMITED and PREORDER as buyable', () => {
    expect(isInStock('IN_STOCK')).toBe(true);
    expect(isInStock('LIMITED')).toBe(true);
    // A sellable preorder is buyable — this is the easy one to get wrong.
    expect(isInStock('PREORDER')).toBe(true);
  });

  it('treats OUT_OF_STOCK and UNKNOWN as not buyable', () => {
    expect(isInStock('OUT_OF_STOCK')).toBe(false);
    // UNKNOWN must never read as in-stock.
    expect(isInStock('UNKNOWN')).toBe(false);
  });
});

describe('isUnknown', () => {
  it('is true only for UNKNOWN', () => {
    expect(isUnknown('UNKNOWN')).toBe(true);
    expect(isUnknown('IN_STOCK')).toBe(false);
    expect(isUnknown('OUT_OF_STOCK')).toBe(false);
    expect(isUnknown('PREORDER')).toBe(false);
  });
});
