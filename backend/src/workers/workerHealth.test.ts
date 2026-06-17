import { describe, it, expect } from 'vitest';
import { evaluateStaleness } from './workerHealth';

const NOW = 1_000_000_000_000;

describe('evaluateStaleness', () => {
  it('is stale when there has never been a check', () => {
    const r = evaluateStaleness(null, 5, NOW);
    expect(r.stale).toBe(true);
    expect(r.ageMs).toBeNull();
  });

  it('is healthy for a recent check (within the window)', () => {
    const last = new Date(NOW - 4 * 60_000); // 4 min ago, window is 15 min (5×3)
    const r = evaluateStaleness(last, 5, NOW);
    expect(r.stale).toBe(false);
    expect(r.ageMs).toBe(4 * 60_000);
    expect(r.staleAfterMs).toBe(15 * 60_000);
  });

  it('is stale once the last check is older than ~3 cycles', () => {
    const last = new Date(NOW - 20 * 60_000); // 20 min ago > 15 min window
    expect(evaluateStaleness(last, 5, NOW).stale).toBe(true);
  });

  it('guards against a zero/garbage interval (treats as 1 min → 3 min window)', () => {
    expect(evaluateStaleness(new Date(NOW - 2 * 60_000), 0, NOW).stale).toBe(false);
    expect(evaluateStaleness(new Date(NOW - 4 * 60_000), 0, NOW).stale).toBe(true);
  });
});
