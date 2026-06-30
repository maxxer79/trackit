import clsx from 'clsx';
import { usePriceInsight, DealVerdict } from '../../hooks/useProducts';

/**
 * Good-deal verdict: positions the current best in-stock price against its own
 * trailing-window history (time-weighted, computed server-side). Stays silent
 * until there's enough history for an honest read (verdict === null).
 */

const VERDICT_META: Record<
  Exclude<DealVerdict, null>,
  { label: (d: number) => string; emoji: string; cls: string }
> = {
  lowest: {
    label: (d) => `Lowest price in ${d} days`,
    emoji: '🔥',
    cls: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  },
  great: {
    label: () => 'Great price — below its usual',
    emoji: '🟢',
    cls: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  },
  below_avg: {
    label: () => 'Below its average price',
    emoji: '👍',
    cls: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  },
  average: {
    label: () => 'Around its usual price',
    emoji: '➖',
    cls: 'text-dark-label2 bg-dark-surface2 border-dark-separator',
  },
  above_avg: {
    label: () => 'Above its average price',
    emoji: '⚠️',
    cls: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20',
  },
  high: {
    label: (d) => `Near its highest in ${d} days`,
    emoji: '🔺',
    cls: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20',
  },
};

const money = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PriceDealBadge({ slug }: { slug: string }) {
  const { data, isLoading } = usePriceInsight(slug);

  // Stay quiet until the server has enough history to judge fairly.
  if (isLoading || !data || data.verdict == null || data.current == null) return null;

  const meta = VERDICT_META[data.verdict];
  const { current, windowLow, windowHigh, timeWeightedAvg, windowDays, storeName, confidence } = data;

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3">
        <span className="text-xl" aria-hidden="true">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('text-caption2 font-semibold px-2 py-0.5 rounded-pill border', meta.cls)}>
              {meta.label(windowDays)}
            </span>
            <span className="text-subhead font-semibold text-dark-label1">
              {money(current)}
              {storeName && <span className="text-dark-label2 font-normal"> at {storeName}</span>}
            </span>
          </div>
          <p className="text-caption1 text-dark-label2 mt-1">
            {windowLow != null && windowHigh != null && (
              <>{windowDays}-day range {money(windowLow)}–{money(windowHigh)}</>
            )}
            {timeWeightedAvg != null && <> · typically ~{money(timeWeightedAvg)}</>}
            {confidence === 'low' && <> · early read, still building history</>}
          </p>
        </div>
      </div>
    </div>
  );
}
