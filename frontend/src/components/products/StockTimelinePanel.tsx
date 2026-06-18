import { format } from 'date-fns';
import { useStockTimeline } from '../../hooks/useProducts';

export default function StockTimelinePanel({ slug }: { slug: string }) {
  const { data, isLoading } = useStockTimeline(slug);

  if (isLoading || !data || data.segments.length === 0) return null;

  const segs = data.segments;
  const start = new Date(segs[0].start).getTime();
  const end = new Date(segs[segs.length - 1].end).getTime();
  const total = Math.max(end - start, 1);
  const last = segs[segs.length - 1];

  const pct = (s: { start: string; end: string }) =>
    ((new Date(s.end).getTime() - new Date(s.start).getTime()) / total) * 100;

  return (
    <section className="card p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-headline font-semibold text-dark-label1">Stock history</h2>
        <span className="text-caption2 text-dark-label3">
          {data.restockCount} restock{data.restockCount === 1 ? '' : 's'} recorded
        </span>
      </div>

      {/* Proportional in/out bar */}
      <div className="flex w-full h-6 rounded-apple overflow-hidden bg-dark-surface2">
        {segs.map((s, i) => (
          <div
            key={i}
            className={s.state === 'in' ? 'bg-apple-green' : 'bg-dark-surface2'}
            style={{ width: `${Math.max(pct(s), 0.5)}%`, minWidth: '2px' }}
            title={`${s.state === 'in' ? 'In stock' : 'Out of stock'} · ${format(new Date(s.start), 'MMM d, yyyy')} – ${format(new Date(s.end), 'MMM d, yyyy')} · ${s.days}d`}
          />
        ))}
      </div>

      {/* Axis */}
      <div className="flex justify-between mt-1.5 text-caption2 text-dark-label3">
        <span>{format(new Date(segs[0].start), 'MMM d, yyyy')}</span>
        <span>now</span>
      </div>

      {/* Legend + current state */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-caption1">
        <span className="flex items-center gap-1.5 text-dark-label2">
          <span className="w-2.5 h-2.5 rounded-sm bg-apple-green inline-block" /> In stock
        </span>
        <span className="flex items-center gap-1.5 text-dark-label2">
          <span className="w-2.5 h-2.5 rounded-sm bg-dark-surface2 inline-block" /> Out of stock
        </span>
        <span className="text-dark-label3 ml-auto">
          Currently {last.state === 'in' ? 'in stock' : 'out of stock'} since{' '}
          {format(new Date(last.start), 'MMM d')}
        </span>
      </div>
    </section>
  );
}
