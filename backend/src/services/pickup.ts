/**
 * Pure helpers for in-store pickup alerts. No DB / IO here so the transition
 * rule and ZIP validation are deterministic and unit-testable.
 *
 * Pickup availability lives on StoreProduct.pickupAvailable as a tri-state:
 *   true  — a scraper confirmed pickup is available
 *   false — a scraper confirmed pickup is NOT available
 *   null  — unknown (retailer not wired, or never parsed yet)
 *
 * We only alert on a real transition from confirmed-unavailable → available
 * (false → true). A first-ever observation (null → true) just sets the baseline
 * silently, exactly like restock alerts never fire on the very first scrape.
 */

export function shouldNotifyPickup(
  previous: boolean | null | undefined,
  current: boolean | null | undefined
): boolean {
  return previous === false && current === true;
}

/** Loose US ZIP check: 5 digits, optionally a ZIP+4 (#####-####). */
export function isValidUsZip(zip: string | null | undefined): boolean {
  if (!zip) return false;
  return /^\d{5}(-\d{4})?$/.test(zip.trim());
}

/** Normalize a ZIP for storage: trimmed, or null if blank/invalid. */
export function normalizeZip(zip: string | null | undefined): string | null {
  if (zip == null) return null;
  const t = String(zip).trim();
  return isValidUsZip(t) ? t : null;
}
