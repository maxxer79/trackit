/**
 * Pure scraper-health classification over a window of ScraperLog outcomes.
 * Advisory only — nothing here disables a scraper. A run of UNKNOWN/blocked/
 * error results lowers the success rate; success rate drives the label.
 *
 * Thresholds (success = definitive IN/OUT/LIMITED/PREORDER result):
 *   healthy   ≥ 70% success
 *   degraded  > 0% and < 70%
 *   down      attempts exist but 0% success
 *   no_data   no attempts in the window
 */
export type ScraperHealthLabel = 'healthy' | 'degraded' | 'down' | 'no_data';

export const DEGRADED_THRESHOLD = 0.7;

export function classifyHealth(total: number, successes: number): ScraperHealthLabel {
  if (total <= 0) return 'no_data';
  const rate = successes / total;
  if (rate <= 0) return 'down';
  if (rate < DEGRADED_THRESHOLD) return 'degraded';
  return 'healthy';
}
