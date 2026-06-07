import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Product } from '../../types';
import StatusBadge from '../ui/StatusBadge';
import { useAuthStore } from '../../store/auth';
import { useAddTracking, useRemoveTracking } from '../../hooks/useProducts';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Props {
  product: Product;
  index?: number;
}

export default function ProductCard({ product, index = 0 }: Props) {
  const user = useAuthStore((s) => s.user);
  const addTracking = useAddTracking();
  const removeTracking = useRemoveTracking();
  const [isTracked, setIsTracked] = useState(product.isTracking ?? false);

  const bestStatus = product.bestStatus ?? (
    product.stockStatuses?.find((s) => s.status === 'IN_STOCK') ? 'IN_STOCK' :
    product.stockStatuses?.find((s) => s.status === 'LIMITED') ? 'LIMITED' :
    product.stockStatuses?.find((s) => s.status === 'PREORDER') ? 'PREORDER' :
    product.stockStatuses?.some((s) => s.status === 'OUT_OF_STOCK') ? 'OUT_OF_STOCK' : 'UNKNOWN'
  );

  const lowestPrice = product.lowestPrice ?? (
    product.stockStatuses
      ?.filter((s) => s.price != null && s.status !== 'OUT_OF_STOCK')
      .map((s) => s.price!)
      .sort((a, b) => a - b)[0] ?? null
  );

  const handleTrackToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      toast.error('Sign in to track products');
      return;
    }

    try {
      if (isTracked) {
        setIsTracked(false);
        await removeTracking.mutateAsync(product.id);
        toast.success('Removed from tracking');
      } else {
        setIsTracked(true);
        await addTracking.mutateAsync({ productId: product.id });
        toast.success('Now tracking this product!');
      }
    } catch (err: any) {
      setIsTracked(!isTracked);
      if (err.response?.data?.code === 'TRACKING_LIMIT_REACHED') {
        toast.error('Tracking limit reached. Contact admin to upgrade.');
      } else {
        toast.error(err.response?.data?.error || 'Something went wrong');
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
    >
      <Link to={`/product/${product.slug}`} className="block group">
        <div className={clsx(
          'card overflow-hidden transition-all duration-200',
          'hover:bg-dark-surface2 hover:-translate-y-0.5 hover:shadow-apple',
          'active:scale-[0.99]'
        )}>
          {/* Image */}
          <div className="relative aspect-square bg-dark-surface2 overflow-hidden">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-4xl opacity-30">📦</span>
              </div>
            )}

            {/* Badges */}
            <div className="absolute top-2 left-2 flex flex-col gap-1">
              {product.isFeatured && (
                <span className="px-2 py-0.5 bg-apple-blue/90 text-white text-caption2 font-semibold rounded-pill backdrop-blur-sm">
                  Featured
                </span>
              )}
              {product.isNewlyAdded && (
                <span className="px-2 py-0.5 bg-apple-orange/90 text-white text-caption2 font-semibold rounded-pill backdrop-blur-sm">
                  New
                </span>
              )}
            </div>

            {/* Track button */}
            <button
              onClick={handleTrackToggle}
              className={clsx(
                'absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center',
                'transition-all duration-200 border',
                isTracked
                  ? 'bg-apple-blue text-white border-apple-blue shadow-glow-blue'
                  : 'bg-dark-surface1/90 text-dark-label1 border-dark-separator shadow-[0_1px_4px_rgba(0,0,0,0.45)] hover:bg-dark-surface2 hover:text-dark-label1'
              )}
              title={isTracked ? 'Stop tracking' : 'Track this item'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill={isTracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
                <path d="M7 1l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9L3.4 12l.7-4L1.2 5.2l4-.6z" />
              </svg>
            </button>
          </div>

          {/* Info */}
          <div className="p-3">
            <p className="text-footnote text-dark-label2 mb-1 capitalize">{product.category}</p>
            <h3 className="text-subhead font-semibold text-dark-label1 line-clamp-2 leading-snug mb-2">
              {product.name}
            </h3>

            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={bestStatus} size="sm" />
              {lowestPrice && (
                <span className="text-footnote font-semibold text-apple-blue">
                  ${lowestPrice.toFixed(2)}
                </span>
              )}
            </div>

            {(product.trackingCount ?? 0) > 0 && (
              <p className="text-caption2 text-dark-label3 mt-2">
                {(product.trackingCount ?? 0).toLocaleString()} tracking
              </p>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
