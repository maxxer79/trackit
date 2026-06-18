/**
 * Pure per-item alert-rule gate. Decides whether an alert is allowed to fire for
 * a tracked item, given the user's optional rules. Scoped to two reliable rules:
 *
 *  - alertMaxPrice: only alert when the price is at or below this ceiling.
 *    Forgiving on unknown price — if we couldn't scrape a price, we don't
 *    suppress a restock (better to over-alert than miss one).
 *  - alertDays: only alert on these weekdays (0 = Sun … 6 = Sat), evaluated in
 *    the user's timezone. Empty/absent = any day.
 *
 * No DB or Date.now() baked in — unit-testable.
 */

export interface AlertRules {
  alertMaxPrice?: number | null;
  alertDays?: number[] | null;
}
export interface AlertContext {
  price?: number | null;
  now?: Date;
  timezone?: string | null;
}

function dowInTz(d: Date, tz: string): number {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return Math.max(0, labels.indexOf(wd));
}

export function passesAlertRules(rules: AlertRules, ctx: AlertContext = {}): boolean {
  // Price ceiling — only enforced when we actually know the price.
  if (rules.alertMaxPrice != null && ctx.price != null && ctx.price > rules.alertMaxPrice) {
    return false;
  }

  // Allowed weekdays — empty/absent means no day restriction.
  if (rules.alertDays && rules.alertDays.length > 0) {
    const tz = ctx.timezone || 'UTC';
    const now = ctx.now ?? new Date();
    let dow: number;
    try {
      dow = dowInTz(now, tz);
    } catch {
      dow = dowInTz(now, 'UTC');
    }
    if (!rules.alertDays.includes(dow)) return false;
  }

  return true;
}
