/**
 * Quiet-hours evaluation. The window is stored as minutes-from-midnight in the
 * USER's timezone; the worker runs in UTC, so we convert "now" into the user's
 * local minutes via Intl (no tz library needed) and test the window. During
 * quiet hours, external notification channels are suppressed (the in-app Alert
 * is still recorded).
 */

export interface QuietConfig {
  quietHoursEnabled: boolean;
  quietHoursStart: number | null; // minutes from midnight, 0..1439
  quietHoursEnd: number | null;
  timezone: string | null; // IANA, e.g. "America/New_York"
}

/** Minutes-from-midnight of `date` rendered in `timeZone`. */
export function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // hour12:false can emit "24" for midnight in some runtimes — normalize.
  return (hh % 24) * 60 + mm;
}

/**
 * Is `nowMin` inside [startMin, endMin)? Handles overnight windows where
 * start > end (e.g. 22:00–07:00). Equal start/end means an empty window.
 */
export function isWithinWindow(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight
}

export function isQuietNow(cfg: QuietConfig, now: Date = new Date()): boolean {
  if (!cfg.quietHoursEnabled) return false;
  if (cfg.quietHoursStart == null || cfg.quietHoursEnd == null) return false;
  let nowMin: number;
  try {
    nowMin = minutesInTimeZone(now, cfg.timezone || 'UTC');
  } catch {
    nowMin = minutesInTimeZone(now, 'UTC'); // invalid tz → fall back to UTC
  }
  return isWithinWindow(nowMin, cfg.quietHoursStart, cfg.quietHoursEnd);
}
