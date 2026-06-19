import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  usePurchases,
  useUpdatePurchase,
  useDeletePurchase,
  Purchase,
  CARRIERS,
  PURCHASE_STATUSES,
  STATUS_LABEL,
} from '../hooks/usePurchases';

const STATUS_COLOR: Record<string, string> = {
  ORDERED: 'text-dark-label2',
  SHIPPED: 'text-apple-blue',
  OUT_FOR_DELIVERY: 'text-apple-orange',
  DELIVERED: 'text-apple-green',
  CANCELLED: 'text-apple-red',
};

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  const update = useUpdatePurchase();
  const del = useDeletePurchase();

  const patch = (body: Partial<Purchase>) =>
    update.mutate({ id: purchase.id, ...body } as any, { onError: () => toast.error('Update failed') });

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {purchase.productSlug ? (
            <Link to={`/product/${purchase.productSlug}`} className="text-subhead font-semibold text-dark-label1 hover:text-apple-blue line-clamp-1">
              {purchase.productName}
            </Link>
          ) : (
            <span className="text-subhead font-semibold text-dark-label1 line-clamp-1">{purchase.productName}</span>
          )}
          <p className="text-caption2 text-dark-label3 mt-0.5">
            {purchase.storeName ? `${purchase.storeName} · ` : ''}
            {purchase.price != null ? `$${purchase.price.toFixed(2)} · ` : ''}
            bought {format(new Date(purchase.purchasedAt), 'MMM d, yyyy')}
            {purchase.status === 'DELIVERED' && purchase.deliveredAt
              ? ` · delivered ${format(new Date(purchase.deliveredAt), 'MMM d')}`
              : ''}
          </p>
        </div>
        <button
          onClick={() => del.mutate(purchase.id, { onError: () => toast.error('Delete failed') })}
          className="btn-icon w-8 h-8 text-dark-label3 hover:text-apple-red hover:bg-apple-red/10 shrink-0"
          title="Delete purchase"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {/* Status */}
        <select
          value={purchase.status}
          onChange={(e) => patch({ status: e.target.value })}
          className={`input text-caption1 py-1 w-40 font-semibold ${STATUS_COLOR[purchase.status] ?? ''}`}
        >
          {PURCHASE_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>

        {/* Carrier */}
        <select
          value={purchase.carrier ?? ''}
          onChange={(e) => patch({ carrier: e.target.value || null })}
          className="input text-caption1 py-1 w-28"
        >
          <option value="">Carrier…</option>
          {CARRIERS.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Tracking number (blur to save) */}
        <input
          defaultValue={purchase.trackingNumber ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (purchase.trackingNumber ?? '')) patch({ trackingNumber: v || null });
          }}
          placeholder="Tracking #"
          className="input text-caption1 py-1 flex-1 min-w-[120px]"
        />

        {purchase.trackingUrl && (
          <a
            href={purchase.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary px-3 py-1.5 text-caption1 shrink-0"
          >
            Track ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function PurchasesPage() {
  const { data: purchases, isLoading } = usePurchases();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="section-title">My Purchases</h1>
        <p className="section-subtitle">Track deliveries for items you've bought</p>
      </div>

      {isLoading ? (
        <p className="text-subhead text-dark-label3">Loading…</p>
      ) : !purchases || purchases.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-5xl mb-4">🛒</p>
          <h2 className="text-title1 font-bold text-dark-label1 mb-2">No purchases yet</h2>
          <p className="text-subhead text-dark-label2">
            On your dashboard, use <strong>Mark purchased</strong> on a tracked item to start tracking its delivery here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {purchases.map((p) => (
            <PurchaseRow key={p.id} purchase={p} />
          ))}
        </div>
      )}
    </div>
  );
}
