import { useState, useCallback } from 'react';
import { useProducts, useCategories } from '../hooks/useProducts';
import ProductCard from '../components/products/ProductCard';
import { ProductCardSkeleton } from '../components/ui/Skeleton';
import clsx from 'clsx';

const LIMIT = 24;

export default function BrowsePage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [inStock, setInStock] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading } = useProducts({ page, limit: LIMIT, search, category, inStock });
  const { data: categories } = useCategories();

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleCategory = (cat: string) => {
    setCategory(cat === category ? '' : cat);
    setPage(1);
  };

  const handleInStock = () => {
    setInStock(!inStock);
    setPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="section-title">Browse Products</h1>
        <p className="section-subtitle">Track availability across 70+ retailers</p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 pointer-events-none"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input pl-11"
            placeholder="Search products…"
          />
        </div>
        <button type="submit" className="btn-primary px-6">
          Search
        </button>
      </form>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={handleInStock}
          className={clsx(
            'px-4 py-2 rounded-pill text-footnote font-semibold transition-all',
            inStock
              ? 'bg-apple-green text-black'
              : 'bg-dark-surface2 text-dark-label2 border border-dark-separator hover:bg-dark-surface3 hover:text-white'
          )}
        >
          In Stock Only
        </button>

        {categories?.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategory(cat)}
            className={clsx(
              'px-4 py-2 rounded-pill text-footnote font-semibold capitalize transition-all',
              category === cat
                ? 'bg-apple-blue text-white'
                : 'bg-dark-surface2 text-dark-label2 border border-dark-separator hover:bg-dark-surface3 hover:text-white'
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Results count */}
      {data && (
        <p className="text-footnote text-dark-label2 mb-4">
          {(data.total ?? 0).toLocaleString()} product{(data.total ?? 0) !== 1 ? 's' : ''}
          {search && <span> matching "{search}"</span>}
        </p>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : data?.data.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🔍</p>
          <p className="text-title2 font-semibold text-white mb-2">No products found</p>
          <p className="text-subhead text-dark-label2">Try a different search or filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {data?.data.map((product, i) => (
            <ProductCard key={product.id} product={product} index={i} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-10">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary px-4 py-2 disabled:opacity-30"
          >
            ← Prev
          </button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(7, data.totalPages) }).map((_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={clsx(
                    'w-9 h-9 rounded-apple text-footnote font-semibold transition-all',
                    p === page
                      ? 'bg-apple-blue text-white'
                      : 'bg-dark-surface2 text-dark-label2 hover:bg-dark-surface3 hover:text-white'
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page === data.totalPages}
            className="btn-secondary px-4 py-2 disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
