/**
 * Price-drop detection (pure, unit-tested). A drop only counts if both prices
 * are known positive numbers and the new price is at least `minDropFraction`
 * below the old one — proportional so a 1¢ wobble on a cheap item doesn't fire,
 * but a real markdown does. Default 1%.
 */
export function isPriceDrop(
  oldPrice: number | null | undefined,
  newPrice: number | null | undefined,
  minDropFraction = 0.01
): boolean {
  if (oldPrice == null || newPrice == null) return false;
  if (oldPrice <= 0 || newPrice <= 0) return false;
  if (newPrice >= oldPrice) return false;
  return (oldPrice - newPrice) / oldPrice >= minDropFraction;
}
