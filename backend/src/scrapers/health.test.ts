import { describe, it, expect } from 'vitest';
import { classifyHealth } from './health';

describe('classifyHealth', () => {
  it('returns no_data when there were no attempts', () => {
    expect(classifyHealth(0, 0)).toBe('no_data');
  });

  it('returns down when there are attempts but zero successes', () => {
    expect(classifyHealth(10, 0)).toBe('down');
  });

  it('returns degraded below the 70% threshold', () => {
    expect(classifyHealth(10, 6)).toBe('degraded'); // 60%
    expect(classifyHealth(100, 69)).toBe('degraded');
  });

  it('returns healthy at or above the 70% threshold', () => {
    expect(classifyHealth(10, 7)).toBe('healthy'); // 70%
    expect(classifyHealth(10, 10)).toBe('healthy');
  });
});
