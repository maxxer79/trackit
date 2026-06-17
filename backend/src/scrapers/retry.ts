/**
 * Small, dependency-free retry helper with exponential backoff + full jitter.
 * Used to ride out *transient* fetch failures (network resets, timeouts, 5xx)
 * before a scraper falls back to the expensive browser path.
 *
 * Deliberately does NOT retry:
 *  - 403 / bot-block / 4xx (other than 408) — retrying a block is pointless;
 *    the generic/browser fallback is the right move, and isBotBlocked handles it.
 *  - 429 — "slow down" should be honored, not hammered; per-retailer pacing and
 *    the next scheduled run handle it.
 */

export interface RetryOptions {
  /** Retries AFTER the first attempt (so total attempts = retries + 1). Default 2. */
  retries?: number;
  baseDelayMs?: number; // default 300
  maxDelayMs?: number; // default 3000
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  // Injectable for tests.
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ECONNREFUSED',
]);

const TRANSIENT_STATUSES = new Set([408, 500, 502, 503, 504]);

export function isTransientError(err: unknown): boolean {
  const e = err as { code?: string; response?: { status?: number }; message?: string };
  if (e?.code && TRANSIENT_CODES.has(e.code)) return true;
  const status = e?.response?.status;
  if (status && TRANSIENT_STATUSES.has(status)) return true;
  // axios surfaces timeouts as a message, not always a code
  if (e?.message && /timeout/i.test(e.message)) return true;
  return false;
}

/** Exponential backoff with full jitter: a random value in [0, min(max, base·2^attempt)]. */
export function backoffDelay(
  attempt: number,
  baseDelayMs = 300,
  maxDelayMs = 3000,
  random: () => number = Math.random
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(random() * cap);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 3000;
  const isRetryable = opts.isRetryable ?? isTransientError;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
