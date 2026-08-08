import { useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { useZipCheck, MAX_ZIPS, type ZipCheckRow } from '../../hooks/useZipCheck';

/**
 * Multi-ZIP price & availability check for one product URL.
 *
 * Shared by the product page panel and the standalone /zip-check page.
 *
 * Display rule that matters: a row with locationResolved:false has NO price —
 * the backend refuses to scrape from a default store and label it with the
 * user's ZIP. Those rows render as "couldn't check", greyed, never as a price.
 */

const ZIP_RE = /^\d{5}(-\d{4})?$/;

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'In stock',
  LIMITED: 'Limited',
  PREORDER: 'Pre-order',
  OUT_OF_STOCK: 'Out of stock',
  UNKNOWN: 'Unknown',
};

function statusClass(status: string): string {
  if (status === 'IN_STOCK' || status === 'LIMITED') return 'text-apple-green';
  if (status === 'PREORDER') return 'text-apple-blue';
  if (status === 'OUT_OF_STOCK') return 'text-dark-label3';
  return 'text-dark-label3';
}

type SortKey = 'zip' | 'price' | 'status';

interface Props {
  /** Pre-filled and locked when rendered on a product page. */
  productUrl?: string;
  /** Retailer item id, passed through to the scraper when known. */
  storeProductId?: string;
  /** Show the URL input (standalone page) vs. hide it (product page panel). */
  showUrlInput?: boolean;
  compact?: boolean;
}

