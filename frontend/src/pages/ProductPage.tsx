import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProduct, useAddTracking, useRemoveTracking } from '../hooks/useProducts';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/Skeleton';
import { StockStatus } from '../types';
import toast from 'react-hot-toast';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';
import api from '../lib/api';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading } = useProduct(slug!);
  const user = useAuthStore((s) => s.user);
  const addTracking = useAddTracking();
  const removeTracking = useRemoveTracking();
  const [trackLoading, setTrackLoading] = useState(false);
  const [showStockLog, setShowStockLog] = useState(false);
  const [commentText, setCommentText] = useState('');
  const qc = useQueryClient();

  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['comments', slug],
    queryFn: async () => { const { data } = await api.get(`/products/${slug}/comments`); return data; },
    enabled: !!slug,
  });

  const { data: stockHistory = [] } = useQuery({
    queryKey: ['stock-history', slug],
    queryFn: async () => { const { data } = await api.get(`/products/${slug}/stock-history`); return data; },
    enabled: !!slug && showStockLog,
  });

  const postComment = useMutation({
    mutationFn: async (body: string) => { const { data } = await api.post(`/products/${slug}/comments`, { body }); return data; },
    onSuccess: () => { setCommentText(''); qc.invalidateQueries({ queryKey: ['comments', slug] }); toast.success('Comment posted'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to post comment'),
  });

  const deleteComment = useMutation({
    mutationFn: async (id: string) => api.delete(`/products/comments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['comments', slug] }); toast.success('Comment deleted'); },
  });

  const handleTrackToggle = async () => {
    if (!user) { toast.error('Sign in to track this product'); return; }
    setTrackLoading(true);
    try {
      if (product?.isTracking) {
        await removeTracking.mutateAsync(product.id);
        toast.success('Removed from tracking');
      } else {
        await addTracking.mutateAsync({ productId: product!.id });
        toast.success("Now tracking! You'll be notified when it's in stock.");
      }
    } catch (err: any) {
      if (err.response?.data?.code === 'TRACKING_LIMIT_REACHED') {
        toast.error('Tracking limit reached. Contact admin to unlock more slots.');
      } else {
        toast.error(err.response?.data?.error || 'Something went wrong');
      }
    } finally { setTrackLoading(false); }
  };

  if (isLoading) return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <Skeleton className="h-8 w-1/3" /><Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-12 w-full rounded-apple-lg" /><Skeleton className="h-64 rounded-apple-lg" />
    </div>
  );

  if (!product) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <p className="text-4xl">🔍</p>
      <h2 className="text-headline font-bold text-white">Product not found</h2>
      <Link to="/browse" className="btn-primary">Back to Browse</Link>
    </div>
  );

  const allStatuses = product.stockStatuses ?? [];
  const inStockStatuses = allStatuses.filter((s: any) => s.status === 'IN_STOCK' || s.status === 'LIMITED');

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-footnote text-dark-label2 mb-6">
        <Link to="/browse" className="hover:text-white transition-colors">Browse</Link>
        <span>/</span><span className="capitalize">{product.category}</span>
        <span>/</span><span className="text-white truncate max-w-[200px]">{product.name}</span>
      </nav>

      {/* Hero */}
      <div className="flex gap-5 mb-6">
        <div className="w-24 h-24 rounded-apple-lg bg-dark-surface2 flex items-center justify-center overflow-hidden shrink-0">
          {product.imageUrl
            ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain p-2" />
            : <span className="text-4xl opacity-30">📦</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-footnote text-apple-blue font-semibold capitalize mb-1">{product.category}</p>
          <h1 className="text-title2 font-bold text-white leading-tight mb-2">{product.name}</h1>
          {product.description && <p className="text-footnote text-dark-label2 leading-relaxed">{product.description}</p>}
        </div>
      </div>

      {/* Alert Me button */}
      <button
        onClick={handleTrackToggle}
        disabled={trackLoading}
        className={clsx(
          'w-full py-4 rounded-apple-lg font-bold text-body mb-6 transition-all flex items-center justify-center gap-2',
          product.isTracking
            ? 'bg-dark-surface2 border border-apple-blue text-apple-blue'
            : 'bg-apple-red text-white hover:opacity-90'
        )}
      >
        {trackLoading && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>}
        {product.isTracking ? '✓ Alert Active — Tap to Remove' : '🔔 Alert Me'}
      </button>

      {/* Price + tracking */}
      <div className="flex items-center gap-4 mb-4">
        {inStockStatuses.some((s: any) => s.price) && (
          <div>
            <p className="text-caption2 text-dark-label3 mb-0.5">Price Range</p>
            <p className="text-title2 font-bold text-white">
              ${Math.min(...inStockStatuses.filter((s: any) => s.price).map((s: any) => s.price!)).toFixed(2)}
              {' – '}
              ${Math.max(...inStockStatuses.filter((s: any) => s.price).map((s: any) => s.price!)).toFixed(2)}
            </p>
          </div>
        )}
        {(product.trackingCount ?? 0) > 0 && (
          <span className="text-footnote text-dark-label2">{(product.trackingCount ?? 0).toLocaleString()} tracking</span>
        )}
      </div>

      {/* Filter row */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-apple bg-dark-surface2 border border-dark-separator cursor-default">
          <div><p className="text-caption2 text-dark-label3">Price limit</p><p className="text-footnote text-dark-label2">Any price</p></div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-dark-label3"><path d="M5 7L1 3h8L5 7z"/></svg>
        </div>
        <div className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-apple bg-dark-surface2 border border-dark-separator cursor-default">
          <div><p className="text-caption2 text-dark-label3">Filter alerts</p><p className="text-footnote text-dark-label2">All stores</p></div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-dark-label3"><path d="M5 7L1 3h8L5 7z"/></svg>
        </div>
      </div>

      {/* Store list */}
      <div className="card divide-y divide-dark-separator mb-4">
        {allStatuses.length === 0
          ? <div className="p-8 text-center text-dark-label2 text-footnote">No stock data yet.</div>
          : allStatuses.map((s: any, i: number) => {
            const isInStock = s.status === 'IN_STOCK' || s.status === 'LIMITED';
            return (
              <motion.a key={s.storeId ?? i} href={s.productUrl ?? s.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-dark-surface2 transition-colors"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                {s.storeLogo
                  ? <img src={s.storeLogo} alt={s.storeName} className="w-10 h-10 object-contain rounded-full bg-white p-1 shrink-0" />
                  : <div className="w-10 h-10 rounded-full bg-dark-surface2 flex items-center justify-center text-lg shrink-0">🏪</div>}
                <div className="flex-1 min-w-0">
                  <p className="text-subhead font-semibold text-white">{s.storeName}</p>
                  {s.price && <p className="text-caption1 text-apple-blue font-semibold">${s.price.toFixed(2)}</p>}
                </div>
                <div className={clsx('px-4 py-2 rounded-apple text-footnote font-bold shrink-0 min-w-[110px] text-center',
                  isInStock ? 'bg-apple-green text-white' : 'border border-dark-separator text-dark-label2')}>
                  {isInStock ? 'IN STOCK' : 'OUT OF STOCK'}
                </div>
              </motion.a>
            );
          })
        }
      </div>

      {/* Stock log link */}
      <button onClick={() => setShowStockLog(!showStockLog)}
        className="text-apple-red text-footnote font-semibold hover:opacity-80 transition-opacity mb-6 flex items-center gap-1">
        Stock log: see when stores had stock
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 6h8M6 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Stock log panel */}
      <AnimatePresence>
        {showStockLog && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden">
            <h2 className="text-title2 font-bold text-white mb-3">Latest stock times</h2>
            {(stockHistory as any[]).length === 0
              ? <div className="card p-6 text-center text-dark-label2 text-footnote">No history yet. Builds as the scraper runs.</div>
              : <div className="card divide-y divide-dark-separator">
                {(stockHistory as any[]).map((event: any) => (
                  <div key={event.id} className="flex items-start justify-between px-4 py-3.5">
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="text-subhead font-semibold text-white">{event.storeName}</p>
                      {event.productUrl && (
                        <a href={event.productUrl} target="_blank" rel="noopener noreferrer" className="text-caption1 text-apple-blue hover:underline truncate block">
                          {product.name}
                        </a>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={clsx('text-footnote font-bold', event.status === 'IN_STOCK' ? 'text-apple-green' : 'text-dark-label3')}>
                        {event.status === 'IN_STOCK' ? 'In stock' : 'Out of stock'}
                      </p>
                      <p className="text-caption2 text-dark-label3">{format(new Date(event.createdAt), 'M/d/yyyy, h:mm aa')}</p>
                    </div>
                  </div>
                ))}
              </div>
            }
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comments */}
      <div>
        <h2 className="text-title2 font-bold text-white mb-4">COMMENTS</h2>
        <div className="flex gap-2 mb-6">
          <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim() && user) postComment.mutate(commentText); }}
            placeholder={user ? 'Add a comment...' : 'Sign in to comment'}
            disabled={!user || postComment.isPending}
            className="input flex-1" maxLength={1000} />
          <button onClick={() => refetchComments()} className="btn-icon w-10 h-10 text-dark-label2 hover:text-white shrink-0" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 7A5 5 0 1 1 7 2"/><path d="M12 2v3h-3"/>
            </svg>
          </button>
        </div>
        {user && commentText.trim() && (
          <button onClick={() => postComment.mutate(commentText)} disabled={postComment.isPending}
            className="mb-4 text-caption1 text-apple-blue hover:underline -mt-4 block">
            {postComment.isPending ? 'Posting...' : 'Post →'}
          </button>
        )}

        <div className="space-y-5">
          {(comments as any[]).length === 0
            ? <p className="text-footnote text-dark-label3 text-center py-4">No comments yet. Be the first!</p>
            : (comments as any[]).map((comment: any) => (
              <motion.div key={comment.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${comment.user?.role === 'ADMIN' ? 'bg-apple-orange' : 'bg-apple-blue'}`}>
                  {comment.user?.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-footnote font-semibold text-white">{comment.user?.name ?? 'User'}</span>
                      {comment.user?.role === 'ADMIN' && (
                        <span className="text-caption2 px-1.5 py-0.5 rounded bg-apple-orange/15 text-apple-orange font-semibold">Admin</span>
                      )}
                      <span className="text-caption2 text-dark-label3">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                    </div>
                    {user?.role === 'ADMIN' && (
                      <button onClick={() => deleteComment.mutate(comment.id)} className="text-caption2 text-apple-red hover:underline shrink-0">Hide</button>
                    )}
                  </div>
                  <p className="text-footnote text-dark-label2 leading-relaxed">{comment.body}</p>
                </div>
              </motion.div>
            ))
          }
        </div>

        {!user && (
          <p className="text-footnote text-dark-label2 mt-4 text-center">
            <Link to="/login" className="text-apple-blue hover:underline">Sign in</Link> to post comments and track this item.
          </p>
        )}
      </div>
    </div>
  );
}
