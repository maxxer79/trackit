/**
 * Pure helpers for Price Target Watch. No DB/IO so the crossing rule and
 * lowest-price logic are deterministic and unit-testable.
 *
 * A price-target alert is distinct from a price-drop alert:
 *   price-drop  = "the price went down at all" (relative, vs last seen)
 *   price-target = "the price reached YOUR number" (absolute threshold)
 *
 * To avoid re-alerting on every check while the price sits below the target,
 * we fire only on the DOWNWARD crossing (prev above target → now at/below).
 * A freshly-set target whose price is already at/below it fires once.
 */

export function crossedPriceTarget(
  prevPrice: number | null | undefined,
  newPrice: number | null | undefined,
  target: number | null | undefined
): boolean {
  if (target == null || target <= 0) return false;
  if (newPrice == null || newPrice <= 0) return false;
  if (newPrice > target) return false; // not at/below the target yet
  // At/below target now. Fire if we had no prior price, or the prior price was
  // above the target (a real crossing). If it was already at/below, stay quiet.
  if (prevPrice == null || prevPrice <= 0) return true;
  return prevPrice > target;
}

/** True when newPrice is a positive number strictly below the recorded low. */
export function isNewLow(
  currentLowest: number | null | undefined,
  newPrice: number | null | undefined
): boolean {
  if (newPrice == null || newPrice <= 0) return false;
  if (currentLowest == null || currentLowest <= 0) return true;
  return newPrice < currentLowest;
}