export default function ZipPriceCheck({
  productUrl: fixedUrl,
  storeProductId,
  showUrlInput = false,
  compact = false,
}: Props) {
  const [url, setUrl] = useState(fixedUrl ?? '');
  const [zipInput, setZipInput] = useState('');
  const [zips, setZips] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [error, setError] = useState<string | null>(null);

  const check = useZipCheck();

  const addZip = (raw: string) => {
    const z = raw.trim();
    if (!z) return;
    if (!ZIP_RE.test(z)) {
      setError(`"${z}" isn't a 5-digit US ZIP.`);
      return;
    }
    if (zips.includes(z)) {
      setError(`${z} is already on the list.`);
      return;
    }
    if (zips.length >= MAX_ZIPS) {
      setError(`Up to ${MAX_ZIPS} ZIPs per check — each one is a separate lookup.`);
      return;
    }
    setError(null);
    setZips([...zips, z]);
    setZipInput('');
  };

  const onZipKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addZip(zipInput);
    } else if (e.key === 'Backspace' && zipInput === '' && zips.length > 0) {
      setZips(zips.slice(0, -1));
    }
  };

  const run = (force = false) => {
    const target = (fixedUrl ?? url).trim();
    if (!target) {
      setError('Paste a product URL first.');
      return;
    }
    // Allow a lone un-added ZIP still sitting in the input.
    const pending = zipInput.trim();
    const all = pending && ZIP_RE.test(pending) && !zips.includes(pending) ? [...zips, pending] : zips;
    if (all.length === 0) {
      setError('Add at least one ZIP code.');
      return;
    }
    setZips(all);
    setZipInput('');
    setError(null);
    check.mutate({ productUrl: target, zips: all, storeProductId, force });
  };

  const data = check.data;
  const rows: ZipCheckRow[] = data?.results ?? [];

  const sorted = [...rows].sort((a, b) => {
    // Unresolved rows always sink to the bottom — they aren't answers.
    if (a.locationResolved !== b.locationResolved) return a.locationResolved ? -1 : 1;
    if (sortKey === 'price') {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      return ap - bp;
    }
    if (sortKey === 'status') return a.status.localeCompare(b.status);
    return a.zip.localeCompare(b.zip);
  });

  const apiError =
    check.isError &&
    ((check.error as any)?.response?.data?.error ?? 'Check failed. Try again in a moment.');

  return (
    <div className={clsx('card', compact ? 'p-4' : 'p-5')}>
      <div className="mb-3">
        <h3 className="text-subhead font-semibold text-dark-label1">📍 Check other ZIP codes</h3>
        <p className="text-caption2 text-dark-label3 mt-0.5">
          Walmart, Target, Home Depot and Lowe's price per store — compare up to {MAX_ZIPS} locations.
        </p>
      </div>

      {showUrlInput && (
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Walmart / Target / Home Depot / Lowe's product URL"
          className="input w-full mb-2"
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {zips.map((z) => (
          <span
            key={z}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-apple bg-dark-surface2 text-caption1 text-dark-label1"
          >
            {z}
            <button
              type="button"
              onClick={() => setZips(zips.filter((x) => x !== z))}
              className="text-dark-label3 hover:text-apple-red"
              aria-label={`Remove ${z}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          inputMode="numeric"
          value={zipInput}
          onChange={(e) => setZipInput(e.target.value)}
          onKeyDown={onZipKeyDown}
          onBlur={() => zipInput && addZip(zipInput)}
          placeholder={zips.length === 0 ? 'Enter a ZIP and press Enter' : 'Add another…'}
          className="input flex-1 min-w-[10rem]"
          disabled={zips.length >= MAX_ZIPS}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={check.isPending}
          className="btn-primary px-4 py-2 text-subhead disabled:opacity-50"
        >
          {check.isPending ? 'Checking…' : 'Check prices'}
        </button>
        {data && (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={check.isPending}
            className="text-caption1 text-dark-label3 hover:text-apple-blue disabled:opacity-50"
            title="Ignore cached results and scrape fresh"
          >
            ↻ Refresh
          </button>
        )}
      </div>

      {(error || apiError) && (
        <p className="text-caption1 text-apple-red mt-2">{error ?? apiError}</p>
      )}

      {rows.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-caption2 text-dark-label3">
              {data?.storeSlug} · {rows.filter((r) => r.locationResolved).length} of {rows.length} resolved
            </p>
            <div className="flex items-center gap-1 text-caption2">
              <span className="text-dark-label3">Sort</span>
              {(['price', 'zip', 'status'] as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSortKey(k)}
                  className={clsx(
                    'px-1.5 py-0.5 rounded',
                    sortKey === k ? 'text-apple-blue font-semibold' : 'text-dark-label3 hover:text-dark-label1'
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {sorted.map((r) => {
              const isCheapest = data?.cheapestZip === r.zip && r.locationResolved;
              return (
                <div
                  key={r.zip}
                  className={clsx(
                    'flex items-center gap-3 p-2.5 rounded-apple bg-dark-surface2',
                    isCheapest && 'ring-1 ring-apple-green/40 bg-apple-green/5',
                    !r.locationResolved && 'opacity-60'
                  )}
                >
                  <div className="w-16 shrink-0">
                    <p className="text-subhead font-semibold text-dark-label1">{r.zip}</p>
                    {isCheapest && <p className="text-caption2 text-apple-green">cheapest</p>}
                  </div>

                  <div className="flex-1 min-w-0">
                    {r.locationResolved ? (
                      <>
                        <p className="text-caption1 text-dark-label2 truncate">
                          {r.storeName ?? `Store #${r.storeId ?? '?'}`}
                        </p>
                        <p className={clsx('text-caption2', statusClass(r.status))}>
                          {STATUS_LABEL[r.status] ?? r.status}
                          {r.pickupAvailable === true && ' · pickup available'}
                        </p>
                      </>
                    ) : (
                      <p className="text-caption1 text-dark-label3">
                        Couldn't find a store for this ZIP — no price shown rather than a wrong one.
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    {r.locationResolved && typeof r.price === 'number' ? (
                      <p className="text-subhead font-semibold text-dark-label1">${r.price.toFixed(2)}</p>
                    ) : (
                      <p className="text-caption1 text-dark-label3">—</p>
                    )}
                    {r.cached && <p className="text-caption2 text-dark-label3">cached</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {rows.some((r) => r.message && r.locationResolved) && (
            <p className="text-caption2 text-dark-label3 mt-2">
              {rows.find((r) => r.message && r.locationResolved)?.message}
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}
