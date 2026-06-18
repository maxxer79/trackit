import { formatDistanceToNow } from 'date-fns';
import { useRestockFrequency } from '../../hooks/useProducts';

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  if (d < 1.5) return 'about a day';
  if (d < 14) return `about ${Math.round(d)} days`;
  if (d < 60) return `about ${Math.round(d / 7)} weeks`;
  return `about ${Math.round(d / 30.4)} months`;
}

export default function RestockFrequencyBadge({ slug }: { slug: string }) {
  const { data, isLoading } = useRestockFrequency(slug);

  // Stay quiet until at least one restock has been recorded.
  if (isLoading || !data || data.restockCount < 1) return null;

  const { medianIntervalDays, lastRestockAt, restockCount } = data;
  const last = lastRestockAt ? new Date(lastRestockAt) : null;

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
    </div>
  );
}
