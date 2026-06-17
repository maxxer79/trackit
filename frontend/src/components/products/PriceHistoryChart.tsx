import { format } from 'date-fns';

export interface StockHistoryEvent {
  id: string;
  storeName: string;
  storeSlug: string;
  status: string;
  price: number | null;
  productUrl?: string | null;
  createdAt: string;
}

// Dependency-free price-history chart (no charting lib — keeps the bundle lean
// and matches the app's hand-rolled, dark Apple-ish styling). One line per
// store; hollow dots mark out-of-stock points.
const SERIES_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff375f', '#64d2ff'];

function inStock(status: string): boolean {
  return status === 'IN_STOCK' || status === 'LIMITED' || status === 'PREORDER';
}

export default function PriceHistoryChart({ events }: { events: StockHistoryEvent[] }) {
  const priced = events
    .filter((e) => e.price != null)
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Need at least two priced points to draw a meaningful line.
  if (priced.length < 2) return null;

  const byStore = new Map<string, StockHistoryEvent[]>();
  for (const e of priced) {
    const arr = byStore.get(e.storeSlug) ?? [];
    arr.push(e);
    byStore.set(e.storeSlug, arr);
  }
  const stores = [...byStore.entries()];

  const times = priced.map((e) => new Date(e.createdAt).getTime());
  const prices = priced.map((e) => e.price as number);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  let minP = Math.min(...prices);
  let maxP = Math.max(...prices);
  if (minP === maxP) {
    minP -= 1;
    maxP += 1;
  }
  const padP = (maxP - minP) * 0.1;
  minP -= padP;
  maxP += padP;

  const W = 640;
  const H = 260;
  const PAD = { left: 52, right: 16, top: 16, bottom: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xOf = (t: number) =>
    PAD.left + (maxT === minT ? plotW / 2 : ((t - minT) / (maxT - minT)) * plotW);
  const yOf = (p: number) => PAD.top + (1 - (p - minP) / (maxP - minP)) * plotH;

  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => minP + ((maxP - minP) * i) / ticks);

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-subhead font-semibold text-dark-label1">Price history</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {stores.map(([slug, evs], i) => (
            <span key={slug} className="flex items-center gap-1.5 text-caption2 text-dark-label2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {evs[0].storeName}
            </span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price history chart">
        {/* price gridlines + labels */}
        {gridY.map((p, i) => (
          <g key={`g${i}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(p)} y2={yOf(p)} stroke="#3a3a3c" strokeWidth="1" />
            <text x={PAD.left - 6} y={yOf(p) + 3} textAnchor="end" fontSize="10" fill="#8e8e93">
              ${p.toFixed(p >= 100 ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* time labels: first / mid / last */}
        {[minT, (minT + maxT) / 2, maxT].map((t, i) => (
          <text
            key={`x${i}`}
            x={xOf(t)}
            y={H - PAD.bottom + 18}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            fontSize="10"
            fill="#8e8e93"
          >
            {format(new Date(t), 'M/d')}
          </text>
        ))}

        {/* one line + points per store */}
        {stores.map(([slug, evs], i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const pts = evs
            .map((e) => `${xOf(new Date(e.createdAt).getTime())},${yOf(e.price as number)}`)
            .join(' ');
          return (
            <g key={slug}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {evs.map((e) => (
                <circle
                  key={e.id}
                  cx={xOf(new Date(e.createdAt).getTime())}
                  cy={yOf(e.price as number)}
                  r="3"
                  fill={inStock(e.status) ? color : '#1c1c1e'}
                  stroke={color}
                  strokeWidth="1.5"
                >
                  <title>
                    {`${e.storeName} • $${(e.price as number).toFixed(2)} • ${format(
                      new Date(e.createdAt),
                      'M/d/yy h:mm aa'
                    )} • ${e.status.replace(/_/g, ' ').toLowerCase()}`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      <p className="text-caption2 text-dark-label3 mt-1">Hollow dots = out of stock at that price.</p>
    </div>
  );
}
