/**
 * Pure staleness evaluation for the stock-checker worker. Kept dependency-free
 * (no Bull/Redis import) so it's unit-testable. "Stale" means no scrape has been
 * recorded recently enough — the silent-scheduler-death signal the plain HTTP
 * /health check can't see.
 */

export interface WorkerStaleness {
  stale: boolean;
  ageMs: number | null;
  staleAfterMs: number;
}

/**
 * Considered stale if there has been no recorded check within ~3 scrape cycles
 * (a couple of missed intervals — enough to ignore one transient hiccup but
 * catch a scheduler that has actually stopped).
 */
export function evaluateStaleness(
  lastCheckAt: Date | null,
  intervalMinutes: number,
  now: number = Date.now()
): WorkerStaleness {
  const staleAfterMs = Math.max(intervalMinutes, 1) * 60_000 * 3;
  const ageMs = lastCheckAt ? now - lastCheckAt.getTime() : null;
  const stale = ageMs == null || ageMs > staleAfterMs;
  return { stale, ageMs, staleAfterMs };
}
