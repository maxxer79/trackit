import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useTracking } from '../hooks/useProducts';

// Tolerant readers: the /tracking payload exposes listings either as
// `stockStatuses` (mapped shape) or `product.storeListings` (raw Prisma) across
// versions, so we read whichever is present and normalize the field names.
function listingsOf(item: any): any[] {
  return item?.stockStatuses ?? item?.product?.storeListings ?? [];
}
const priceOf = (l: any) => (typeof l?.price === 'number' ? l.price : l?.price != null ? Number(l.price) : null);
const lowestOf = (l: any) => (l?.lowestPrice != null ? Number(l.lowestPrice) : null);
const statusOf = (l: any) => l?.status ?? l?.stockStatus ?? (l?.inStock ? 'IN_STOCK' : 'OUT_OF_STOCK');
const storeNameOf = (l: any) => l?.storeName ?? l?.store?.name ?? '';
const urlOf = (l: any) => l?.productUrl ?? l?.url ?? null;

interface Row {
  productId: string;
  slug: string;
  name: string;
  imageUrl?: string | null;
  target: number;
  current: number | null;
  currentStore: string;
  currentUrl: string | null;
  inStock: boolean;
  lowestEver: number | null;
  hitTarget: boolean;
  atLowest: boolean;
}

function buildRow(item: any): Row | null {
  const target = item?.priceTarget != null ? Number(item.priceTarget) : null;
  if (target == null || Number.isNaN(target)) return null;

  const listings = listingsOf(item);
  const priced = listings
    .map((l: any) => ({ l, p: priceOf(l) }))
    .filter((x: any) => x.p != null && x.p > 0);

  // "Current best" = cheapest IN-STOCK listing. A cheaper out-of-stock listing
  // isn't buyable, so it shouldn't win — only fall back to it (still cheapest
  // overall) when nothing priced is actually in stock right now.
  const inStockPriced = priced.filter((x: any) => {
    const st = statusOf(x.l);
    return st === 'IN_STOCK' || st === 'LIMITED';
  });
  const pool = inStockPriced.length > 0 ? inStockPriced : priced;
  pool.sort((a: any, b: any) => a.p - b.p);
  const best = pool[0];
  const current = best ? best.p : null;
  const lowestVals = listings.map(lowestOf).filter((v: number | null) => v != null && v! > 0) as number[];
  const lowestEver = lowestVals.length ? Math.min(...lowestVals) : null;

  return {
    productId: item.product?.id ?? item.productId,
    slug: item.product?.slug ?? item.slug,
    name: item.product?.name ?? item.name ?? 'Untitled',
    imageUrl: item.product?.imageUrl,
    target,
    current,
    currentStore: best ? storeNameOf(best.l) : '',
    currentUrl: best ? urlOf(best.l) : null,
    inStock: best ? statusOf(best.l) === 'IN_STOCK' || statusOf(best.l) === 'LIMITED' : false,
    lowestEver,
    hitTarget: current != null && current <= target,
    atLowest: current != null && lowestEver != null && current <= lowestEver,
  };
}

export default function PriceWatchPage() {
  const { data: tracking, isLoading } = useTracking();

  const rows: Row[] = (tracking ?? [])
    .map(buildRow)
    .filter(Boolean) as Row[];
  // Items that hit their target first, then closest-to-target.
  rows.sort((a, b) => {
    if (a.hitTarget !== b.hitTarget) return a.hitTarget ? -1 : 1;
    const ad = a.current != null ? a.current - a.target : Infinity;
    const bd = b.current != null ? b.current - b.target : Infinity;
    return ad - bd;
  });

  const hitCount = rows.filter((r) => r.hitTarget).length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="section-title">🎯 Price Watch</h1>
        <p className="section-subtitle">
          {rows.length === 0
            ? 'Set a target price on any tracked item to watch it here.'
            : `${rows.length} item${rows.length === 1 ? '' : 's'} with a target · ${hitCount} at or below target`}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-subhead text-dark-label1 mb-1">No price targets yet</p>
          <p className="text-footnote text-dark-label2">
            Open a tracked item's <span className="text-apple-blue">⚙ Alert rules</span> on your Dashboard and set
            “Alert me at ≤ $X”. You'll get pinged the moment the price drops to your number.
          </p>
          <Link to="/dashboard" className="btn-primary inline-block mt-5 px-5 py-2.5 text-subhead">Go to Dashboard</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const pctToTarget =
              r.current != null && r.target > 0 ? Math.round(((r.current - r.target) / r.target) * 100) : null;
            return (
              <motion.div
                key={r.productId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={clsx('card p-4 flex items-center gap-4', r.hitTarget && 'border-apple-green/30 bg-apple-green/5')}
              >
                <Link to={`/product/${r.slug}`} className="shrink-0">
                  <div className="w-14 h-14 rounded-apple bg-dark-surface2 overflow-hidden flex items-center justify-center">
                    {r.imageUrl ? (
                      <img src={r.imageUrl} alt={r.name} className="w-full h-full object-contain p-1" />
                    ) : (
                      <span className="text-xl">📦</span>
                    )}
                  </div>
                </Link>

                <div className="flex-1 min-w-0">
                  <Link to={`/product/${r.slug}`}>
                    <p className="text-subhead font-semibold text-dark-label1 truncate hover:text-apple-blue">{r.name}</p>
                  </Link>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-caption2 text-dark-label3">Target ${r.target.toFixed(2)}</span>
                    {r.lowestEver != null && (
                      <span className="text-caption2 text-dark-label3">· Lowest ever ${r.lowestEver.toFixed(2)}</span>
                    )}
                    {r.currentStore && <span className="text-caption2 text-dark-label3">· {r.currentStore}</span>}
                    {r.atLowest && (
                      <span className="text-caption2 font-semibold text-apple-green px-1.5 py-0.5 rounded-pill border border-apple-green/20 bg-apple-green/10">
                        at its lowest
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {r.current != null ? (
                    <>
                      <p className={clsx('text-headline font-bold tabular-nums', r.hitTarget ? 'text-apple-green' : 'text-dark-label1')}>
                        ${r.current.toFixed(2)}
                      </p>
                      <p className={clsx('text-caption2', r.hitTarget ? 'text-apple-green' : 'text-dark-label3')}>
                        {r.hitTarget ? '✓ at/below target' : pctToTarget != null ? `${pctToTarget}% above` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-caption1 text-dark-label3">no price</p>
                  )}
                  {r.hitTarget && r.currentUrl && (
                    <a
                      href={r.currentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1.5 text-caption1 font-semibold text-apple-blue hover:underline"
                    >
                      Buy now ↗
                    </a>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
