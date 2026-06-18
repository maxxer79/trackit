import { useTrackingAnalytics } from '../../hooks/useProducts';

// Format a 0..23 hour as a friendly label, e.g. 14 → "2 PM".
function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

function prettyRetailer(slug: string): string {
  if (slug === 'unknown') return 'Unknown store';
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function InsightsPanel() {
  const { data, isLoading } = useTrackingAnalytics();

  // Stay quiet until there's at least one restock to talk about — no empty
  // panel cluttering a fresh dashboard.
  if (isLoading || !data || data.summary.total < 1) return null;

  const { summary, windowDays, timezone } = data;
  const { total, restocksPerMonth, peakHour, byHour, topRetailers } = summary;
  const maxHour = Math.max(...byHour, 1);

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-headline font-semibold text-dark-label1">Your Insights</h2>
        <span className="text-caption2 text-dark-label3">
          based on {total} restock{total === 1 ? '' : 's'} · last {windowDays} days
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Restocks per month */}
        <div>
          <p className="text-caption1 text-dark-label2 mb-1">Restocks per month</p>
          {restocksPerMonth != null ? (
            <p className="text-title1 font-bold text-apple-blue">{restocksPerMonth}</p>
          ) : (
            <p className="text-footnote text-dark-label3 mt-1">
              Not enough history yet — keep tracking and this fills in after a couple of weeks.
            </p>
          )}
        </div>

        {/* When items restock */}
        <div>
          <p className="text-caption1 text-dark-label2 mb-1">When your items restock</p>
          {peakHour != null ? (
            <>
              <p className="text-title3 font-bold text-dark-label1">
                ~{formatHour(peakHour)}
              </p>
              <p className="text-caption2 text-dark-label3 mb-2">your time ({timezone})</p>
              <div className="flex items-end gap-px h-8" aria-hidden="true">
                {byHour.map((n, h) => (
                  <div
                    key={h}
                    title={`${formatHour(h)}: ${n}`}
                    className={`flex-1 rounded-sm ${h === peakHour ? 'bg-apple-blue' : 'bg-dark-surface2'}`}
                    style={{ height: `${Math.max((n / maxHour) * 100, 6)}%` }}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-footnote text-dark-label3 mt-1">No restock times recorded yet.</p>
          )}
        </div>

        {/* Top retailers */}
        <div>
          <p className="text-caption1 text-dark-label2 mb-2">Most active retailers</p>
          {topRetailers.length > 0 ? (
            <ul className="space-y-1.5">
              {topRetailers.slice(0, 3).map((r) => (
                <li key={r.storeSlug} className="flex items-center justify-between">
                  <span className="text-footnote text-dark-label1 truncate">{prettyRetailer(r.storeSlug)}</span>
                  <span className="text-caption1 font-semibold text-dark-label2 ml-2 shrink-0">
                    {r.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-footnote text-dark-label3">No retailer data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
