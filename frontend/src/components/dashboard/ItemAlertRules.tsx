import { useState } from 'react';
import { useUpdateTracking, usePriceInsight } from '../../hooks/useProducts';

interface Props {
  productId: string;
  productSlug?: string;
  alertMaxPrice?: number | string | null;
  priceTarget?: number | string | null;
  alertDays?: number[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const money = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ItemAlertRules({ productId, productSlug, alertMaxPrice, priceTarget, alertDays = [] }: Props) {
  const update = useUpdateTracking();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(alertMaxPrice != null ? String(alertMaxPrice) : '');
  const [target, setTarget] = useState(priceTarget != null ? String(priceTarget) : '');
  const [days, setDays] = useState<number[]>(alertDays);

  // Lazily pull price history only once the panel is open, to suggest a target.
  const { data: insight } = usePriceInsight(open && productSlug ? productSlug : '');

  const hasRules = (alertMaxPrice != null) || (priceTarget != null) || (alertDays && alertDays.length > 0);

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    setDays(next);
    update.mutate({ productId, alertDays: next });
  };

  const savePrice = () => {
    const trimmed = price.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    if (num !== null && (Number.isNaN(num) || num < 0)) return;
    update.mutate({ productId, alertMaxPrice: num });
  };

  const saveTarget = () => {
    const trimmed = target.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    if (num !== null && (Number.isNaN(num) || num < 0)) return;
    update.mutate({ productId, priceTarget: num });
  };

  const applyTarget = (value: number) => {
    const v = Number(value.toFixed(2));
    setTarget(String(v));
    update.mutate({ productId, priceTarget: v });
  };

  // Suggest sensible targets from the item's own price history: its window low
  // ("alert me if it's ever this cheap again") and, when current sits above it,
  // its typical/time-weighted price ("wait for a normal price").
  const low = insight?.windowLow ?? null;
  const typical = insight?.timeWeightedAvg ?? null;
  const current = insight?.current ?? null;
  const suggestLow = low != null;
  const suggestTypical = typical != null && current != null && typical < current - 0.01 && (low == null || typical > low + 0.01);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className={`text-caption2 ${hasRules ? 'text-apple-blue' : 'text-dark-label3'} hover:text-apple-blue`}
      >
        ⚙ Alert rules{hasRules ? ' · on' : ''} {open ? '▾' : '▸'}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-caption2 text-dark-label2 w-24">🎯 Alert me at ≤</span>
            <span className="text-caption1 text-dark-label3">$</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={saveTarget}
              onKeyDown={(e) => e.key === 'Enter' && saveTarget()}
              inputMode="decimal"
              placeholder="target"
              className="input w-20 text-caption1 py-1"
            />
            <span className="text-caption2 text-dark-label3">fires when the price drops to your number</span>
          </div>

          {(suggestLow || suggestTypical) && (
            <div className="flex items-center gap-1.5 flex-wrap pl-[6.5rem]">
              <span className="text-caption2 text-dark-label3">💡 Suggested:</span>
              {suggestLow && (
                <button
                  onClick={() => applyTarget(low as number)}
                  className="text-caption2 px-2 py-0.5 rounded-pill border border-apple-green/30 text-apple-green bg-apple-green/10 hover:bg-apple-green/20 transition-colors"
                  title={`Its lowest price over the last ${insight?.windowDays ?? 90} days`}
                >
                  {money(low as number)} · {insight?.windowDays ?? 90}-day low
                </button>
              )}
              {suggestTypical && (
                <button
                  onClick={() => applyTarget(typical as number)}
                  className="text-caption2 px-2 py-0.5 rounded-pill border border-dark-separator text-dark-label2 hover:text-dark-label1 hover:border-apple-blue transition-colors"
                  title="Its typical, time-weighted price"
                >
                  {money(typical as number)} · typical
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-caption2 text-dark-label2 w-24">Only if price ≤</span>
            <span className="text-caption1 text-dark-label3">$</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={savePrice}
              onKeyDown={(e) => e.key === 'Enter' && savePrice()}
              inputMode="decimal"
              placeholder="any"
              className="input w-20 text-caption1 py-1"
            />
            <span className="text-caption2 text-dark-label3">filter: mutes other alerts above this</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-caption2 text-dark-label2 w-24">Only on days</span>
            {DAYS.map((label, d) => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className={`text-caption2 w-9 py-1 rounded-pill border transition-colors ${
                  days.includes(d)
                    ? 'border-apple-blue text-apple-blue bg-apple-blue/10'
                    : 'border-dark-separator text-dark-label3 hover:text-dark-label1'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-caption2 text-dark-label3">
            Leave price blank and no days selected for no restrictions. Items with no detected price still alert.
          </p>
        </div>
      )}
    </div>
  );
}
