import { describe, it, expect, vi } from 'vitest';
import { isTransientError, backoffDelay, withRetry } from './retry';

describe('isTransientError', () => {
  it('flags network-level errors and retryable 5xx/408', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError({ response: { status: 503 } })).toBe(true);
    expect(isTransientError({ response: { status: 500 } })).toBe(true);
    expect(isTransientError({ response: { status: 408 } })).toBe(true);
    expect(isTransientError({ message: 'timeout of 15000ms exceeded' })).toBe(true);
  });

  it('does NOT flag bot-blocks, 429, or ordinary 4xx', () => {
    expect(isTransientError({ response: { status: 403 } })).toBe(false);
    expect(isTransientError({ response: { status: 429 } })).toBe(false);
    expect(isTransientError({ response: { status: 404 } })).toBe(false);
    expect(isTransientError(new Error('parse failed'))).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('is bounded by the exponential cap and the max', () => {
    // full-jitter: random=1 returns the full cap
    expect(backoffDelay(0, 300, 3000, () => 1)).toBe(300);
    expect(backoffDelay(1, 300, 3000, () => 1)).toBe(600);
    expect(backoffDelay(2, 300, 3000, () => 1)).toBe(1200);
    // capped at maxDelayMs no matter how high the attempt
    expect(backoffDelay(10, 300, 3000, () => 1)).toBe(3000);
    // random=0 floors to 0
    expect(backoffDelay(5, 300, 3000, () => 0)).toBe(0);
  });
});

describe('withRetry', () => {
  const noSleep = async () => {};

  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep: noSleep, random: () => 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(withRetry(fn, { sleep: noSleep, random: () => 0, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].attempt).toBe(1);
  });

  it('does not retry a non-transient error', async () => {
    const err = { response: { status: 403 } };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured retries and throws the last error', async () => {
    const err = { code: 'ETIMEDOUT' };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 2, sleep: noSleep, random: () => 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
