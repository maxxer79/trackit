/**
 * AutoBuy decision logic (pure, unit-tested). AutoBuy execution itself is still
 * a stub; this just classifies what WOULD happen so it can be audited.
 */
export type AutoBuyOutcome = 'TRIGGERED' | 'SKIPPED_OVER_MAX';

/**
 * TRIGGERED unless a known price strictly exceeds a set max price. A missing max
 * (no cap) or a missing price (can't compare) both fall through to TRIGGERED —
 * matching the original `!maxPrice || !price || price <= maxPrice` intent.
 */
export function autoBuyOutcome(
  price: number | null | undefined,
  maxPrice: number | null | undefined
): AutoBuyOutcome {
  const overMax = maxPrice != null && price != null && price > maxPrice;
  return overMax ? 'SKIPPED_OVER_MAX' : 'TRIGGERED';
}
