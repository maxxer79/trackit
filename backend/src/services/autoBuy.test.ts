import { describe, it, expect } from 'vitest';
import { autoBuyOutcome } from './autoBuy';

describe('autoBuyOutcome', () => {
  it('TRIGGERED when price is at or below the max', () => {
    expect(autoBuyOutcome(90, 100)).toBe('TRIGGERED');
    expect(autoBuyOutcome(100, 100)).toBe('TRIGGERED'); // boundary: <= max
  });

  it('SKIPPED_OVER_MAX when price strictly exceeds the max', () => {
    expect(autoBuyOutcome(120, 100)).toBe('SKIPPED_OVER_MAX');
  });

  it('TRIGGERED when there is no max (no cap)', () => {
    expect(autoBuyOutcome(9999, null)).toBe('TRIGGERED');
    expect(autoBuyOutcome(9999, undefined)).toBe('TRIGGERED');
  });

  it('TRIGGERED when price is unknown (cannot compare)', () => {
    expect(autoBuyOutcome(null, 100)).toBe('TRIGGERED');
    expect(autoBuyOutcome(undefined, 100)).toBe('TRIGGERED');
  });
});
