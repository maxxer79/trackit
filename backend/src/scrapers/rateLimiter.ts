/**
 * Per-key minimum-interval rate limiter. Spaces out requests that share a key
 * (here: a retailer's storeSlug) so concurrent worker jobs don't hammer the same
 * site — which both reduces bot-blocks/429s and is simply more polite. Different
 * keys are independent.
 *
 * Correctness under concurrency relies on the reservation being SYNCHRONOUS:
 * acquire() reads the key's next-available time and writes the next slot with no
 * await in between, so two near-simultaneous acquires for the same key reserve
 * sequential slots (single-threaded JS guarantees the read-modify-write is
 * atomic). The caller then awaits only its own computed delay.
 */

export interface RateLimiterDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: RateLimiterDeps = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export class PerKeyRateLimiter {
  private nextAvailable = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly deps: RateLimiterDeps = defaultDeps
  ) {}

  /** Resolves when the caller may proceed for `key`, after any required wait. */
  async acquire(key: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = this.deps.now();
    const earliest = this.nextAvailable.get(key) ?? 0;
    const grantAt = Math.max(now, earliest);
    // Reserve the slot for the NEXT caller before we await — this is what keeps
    // concurrent same-key acquires correctly spaced.
    this.nextAvailable.set(key, grantAt + this.minIntervalMs);
    const wait = grantAt - now;
    if (wait > 0) await this.deps.sleep(wait);
  }
}

// Shared singleton used by every scraper's axios instance (see base.ts).
// Tunable via SCRAPER_MIN_INTERVAL_MS; default 1200ms between hits to one store.
const MIN_INTERVAL_MS = parseInt(process.env.SCRAPER_MIN_INTERVAL_MS || '1200', 10);

export const scraperRateLimiter = new PerKeyRateLimiter(
  Number.isFinite(MIN_INTERVAL_MS) ? MIN_INTERVAL_MS : 1200
);
