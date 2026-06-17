import type { StockStatus } from '@shared';

/**
 * Pure stock-state predicates shared by the scheduled worker and the
 * admin/manual checker. Extracted so the subtle invariants are unit-testable
 * without a database.
 */

/**
 * Whether a resolved status means the item is buyable right now. A sellable
 * PREORDER counts as in-stock (you can complete the purchase), alongside
 * IN_STOCK and LIMITED. OUT_OF_STOCK and UNKNOWN are not in-stock.
 */
export function isInStock(status: StockStatus): boolean {
  return status === 'IN_STOCK' || status === 'LIMITED' || status === 'PREORDER';
}

/**
 * UNKNOWN means a scraper could not determine availability (bot-block, JS
 * shell, network error). Callers MUST NOT flip stored stock state on UNKNOWN —
 * keep the last known value.
 */
export function isUnknown(status: StockStatus): boolean {
  return status === 'UNKNOWN';
}

/**
 * Whether a check result differs enough from the stored state to record a
 * history point (StockEvent): the status changed, or a known new price differs
 * from the stored price. A missing/undefined new price is not a change (the
 * scraper just didn't report one this time).
 */
export function stockEventChanged(
  prev: { status: string | null; price: number | null },
  next: { status: string; price: number | null }
): boolean {
  const statusChanged = next.status !== prev.status;
  const priceChanged = next.price != null && next.price !== prev.price;
  return statusChanged || priceChanged;
}
