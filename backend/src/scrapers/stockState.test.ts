import { describe, it, expect } from 'vitest';
import { isInStock, isUnknown, stockEventChanged } from './stockState';

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

describe('stockEventChanged', () => {
  it('records when the status changes', () => {
    expect(stockEventChanged(
      { status: 'OUT_OF_STOCK', price: 100 },
      { status: 'IN_STOCK', price: 100 },
    )).toBe(true);
  });

  it('records the first check (no prior status)', () => {
    expect(stockEventChanged(
      { status: null, price: null },
      { status: 'IN_STOCK', price: 100 },
    )).toBe(true);
  });

  it('records when a known price changes but status is the same', () => {
    expect(stockEventChanged(
      { status: 'IN_STOCK', price: 100 },
      { status: 'IN_STOCK', price: 90 },
    )).toBe(true);
  });

  it('does NOT record when nothing changed', () => {
    expect(stockEventChanged(
      { status: 'IN_STOCK', price: 100 },
      { status: 'IN_STOCK', price: 100 },
    )).toBe(false);
  });

  it('does NOT treat a missing new price as a change', () => {
    expect(stockEventChanged(
      { status: 'IN_STOCK', price: 100 },
      { status: 'IN_STOCK', price: null },
    )).toBe(false);
  });
});
