import { describe, it, expect } from 'vitest';
import { rankSimilar } from './similar';

describe('rankSimilar', () => {
  it('ranks co-tracked products by overlap, highest first', () => {
    const picks = rankSimilar(
      [
        { productId: 'b', count: 2 },
        { productId: 'c', count: 5 },
      ],
      [],
      'a'
    );
    expect(picks.map((p) => p.productId)).toEqual(['c', 'b']);
    expect(picks[0]).toEqual({ productId: 'c', source: 'co-tracked', coCount: 5 });
  });

  it('excludes the product itself and dedupes across sources', () => {
    const picks = rankSimilar([{ productId: 'a', count: 9 }, { productId: 'b', count: 3 }], ['b', 'a', 'd'], 'a');
    expect(picks.map((p) => p.productId)).toEqual(['b', 'd']);
  });

  it('fills remaining slots from category after co-tracked', () => {
    const picks = rankSimilar([{ productId: 'b', count: 4 }], ['c', 'd', 'e'], 'a', 3);
    expect(picks.map((p) => p.productId)).toEqual(['b', 'c', 'd']);
    expect(picks[0].source).toBe('co-tracked');
    expect(picks[1].source).toBe('category');
  });

  it('caps at the limit', () => {
    const picks = rankSimilar([], ['c', 'd', 'e', 'f', 'g', 'h', 'i'], 'a', 4);
    expect(picks).toHaveLength(4);
    expect(picks.every((p) => p.source === 'category')).toBe(true);
  });

  it('skips zero/negative co-track counts', () => {
    const picks = rankSimilar([{ productId: 'b', count: 0 }], ['c'], 'a');
    expect(picks.map((p) => p.productId)).toEqual(['c']);
  });
});
