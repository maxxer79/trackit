import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTracking, useRemoveTracking, useUpdateTracking, useImportTracking, useBulkTracking } from '../hooks/useProducts';
import { useAuthStore } from '../store/auth';
import StatusBadge from '../components/ui/StatusBadge';
import { ProductCardSkeleton } from '../components/ui/Skeleton';
import { StockStatus } from '../types';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { downloadFile } from '../lib/download';
import InsightsPanel from '../components/dashboard/InsightsPanel';
import ItemNotesTags from '../components/dashboard/ItemNotesTags';
import ItemAlertRules from '../components/dashboard/ItemAlertRules';
import MarkPurchased from '../components/dashboard/MarkPurchased';
import ItemMuteArchive from '../components/dashboard/ItemMuteArchive';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data: tracking, isLoading } = useTracking();
  const removeTracking = useRemoveTracking();
  const updateTracking = useUpdateTracking();
  const importTracking = useImportTracking();
  const bulk = useBulkTracking();
  const [importUrl, setImportUrl] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleImport = (e: React.FormEvent) => {
    e.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    importTracking.mutate(url, {
      onSuccess: (data) => {
        toast.success(data?.message || 'Tracking started');
        setImportUrl('');
      },
      onError: (err: any) =>
        toast.error(err?.response?.data?.error || 'Could not import that URL'),
    });
  };

  const handleRemove = async (productId: string, productName: string) => {
    try {
      await removeTracking.mutateAsync(productId);
      toast.success(`Stopped tracking ${productName}`);
    } catch {
      toast.error('Failed to remove tracking');
    }
  };

  const runBulk = (
    op: 'update' | 'remove',
    changes: Record<string, unknown> | undefined,
    label: string
  ) => {
    const productIds = [...selected];
    if (productIds.length === 0) return;
    bulk.mutate(
      { productIds, op, changes } as any,
      {
        onSuccess: (r: { affected: number }) => {
          toast.success(`${label} — ${r.affected} item${r.affected === 1 ? '' : 's'}`);
          setSelected(new Set());
        },
        onError: () => toast.error('Bulk action failed'),
      }
    );
  };

  const bulkSetMaxPrice = () => {
    const v = window.prompt('Set max auto-buy price for selected items (leave blank to clear):');
    if (v === null) return;
    const trimmed = v.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    if (num !== null && (Number.isNaN(num) || num < 0)) {
      toast.error('Enter a valid non-negative number');
      return;
    }
    runBulk('update', { autoBuyMaxPrice: num }, 'Max price updated');
  };

  const bulkStop = () => {
    if (!window.confirm(`Stop tracking ${selected.size} item${selected.size === 1 ? '' : 's'}?`)) return;
    runBulk('remove', undefined, 'Stopped tracking');
  };

  const limitText = user?.trackingLimit === -1
    ? 'Unlimited tracking'
    : `${user?.trackingCount ?? 0} / ${user?.trackingLimit ?? 1} items tracked`;

  // Archived items are hidden from the main view (restorable from the Archived toggle).
  const nonArchived = (tracking ?? []).filter((t: any) => !t.archivedAt);
  const archivedItems = (tracking ?? []).filter((t: any) => !!t.archivedAt);

  const inStockItems = nonArchived.filter((t) =>
    t.stockStatuses?.some((s: any) => s.status === 'IN_STOCK' || s.status === 'LIMITED')
  );

  const allTags = [...new Set(nonArchived.flatMap((t: any) => t.tags ?? []))].sort() as string[];
  const visibleTracking = nonArchived.filter(
    (t: any) => !tagFilter || (t.tags ?? []).includes(tagFilter)
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">My Dashboard</h1>
          <p className="section-subtitle">{limitText}</p>
        </div>
        <div className="flex items-center gap-2">
          {tracking && tracking.length > 0 && (
            <button
              onClick={() =>
                downloadFile('/tracking/export', 'trackit-tracked-items.csv').catch(() =>
                  toast.error('Export failed')
                )
              }
              className="btn-secondary px-4 py-2.5 text-subhead"
            >
              Export CSV
            </button>
          )}
          <Link to="/browse" className="btn-primary px-5 py-2.5 text-subhead">
            + Track More
          </Link>
        </div>
      </div>

      {/* Add by URL — paste a product link to track it */}
      <form onSubmit={handleImport} className="card p-4 mb-6 flex items-center gap-3 flex-wrap">
        <span className="text-lg" aria-hidden="true">🔗</span>
        <input
          type="url"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          placeholder="Paste a product URL from a supported store…"
          className="input flex-1 min-w-[220px] text-sm"
        />
        <button
          type="submit"
          disabled={importTracking.isPending || !importUrl.trim()}
          className="btn-primary px-5 py-2.5 text-subhead disabled:opacity-40"
        >
          {importTracking.isPending ? 'Adding…' : 'Track URL'}
        </button>
      </form>

      {/* Stats bar */}
      {tracking && tracking.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            {
              label: 'Tracking',
              value: nonArchived.length,
              color: 'text-dark-label1',
            },
            {
              label: 'In Stock',
              value: inStockItems?.length ?? 0,
              color: 'text-apple-green',
            },
            {
              label: 'Out of Stock',
              value: (nonArchived.length - (inStockItems?.length ?? 0)),
              color: 'text-apple-red',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4 text-center">
              <p className={`text-title1 font-bold ${color}`}>{value}</p>
              <p className="text-caption1 text-dark-label2 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Personal restock insights */}
      <InsightsPanel />

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-caption2 text-dark-label3">Tags:</span>
          <button
            onClick={() => setTagFilter(null)}
            className={`text-caption2 px-2.5 py-1 rounded-pill border transition-colors ${
              !tagFilter ? 'border-apple-blue text-apple-blue bg-apple-blue/10' : 'border-dark-separator text-dark-label2 hover:text-dark-label1'
            }`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t === tagFilter ? null : t)}
              className={`text-caption2 px-2.5 py-1 rounded-pill border transition-colors ${
                t === tagFilter ? 'border-apple-blue text-apple-blue bg-apple-blue/10' : 'border-dark-separator text-dark-label2 hover:text-dark-label1'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 card p-3 mb-4 flex flex-wrap items-center gap-2 border-apple-blue/40 bg-dark-surface2/95 backdrop-blur">
          <span className="text-subhead font-semibold text-dark-label1">{selected.size} selected</span>
          <button
            onClick={() => setSelected(new Set((visibleTracking ?? []).map((t: any) => t.product.id)))}
            className="text-caption1 text-apple-blue hover:underline ml-1"
          >
            Select all
          </button>
          <div className="flex-1" />
          {[
            { label: '📧 On', op: 'update' as const, changes: { notifyEmail: true }, done: 'Email on' },
            { label: '📧 Off', op: 'update' as const, changes: { notifyEmail: false }, done: 'Email off' },
            { label: '🔔 On', op: 'update' as const, changes: { notifyPush: true }, done: 'Push on' },
            { label: '🔔 Off', op: 'update' as const, changes: { notifyPush: false }, done: 'Push off' },
          ].map((a) => (
            <button
              key={a.label}
              disabled={bulk.isPending}
              onClick={() => runBulk(a.op, a.changes, a.done)}
              className="btn-secondary px-3 py-1.5 text-caption1 disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
          <button disabled={bulk.isPending} onClick={bulkSetMaxPrice} className="btn-secondary px-3 py-1.5 text-caption1 disabled:opacity-40">
            Set max $
          </button>
          <button
            disabled={bulk.isPending}
            onClick={bulkStop}
            className="px-3 py-1.5 text-caption1 rounded-apple text-apple-red border border-apple-red/30 hover:bg-apple-red/10 disabled:opacity-40"
          >
            Stop tracking
          </button>
          <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-caption1 text-dark-label2 hover:text-dark-label1">
            Clear
          </button>
        </div>
      )}

      {/* Tracking list */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : nonArchived.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-5xl mb-4">📦</p>
          <h2 className="text-title1 font-bold text-dark-label1 mb-2">Nothing tracked yet</h2>
          <p className="text-subhead text-dark-label2 mb-6">
            Browse products and hit the ★ to start tracking availability.
          </p>
          <Link to="/browse" className="btn-primary">Browse Products</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {(visibleTracking ?? []).map((item, i) => {
            const bestStatus: StockStatus = item.stockStatuses?.find((s: any) => s.status === 'IN_STOCK')?.status
              ?? item.stockStatuses?.find((s: any) => s.status === 'LIMITED')?.status
              ?? item.stockStatuses?.find((s: any) => s.status === 'OUT_OF_STOCK')?.status
              ?? 'UNKNOWN';

            const lowestPrice = item.stockStatuses
              ?.filter((s: any) => s.price != null)
              .map((s: any) => s.price)
              .sort((a: number, b: number) => a - b)[0];

            const lastChecked = item.stockStatuses
              ?.map((s: any) => new Date(s.lastCheckedAt))
              .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];

            return (
              <motion.div
                key={item.id}
                className="card hover:bg-dark-surface2 transition-colors"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <div className="flex items-center gap-4 p-4">
                  {/* Bulk select */}
                  <input
                    type="checkbox"
                    checked={selected.has(item.product.id)}
                    onChange={() => toggleSelect(item.product.id)}
                    className="w-4 h-4 accent-apple-blue shrink-0 cursor-pointer"
                    title="Select for bulk actions"
                    aria-label={`Select ${item.product.name}`}
                  />

                  {/* Image */}
                  <Link to={`/product/${item.product.slug}`} className="shrink-0">
                    <div className="w-16 h-16 rounded-apple bg-dark-surface2 overflow-hidden flex items-center justify-center">
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <span className="text-2xl opacity-30">📦</span>
                      )}
                    </div>
                  </Link>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link to={`/product/${item.product.slug}`}>
                      <h3 className="text-subhead font-semibold text-dark-label1 hover:text-apple-blue transition-colors line-clamp-1">
                        {item.product.name}
                      </h3>
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <StatusBadge status={bestStatus} size="sm" />
                      {lowestPrice && (
                        <span className="text-caption1 font-semibold text-apple-blue">
                          from ${lowestPrice.toFixed(2)}
                        </span>
                      )}
                      {lastChecked && (
                        <span className="text-caption2 text-dark-label3">
                          checked {formatDistanceToNow(lastChecked, { addSuffix: true })}
                        </span>
                      )}
                    </div>

                    {/* Store statuses inline */}
                    {item.stockStatuses && item.stockStatuses.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.stockStatuses.slice(0, 5).map((s: any) => (
                          <a
                            key={s.storeId}
                            href={s.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-caption2 px-2 py-0.5 rounded-pill border font-medium transition-colors ${
                              s.status === 'IN_STOCK' || s.status === 'LIMITED'
                                ? 'border-apple-green/30 text-apple-green hover:bg-apple-green/10'
                                : 'border-dark-separator text-dark-label3 hover:text-dark-label1'
                            }`}
                          >
                            {s.storeName}{(s.condition && s.condition !== 'NEW') ? ` · ${s.condition === 'OPEN_BOX' ? 'Open Box' : s.condition === 'REFURBISHED' ? 'Refurb' : 'Used'}` : ''}
                          </a>
                        ))}
                        {item.stockStatuses.length > 5 && (
                          <span className="text-caption2 text-dark-label3">+{item.stockStatuses.length - 5} more</span>
                        )}
                      </div>
                    )}

                    {/* Private notes & tags */}
                    <ItemNotesTags productId={item.product.id} note={item.note} tags={item.tags} />

                    {/* Per-item advanced alert rules */}
                    <ItemAlertRules productId={item.product.id} alertMaxPrice={item.alertMaxPrice} alertDays={item.alertDays} />

                    {/* Mark as purchased → delivery tracking */}
                    <MarkPurchased productId={item.product.id} defaultPrice={lowestPrice} />

                    {/* Silent mode + archive */}
                    <ItemMuteArchive productId={item.product.id} mutedUntil={item.mutedUntil} />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Per-item channel toggles */}
                    <button
                      onClick={() => updateTracking.mutate({ productId: item.product.id, notifyEmail: !item.notifyEmail })}
                      className={`btn-icon w-8 h-8 text-sm ${item.notifyEmail ? 'text-apple-blue bg-apple-blue/10' : 'text-dark-label3 hover:text-dark-label1'}`}
                      title={item.notifyEmail ? 'Email alerts on — click to mute for this item' : 'Email alerts off — click to enable for this item'}
                    >
                      📧
                    </button>
                    <button
                      onClick={() => updateTracking.mutate({ productId: item.product.id, notifyPush: !item.notifyPush })}
                      className={`btn-icon w-8 h-8 text-sm ${item.notifyPush ? 'text-apple-blue bg-apple-blue/10' : 'text-dark-label3 hover:text-dark-label1'}`}
                      title={item.notifyPush ? 'Push alerts on — click to mute for this item' : 'Push alerts off — click to enable for this item'}
                    >
                      🔔
                    </button>
                    {bestStatus !== 'UNKNOWN' && bestStatus !== 'OUT_OF_STOCK' && (
                      <a
                        href={item.stockStatuses?.find((s: any) => s.status === bestStatus)?.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary px-3 py-1.5 text-caption1"
                      >
                        Shop
                      </a>
                    )}
                    <button
                      onClick={() => handleRemove(item.product.id, item.product.name)}
                      className="btn-icon w-8 h-8 text-dark-label3 hover:text-apple-red hover:bg-apple-red/10"
                      title="Stop tracking"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M2 2l10 10M12 2L2 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Archived items */}
      {archivedItems.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-subhead font-semibold text-dark-label2 hover:text-dark-label1 flex items-center gap-2"
          >
            📦 Archived ({archivedItems.length}) {showArchived ? '▾' : '▸'}
          </button>
          {showArchived && (
            <div className="space-y-2 mt-3">
              {archivedItems.map((item: any) => (
                <div key={item.id} className="card p-3 flex items-center gap-3">
                  <Link to={`/product/${item.product.slug}`} className="shrink-0">
                    <div className="w-10 h-10 rounded-apple bg-dark-surface2 overflow-hidden flex items-center justify-center">
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-contain p-0.5" />
                      ) : (
                        <span className="opacity-30">📦</span>
                      )}
                    </div>
                  </Link>
                  <Link to={`/product/${item.product.slug}`} className="flex-1 min-w-0 text-footnote text-dark-label1 hover:text-apple-blue line-clamp-1">
                    {item.product.name}
                  </Link>
                  <ItemMuteArchive productId={item.product.id} archived />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upgrade prompt for limited users */}
      {user && user.trackingLimit !== -1 && user.trackingCount >= user.trackingLimit && (
        <div className="mt-6 card p-6 border-apple-orange/30 bg-apple-orange/5">
          <p className="text-subhead font-semibold text-apple-orange mb-1">Tracking Limit Reached</p>
          <p className="text-footnote text-dark-label2">
            You're tracking {user.trackingCount} of {user.trackingLimit} allowed items.
            Contact an admin to unlock more tracking slots.
          </p>
        </div>
      )}
    </div>
  );
}
