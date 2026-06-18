/**
 * Pure ranking for "Similar items." Co-tracked products (people who track X also
 * track Y) come first, ranked by how many trackers overlap; same-category
 * products fill any remaining slots. Dedupes and always excludes the product
 * itself. No DB here — unit-testable.
 */

export interface CoTrackRow {
  productId: string;
  count: number;
}
export interface SimilarPick {
  productId: string;
  source: 'co-tracked' | 'category';
  coCount?: number;
}

export function rankSimilar(
  coTracked: CoTrackRow[],
  categoryIds: string[],
  excludeId: string,
  limit = 6
): SimilarPick[] {
  const seen = new Set<string>([excludeId]);
  const out: SimilarPick[] = [];

  for (const r of [...coTracked].sort((a, b) => b.count - a.count)) {
    if (out.length >= limit) break;
    if (r.count <= 0 || seen.has(r.productId)) continue;
    seen.add(r.productId);
    out.push({ productId: r.productId, source: 'co-tracked', coCount: r.count });
  }

  for (const id of categoryIds) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ productId: id, source: 'category' });
  }

  return out;
}
