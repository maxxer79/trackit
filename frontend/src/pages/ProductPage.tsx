import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useProduct, useAddTracking, useRemoveTracking } from '../hooks/useProducts';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/Skeleton';
import toast from 'react-hot-toast';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';
import api from '../lib/api';
import StoreLogo from '../components/ui/StoreLogo';
import PriceHistoryChart, { StockHistoryEvent } from '../components/products/PriceHistoryChart';
import RestockFrequencyBadge from '../components/products/RestockFrequencyBadge';
import StockTimelinePanel from '../components/products/StockTimelinePanel';
import SimilarItems from '../components/products/SimilarItems';
import ReportIssue from '../components/products/ReportIssue';
import { conditionLabel, CONDITION_BADGE, CONDITION_LABEL } from '../lib/condition';

const PRICE_OPTIONS = [
  { label: 'Any price', value: null },
  { label: 'Under $100', value: 100 },
  { label: 'Under $300', value: 300 },
  { label: 'Under $500', value: 500 },
  { label: 'Under $1000', value: 1000 },
  { label: 'Under $1500', value: 1500 },
];

function Dropdown({ label, sublabel, options, value, onChange }: {
  label: string; sublabel: string;
  options: { label: string; value: any }[];
  value: any; onChange: (v: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div className="flex-1 relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-apple bg-dark-surface2 border border-dark-separator hover:bg-dark-surface3 transition-colors">
        <div className="text-left">
          <p className="text-caption2 text-dark-label3">{label}</p>
          <p className="text-footnote text-dark-label1 font-medium">{selected?.label ?? sublabel}</p>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={clsx('text-dark-label3 transition-transform', open && 'rotate-180')}>
          <path d="M5 7L1 3h8L5 7z"/>
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute top-full left-0 right-0 mt-1 bg-dark-surface1 border border-dark-separator rounded-apple-lg shadow-apple-lg z-30 overflow-hidden">
            {options.map(opt => (
              <button key={String(opt.value)} onClick={() => { onChange(opt.value); setOpen(false); }}
                className={clsx('w-full text-left px-4 py-2.5 text-footnote transition-colors',
                  opt.value === value ? 'text-apple-blue bg-apple-blue/10' : 'text-dark-label1 hover:bg-dark-surface2')}>
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading } = useProduct(slug!);
  const user = useAuthStore((s) => s.user);
  const addTracking = useAddTracking();
  const removeTracking = useRemoveTracking();
  const [trackLoading, setTrackLoading] = useState(false);
  const [showStockLog, setShowStockLog] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [priceLimit, setPriceLimit] = useState<number | null>(null);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [conditionFilter, setConditionFilter] = useState<string | null>(null);
  const qc = useQueryClient();

  const [liveStatuses, setLiveStatuses] = useState<Record<string, {
    status: string; price?: number | null; loading: boolean; lastCheckedAt?: string;
  }>>({});
  const [isLiveChecking, setIsLiveChecking] = useState(false);

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

  // Auto-scrape on page load: stream live status for each retailer
  useEffect(() => {
    if (!product) return;
    const initial: Record<string, any> = {};
    (product.stockStatuses ?? []).forEach((s: any) => {
      if (s.storeProductId) {
        initial[s.storeProductId] = { status: s.status, price: s.price, loading: true };
      }
    });
    setLiveStatuses(initial);
    setIsLiveChecking(true);

    const apiBase = import.meta.env.VITE_API_URL || '/api';
    const eventSource = new EventSource(`${apiBase}/products/${slug}/live-check`);

    eventSource.addEventListener('result', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setLiveStatuses(prev => ({
        ...prev,
        [data.storeProductId]: { status: data.status, price: data.price, loading: false, lastCheckedAt: data.lastCheckedAt },
      }));
    });

    eventSource.addEventListener('done', () => {
      setIsLiveChecking(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setIsLiveChecking(false);
      setLiveStatuses(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(k => {
          if (updated[k].loading) updated[k] = { ...updated[k], loading: false };
        });
        return updated;
      });
      eventSource.close();
    };

    return () => eventSource.close();
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <h2 className="text-headline font-bold text-dark-label1">Product not found</h2>
      <Link to="/browse" className="btn-primary">Back to Browse</Link>
    </div>
  );

  const allStatuses: any[] = product.stockStatuses ?? [];

  // Merge live status into each row (once live data arrives)
  const mergedStatuses = allStatuses.map((s: any) => {
    const live = liveStatuses[s.storeProductId];
    if (!live || live.loading) return { ...s, _live: live };
    return { ...s, status: live.status, price: live.price ?? s.price, lastCheckedAt: live.lastCheckedAt ?? s.lastCheckedAt, _live: live };
  });

  // Build store filter options from available stores
  const storeOptions = [
    { label: 'All stores', value: null },
    ...Array.from(new Set(mergedStatuses.map((s: any) => s.storeName))).map(name => ({ label: name, value: name })),
  ];

  // Apply filters
  const filteredStatuses = mergedStatuses.filter((s: any) => {
    if (storeFilter && s.storeName !== storeFilter) return false;
    if (conditionFilter && (s.condition ?? 'NEW') !== conditionFilter) return false;
    if (priceLimit !== null) {
      if (s.status === 'IN_STOCK' || s.status === 'LIMITED') {
        if (s.price && s.price > priceLimit) return false;
      }
    }
    return true;
  });

  // Only surface the condition filter when there's something other than plain New.
  const conditionsPresent = [...new Set(mergedStatuses.map((s: any) => s.condition ?? 'NEW'))];
  const showConditionFilter = conditionsPresent.some((c) => c !== 'NEW');

  const inStockStatuses = mergedStatuses.filter((s: any) => s.status === 'IN_STOCK' || s.status === 'LIMITED');

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-footnote text-dark-label2 mb-6">
        <Link to="/browse" className="hover:text-dark-label1 transition-colors">Browse</Link>
        <span>/</span><span className="capitalize">{product.category}</span>
        <span>/</span><span className="text-dark-label1 truncate max-w-[200px]">{product.name}</span>
      </nav>

      {/* Hero */}
      <div className="flex gap-5 mb-6">
        <div className="w-24 h-24 rounded-apple-lg bg-dark-surface2 flex items-center justify-center overflow-hidden shrink-0 border border-dark-separator">
          {product.imageUrl
            ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain p-2" />
            : <span className="text-4xl opacity-30">📦</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-footnote text-apple-blue font-semibold capitalize mb-1">{product.category}</p>
          <h1 className="text-title2 font-bold text-dark-label1 leading-tight mb-2">{product.name}</h1>
          {product.description && <p className="text-footnote text-dark-label2 leading-relaxed">{product.description}</p>}
          {(product as any).modelNumber && (
            <p className="text-caption1 text-dark-label3 mt-1">Model / SKU: <span className="font-mono text-dark-label2">{(product as any).modelNumber}</span></p>
          )}
          {(product.trackingCount ?? 0) > 0 && (
            <p className="text-caption2 text-dark-label3 mt-1">{(product.trackingCount ?? 0).toLocaleString()} people tracking</p>
          )}
        </div>
      </div>

      {/* Track It button */}
      <button
        onClick={handleTrackToggle}
        disabled={trackLoading}
        className={clsx(
          'w-full py-4 rounded-apple-lg font-bold text-body mb-4 transition-all flex items-center justify-center gap-2',
          product.isTracking
            ? 'bg-dark-surface2 border-2 border-apple-blue text-apple-blue'
            : 'bg-apple-blue text-white hover:opacity-90 shadow-glow-blue'
        )}
      >
        {trackLoading && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>}
        {product.isTracking ? '✓ Tracking — Tap to Remove' : '🔔 Track It'}
      </button>

      {/* Price range */}
      {inStockStatuses.some((s: any) => s.price) && (
        <div className="mb-4">
          <p className="text-caption2 text-dark-label3 mb-0.5">Price Range</p>
          <p className="text-title2 font-bold text-dark-label1">
            ${Math.min(...inStockStatuses.filter((s: any) => s.price).map((s: any) => s.price!)).toFixed(2)}
            {' – '}
            ${Math.max(...inStockStatuses.filter((s: any) => s.price).map((s: any) => s.price!)).toFixed(2)}
          </p>
        </div>
      )}

      {/* Filter row */}
      <div className="flex gap-3 mb-4">
        <Dropdown
          label="Price limit"
          sublabel="Any price"
          options={PRICE_OPTIONS}
          value={priceLimit}
          onChange={setPriceLimit}
        />
        <Dropdown
          label="Filter alerts"
          sublabel="All stores"
          options={storeOptions}
          value={storeFilter}
          onChange={setStoreFilter}
        />
      </div>

      {/* Condition filter (only when non-New listings exist) */}
      {showConditionFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-caption2 text-dark-label3">Condition:</span>
          <button
            onClick={() => setConditionFilter(null)}
            className={clsx('text-caption2 px-2.5 py-1 rounded-pill border transition-colors',
              !conditionFilter ? 'border-apple-blue text-apple-blue bg-apple-blue/10' : 'border-dark-separator text-dark-label2 hover:text-dark-label1')}
          >
            All
          </button>
          {conditionsPresent.map((c) => (
            <button
              key={c}
              onClick={() => setConditionFilter(c === conditionFilter ? null : c)}
              className={clsx('text-caption2 px-2.5 py-1 rounded-pill border transition-colors',
                c === conditionFilter ? 'border-apple-blue text-apple-blue bg-apple-blue/10' : 'border-dark-separator text-dark-label2 hover:text-dark-label1')}
            >
              {CONDITION_LABEL[c] ?? c}
            </button>
          ))}
        </div>
      )}

      {/* Active filter chips */}
      {(priceLimit !== null || storeFilter !== null) && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {priceLimit !== null && (
            <button onClick={() => setPriceLimit(null)}
              className="flex items-center gap-1 px-3 py-1 rounded-pill bg-apple-blue/15 text-apple-blue text-caption1 font-semibold">
              Under ${priceLimit} ✕
            </button>
          )}
          {storeFilter !== null && (
            <button onClick={() => setStoreFilter(null)}
              className="flex items-center gap-1 px-3 py-1 rounded-pill bg-apple-blue/15 text-apple-blue text-caption1 font-semibold">
              {storeFilter} ✕
            </button>
          )}
        </div>
      )}

      {/* Live-check status indicator */}
      {isLiveChecking && (
        <div className="flex items-center gap-2 mb-3 text-caption1 text-dark-label3">
          <svg className="animate-spin w-3.5 h-3.5 shrink-0 text-apple-blue" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
          </svg>
          Checking availability live…
        </div>
      )}

      {/* Store availability list */}
      <div className="card divide-y divide-dark-separator mb-4">
        {filteredStatuses.length === 0
          ? <div className="p-8 text-center text-dark-label2 text-footnote">
              {allStatuses.length === 0 ? 'No stores added yet. Admin can add store links.' : 'No stores match your filters.'}
            </div>
          : filteredStatuses.map((s: any, i: number) => {
            const live = s._live as { status: string; price?: number | null; loading: boolean; lastCheckedAt?: string } | undefined;
            const isLoading = !!live?.loading;
            const isInStock = s.status === 'IN_STOCK' || s.status === 'LIMITED';
            const isPreorder = s.status === 'PREORDER';
            // Direct product URL takes priority; fall back to retailer search
            const searchHref = s.storeSearchUrl
              ? s.storeSearchUrl.replace('{query}', encodeURIComponent(product.name))
              : null;
            const linkHref = s.productUrl || searchHref;
            const isSearchLink = !s.productUrl && !!searchHref;

            return (
              <motion.a
                key={s.storeId ?? i}
                href={linkHref ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx('flex items-center gap-3 px-4 py-3.5 transition-colors group', linkHref ? 'hover:bg-dark-surface2' : 'cursor-default')}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                onClick={!linkHref ? (e) => e.preventDefault() : undefined}
              >
                <StoreLogo logoUrl={s.storeLogo} domain={s.storeSlug ? `${s.storeSlug}.com` : null} name={s.storeName ?? ''} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-subhead font-semibold text-dark-label1">{s.storeName}</p>
                    {(s.condition ?? 'NEW') !== 'NEW' && (
                      <span className={clsx('text-caption2 px-1.5 py-0.5 rounded-pill border font-medium', CONDITION_BADGE[s.condition] ?? CONDITION_BADGE.NEW)}>
                        {conditionLabel(s.condition)}
                      </span>
                    )}
                    {isSearchLink && (
                      <span className="text-caption2 text-dark-label3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="6" cy="6" r="4"/><path d="M13 13l-3-3"/>
                        </svg>
                        search
                      </span>
                    )}
                  </div>
                  {s.price != null && <p className="text-caption1 text-apple-blue font-semibold">${Number(s.price).toFixed(2)}</p>}
                  {s.lastCheckedAt && (
                    <p className="text-caption2 text-dark-label3">
                      {isLoading ? 'Checking now…' : `Updated ${formatDistanceToNow(new Date(s.lastCheckedAt), { addSuffix: true })}`}
                    </p>
                  )}
                  {!s.lastCheckedAt && isLoading && (
                    <p className="text-caption2 text-dark-label3">Checking now…</p>
                  )}
                </div>
                <div className={clsx(
                  'px-4 py-2 rounded-apple text-footnote font-bold shrink-0 min-w-[120px] text-center transition-colors flex items-center justify-center gap-1.5',
                  isLoading
                    ? 'border border-dark-separator text-dark-label3'
                    : isInStock
                      ? 'bg-apple-green text-white'
                      : isPreorder
                        ? 'bg-apple-orange text-white'
                        : !s.lastCheckedAt
                          ? 'border border-dark-separator text-dark-label3'
                          : isSearchLink
                            ? 'border border-dark-separator text-dark-label2 group-hover:border-apple-blue/50 group-hover:text-apple-blue'
                            : 'border border-dark-separator text-dark-label2'
                )}>
                  {isLoading ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
                      </svg>
                      <span>CHECKING</span>
                    </>
                  ) : isInStock ? 'IN STOCK'
                    : isPreorder ? 'PRE-ORDER'
                    : !s.lastCheckedAt ? 'NOT CHECKED'
                    : isSearchLink ? 'SEARCH →'
                    : 'OUT OF STOCK'}
                </div>
              </motion.a>
            );
          })
        }
      </div>

      {/* Admin: add store link hint */}
      {user?.role === 'ADMIN' && (
        <p className="text-caption2 text-dark-label3 mb-4 text-center">
          Admin: go to <Link to="/admin/products" className="text-apple-blue hover:underline">Admin → Products</Link> to add store links for this product.
        </p>
      )}

      {/* How often this product comes back in stock */}
      <RestockFrequencyBadge slug={slug!} />

      {/* Visual in/out stock history timeline */}
      <StockTimelinePanel slug={slug!} />

      {/* Price history chart (renders only when there are ≥2 priced points) */}
      <PriceHistoryChart events={stockHistory as StockHistoryEvent[]} />

      {/* Stock log link */}
      <button onClick={() => setShowStockLog(!showStockLog)}
        className="text-apple-blue text-footnote font-semibold hover:opacity-80 transition-opacity mb-6 flex items-center gap-1">
        Stock log: see when stores had stock
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 6h8M6 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Stock log panel */}
      <AnimatePresence>
        {showStockLog && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden">
            <h2 className="text-title2 font-bold text-dark-label1 mb-3">Latest stock times</h2>
            {(stockHistory as any[]).length === 0
              ? <div className="card p-6 text-center text-dark-label2 text-footnote">No history yet. Builds as the scraper runs.</div>
              : <div className="card divide-y divide-dark-separator">
                  {(stockHistory as any[]).map((event: any) => (
                    <div key={event.id} className="flex items-start justify-between px-4 py-3.5">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-subhead font-semibold text-dark-label1">{event.storeName}</p>
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

      {/* Report a scraper problem (signed-in users) */}
      <ReportIssue
        productId={product.id}
        productName={product.name}
        stores={(allStatuses ?? []).map((s: any) => ({ storeSlug: s.storeSlug, storeName: s.storeName }))}
      />

      {/* Similar items — co-tracked, with category fallback */}
      <SimilarItems slug={slug!} />

      {/* Comments */}
      <div>
        <h2 className="text-title2 font-bold text-dark-label1 mb-4">COMMENTS</h2>
        <div className="flex gap-2 mb-6">
          <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim() && user) postComment.mutate(commentText); }}
            placeholder={user ? 'Add a comment...' : 'Sign in to comment'}
            disabled={!user || postComment.isPending}
            className="input flex-1" maxLength={1000} />
          <button onClick={() => refetchComments()} className="btn-icon w-10 h-10 text-dark-label2 hover:text-dark-label1 shrink-0" title="Refresh">
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
                      <span className="text-footnote font-semibold text-dark-label1">{comment.user?.name ?? 'User'}</span>
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
