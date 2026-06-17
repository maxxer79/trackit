import { describe, it, expect } from 'vitest';
import { retentionCutoff } from './prune';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe('retentionCutoff', () => {
  it('returns a cutoff `days` in the past for a positive window', () => {
    expect(retentionCutoff(30, NOW)?.getTime()).toBe(NOW - 30 * DAY);
  });

  it('returns null when disabled (0 days)', () => {
    expect(retentionCutoff(0, NOW)).toBeNull();
  });

  it('returns null for a negative/garbage window', () => {
    expect(retentionCutoff(-5, NOW)).toBeNull();
  });
});
