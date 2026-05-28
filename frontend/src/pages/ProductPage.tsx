import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useProduct } from '../hooks/useProducts';
import { useAddTracking, useRemoveTracking } from '../hooks/useProducts';
import { useAuthStore } from '../store/auth';
import StatusBadge from '../components/ui/StatusBadge';
import { Skeleton } from '../components/ui/Skeleton';
import { StockStatus } from '../types';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading } = useProduct(slug!);
  const user = useAuthStore((s) => s.user);
  const addTracking = useAddTracking();
  const removeTracking = useRemoveTracking();
  const [trackLoading, setTrackLoading] = useState(false);

  const handleTrackToggle = async () => {
    if (!user) {
      toast.error('Sign in to track this product');
      return;
    }
    setTrackLoading(true);
    try {
      if (product?.isTracking) {
        await removeTracking.mutateAsync(product.id);
        toast.success('Removed from tracking');
      } else {
        await addTracking.mutateAsync({ productId: product!.id });
        toast.success('Now tracking! You\'ll be notified when it\'s in stock.');
      }
    } catch (err: any) {
      if (err.response?.data?.code === 'TRACKING_LIMIT_REACHED') {
        toast.error('Tracking limit reached. Contact admin to unlock more slots.');
      } else {
        toast.error(err.response?.data?.error || 'Something went wrong');
      }
    } finally {
      setTrackLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <Skeleton className="lg:col-span-2 aspect-square rounded-apple-xl" />
          <div className="lg:col-span-3 space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-12 w-40 rounded-pill" />
            <Skeleton className="h-40 rounded-apple-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-4xl">🔍</p>
        <h2 className="text-headline font-bold text-white">Product not found</h2>
        <Link to="/browse" className="btn-primary">Back to Browse</Link>
      </div>
    );
  }

  const inStockStatuses = product.stockStatuses?.filter(
    (s) => s.status === 'IN_STOCK' || s.status === 'LIMITED'
  ) ?? [];

  const allStatuses = product.stockStatuses ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-footnote text-dark-label2 mb-8">
        <Link to="/browse" className="hover:text-white transition-colors">Browse</Link>
        <span>/</span>
        <span className="capitalize">{product.category}</span>
        <span>/</span>
        <span className="text-white truncate max-w-[200px]">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-10">
        {/* Image */}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="card aspect-square flex items-center justify-center overflow-hidden p-8">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-8xl opacity-20">📦</span>
            )}
          </div>
        </motion.div>

        {/* Details */}
        <motion.div
          className="lg:col-span-3 space-y-6"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div>
            <p className="text-footnote text-apple-blue font-semibold capitalize mb-1">{product.category}</p>
            <h1 className="text-headline font-bold text-white leading-tight">{product.name}</h1>
            {product.description && (
              <p className="text-subhead text-dark-label2 mt-3 leading-relaxed">{product.description}</p>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-3">
            {inStockStatuses.length > 0 ? (
              <StatusBadge status={inStockStatuses[0].status as StockStatus} />
            ) : (
              <StatusBadge status="OUT_OF_STOCK" />
            )}
            {(product.trackingCount ?? 0) > 0 && (
              <span className="badge-unknown">
                {(product.trackingCount ?? 0).toLocaleString()} tracking
              </span>
            )}
          </div>

          {/* Price range */}
          {inStockStatuses.some((s) => s.price) && (
            <div>
              <p className="text-footnote text-dark-label2 mb-1">Price Range</p>
              <p className="text-title1 font-bold text-white">
                ${Math.min(...inStockStatuses.filter((s) => s.price).map((s) => s.price!)).toFixed(2)}
                {' '}—{' '}
                ${Math.max(...inStockStatuses.filter((s) => s.price).map((s) => s.price!)).toFixed(2)}
              </p>
            </div>
          )}

          {/* Track button */}
          <div className="flex gap-3">
            <button
              onClick={handleTrackToggle}
              disabled={trackLoading}
              className={clsx(
                'flex items-center gap-2 px-8 py-3.5 rounded-pill font-semibold text-body transition-all',
                product.isTracking
                  ? 'bg-dark-surface2 border border-apple-blue text-apple-blue hover:bg-apple-blue/10'
                  : 'btn-primary shadow-glow-blue'
              )}
            >
              {trackLoading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
                </svg>
              ) : product.isTracking ? '✓ Tracking' : 'Track This Item'}
            </button>

            {inStockStatuses[0] && (
              <a
                href={inStockStatuses[0].productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary px-6 py-3.5"
              >
                Shop Now →
              </a>
            )}
          </div>

          {!user && (
            <p className="text-footnote text-dark-label2">
              <Link to="/login" className="text-apple-blue hover:underline">Sign in</Link> to track this item and get notified.
            </p>
          )}
        </motion.div>
      </div>

      {/* Store availability */}
      <div>
        <h2 className="text-title1 font-bold text-white mb-4">Store Availability</h2>
        {allStatuses.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-dark-label2">No stock data available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allStatuses.map((s, i) => (
              <motion.a
                key={s.storeId}
                href={s.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="card p-4 flex items-center gap-3 hover:bg-dark-surface2 transition-colors group"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                {s.storeLogo ? (
                  <img src={s.storeLogo} alt={s.storeName} className="w-10 h-10 object-contain rounded-apple bg-white p-1" />
                ) : (
                  <div className="w-10 h-10 rounded-apple bg-dark-surface2 flex items-center justify-center text-lg">
                    🏪
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-subhead font-semibold text-white truncate">{s.storeName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={s.status as StockStatus} size="sm" />
                    {s.price && (
                      <span className="text-caption1 font-semibold text-apple-blue">${s.price.toFixed(2)}</span>
                    )}
                  </div>
                  <p className="text-caption2 text-dark-label3 mt-1">
                    Updated {formatDistanceToNow(new Date(s.lastCheckedAt ?? s.lastChecked ?? Date.now()), { addSuffix: true })}
                  </p>
                </div>
                <svg className="w-4 h-4 text-dark-label3 group-hover:text-white transition-colors shrink-0"
                  viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </motion.a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

