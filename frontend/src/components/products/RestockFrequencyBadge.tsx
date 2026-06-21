import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';
import { useRestockFrequency } from '../../hooks/useProducts';

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  if (d < 1.5) return 'about a day';
  if (d < 14) return `about ${Math.round(d)} days`;
  if (d < 60) return `about ${Math.round(d / 7)} weeks`;
  return `about ${Math.round(d / 30.4)} months`;
}

const CONFIDENCE_META: Record<'low' | 'medium' | 'high', { label: string; cls: string }> = {
  high: { label: 'high confidence', cls: 'text-apple-green bg-apple-green/10 border-apple-green/20' },
  medium: { label: 'medium confidence', cls: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20' },
  low: { label: 'low confidence', cls: 'text-dark-label2 bg-dark-surface2 border-dark-separator' },
};

export default function RestockFrequencyBadge({ slug, outOfStock = false }: { slug: string; outOfStock?: boolean }) {
  const { data, isLoading } = useRestockFrequency(slug);

  // Stay quiet until at least one restock has been recorded.
  if (isLoading || !data || data.restockCount < 1) return null;

  const { medianIntervalDays, lastRestockAt, restockCount, prediction } = data;
  const last = lastRestockAt ? new Date(lastRestockAt) : null;

  // Surface a prediction only once the model is confident enough to commit to a
  // window, and only when the item is currently out of stock — a forward-looking
  // "back around X" is the useful framing; if it's in stock there's nothing to
  // wait for.
  const showPrediction =
    outOfStock &&
    prediction?.predictedNextAt != null &&
    prediction.confidence != null;

  const predAt = showPrediction ? new Date(prediction!.predictedNextAt!) : null;
  const winStart = showPrediction && prediction!.windowStart ? new Date(prediction!.windowStart) : null;
  const winEnd = showPrediction && prediction!.windowEnd ? new Date(prediction!.windowEnd) : null;
  const conf = showPrediction ? CONFIDENCE_META[prediction!.confidence as 'low' | 'medium' | 'high'] : null;

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-3">
        <span className="text-xl" aria-hidden="true">🔄</span>
        <div className="flex-1 min-w-0">
          {medianIntervalDays != null ? (
            <p className="text-subhead font-semibold text-dark-label1">
              Restocks {formatDays(medianIntervalDays)} on average
            </p>
          ) : (
            <p className="text-subhead font-semibold text-dark-label1">
              Restock pattern still building
            </p>
          )}
          <p className="text-caption1 text-dark-label2 mt-0.5">
            {last && <>Last restocked {formatDistanceToNow(last, { addSuffix: true })} · </>}
            {restockCount} restock{restockCount === 1 ? '' : 's'} on record
            {medianIntervalDays == null && restockCount < 3 && ' — need a few more for a reliable estimate'}
          </p>
        </div>
      </div>

      {showPrediction && predAt && (
        <div className="mt-3 pt-3 border-t border-dark-separator">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base" aria-hidden="true">📅</span>
            {prediction!.overdue ? (
              <p className="text-subhead font-semibold text-apple-orange">
                Overdue for a restock — could be back any time now
              </p>
            ) : (
              <p className="text-subhead font-semibold text-dark-label1">
                Likely back around {format(predAt, 'EEE, MMM d')}
              </p>
            )}
            {conf && (
              <span className={clsx('text-caption2 font-semibold px-2 py-0.5 rounded-pill border', conf.cls)}>
                {conf.label}
              </span>
            )}
          </div>
          <p className="text-caption1 text-dark-label2 mt-0.5">
            {winStart && winEnd && !prediction!.overdue && (
              <>Typically returns between {format(winStart, 'MMM d')} and {format(winEnd, 'MMM d')}. </>
            )}
            Based on {prediction!.intervalsCount} past interval{prediction!.intervalsCount === 1 ? '' : 's'} — an
            estimate, not a guarantee.
          </p>
        </div>
      )}
    </div>
  );
}
