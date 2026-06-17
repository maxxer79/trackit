import { describe, it, expect } from 'vitest';
import { PerKeyRateLimiter } from './rateLimiter';

/** Clock that advances when the limiter "sleeps" — models one sequential caller. */
function sequentialHarness(interval: number) {
  let clock = 0;
  const sleeps: number[] = [];
  const limiter = new PerKeyRateLimiter(interval, {
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { limiter, sleeps };
}

/** Fixed clock; sleep records but does NOT advance — models simultaneous callers. */
function concurrentHarness(interval: number) {
  const sleeps: number[] = [];
  const limiter = new PerKeyRateLimiter(interval, {
    now: () => 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  return { limiter, sleeps };
}

describe('PerKeyRateLimiter', () => {
  it('does not delay the first request for a key', async () => {
    const { limiter, sleeps } = sequentialHarness(1000);
    await limiter.acquire('amazon');
    expect(sleeps).toEqual([]);
  });

  it('spaces sequential same-key requests by the interval', async () => {
    const { limiter, sleeps } = sequentialHarness(1000);
    await limiter.acquire('amazon');
    await limiter.acquire('amazon');
    await limiter.acquire('amazon');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('treats different keys independently', async () => {
    const { limiter, sleeps } = sequentialHarness(1000);
    await limiter.acquire('amazon');
    await limiter.acquire('bestbuy');
    expect(sleeps).toEqual([]);
  });

  it('reserves sequential slots for simultaneous same-key callers', async () => {
    const { limiter, sleeps } = concurrentHarness(1000);
    // Issue three at the "same instant" without awaiting between them.
    const p1 = limiter.acquire('amazon');
    const p2 = limiter.acquire('amazon');
    const p3 = limiter.acquire('amazon');
    await Promise.all([p1, p2, p3]);
    // p1 proceeds now; p2 waits one interval; p3 waits two.
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('is a no-op when the interval is zero', async () => {
    const { limiter, sleeps } = sequentialHarness(0);
    await limiter.acquire('amazon');
    await limiter.acquire('amazon');
    expect(sleeps).toEqual([]);
  });
});
