import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';

interface ScraperLog {
  id: string;
  storeSlug: string;
  productSlug: string | null;
  status: string; // "success" | "error" | "blocked"
  message: string | null;
  duration: number | null;
  createdAt: string;
}

interface LogsResponse {
  data: ScraperLog[];
  total: number;
  totalPages: number;
}

type HealthLabel = 'healthy' | 'degraded' | 'down' | 'no_data';

interface ScraperHealthRow {
  storeSlug: string;
  storeName: string;
  total: number;
  success: number;
  successRate: number | null;
  avgDurationMs: number | null;
  lastSuccessAt: string | null;
  health: HealthLabel;
}

interface ScraperHealthResponse {
  windowHours: number;
  generatedAt: string;
  stores: ScraperHealthRow[];
}

const HEALTH_COLORS: Record<HealthLabel, string> = {
  healthy: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  degraded: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20',
  down: 'text-apple-red bg-apple-red/10 border-apple-red/20',
  no_data: 'text-dark-label2 bg-dark-surface2 border-dark-separator',
};

const STATUS_COLORS: Record<string, string> = {
  success: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  IN_STOCK: 'text-apple-green bg-apple-green/10 border-apple-green/20',
  error: 'text-apple-red bg-apple-red/10 border-apple-red/20',
  ERROR: 'text-apple-red bg-apple-red/10 border-apple-red/20',
  blocked: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20',
  OUT_OF_STOCK: 'text-dark-label2 bg-dark-surface2 border-dark-separator',
  UNKNOWN: 'text-apple-orange bg-apple-orange/10 border-apple-orange/20',
  skipped: 'text-dark-label2 bg-dark-surface2 border-dark-separator',
};

export default function AdminLogs() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Restock-screenshot pipeline diagnostic
  const [ssUrl, setSsUrl] = useState('');
  const [ssBusy, setSsBusy] = useState(false);
  const [ssResult, setSsResult] = useState<any>(null);

  const runScreenshotTest = async () => {
    setSsBusy(true);
    setSsResult(null);
    try {
      const { data } = await api.post('/admin/test-screenshot', { url: ssUrl || undefined });
      setSsResult(data);
    } catch (err: any) {
      setSsResult({ ok: false, reason: err?.response?.data?.error || err?.message || 'Request failed' });
    } finally {
      setSsBusy(false);
    }
  };

  const { data, isLoading } = useQuery<LogsResponse>({
    queryKey: ['admin-logs', page, statusFilter, search],
    queryFn: async () => {
      const { data } = await api.get('/admin/logs', {
        params: { page, limit: 30, status: statusFilter || undefined, search: search || undefined },
      });
      return data;
    },
    refetchInterval: 15_000,
  });

  const { data: health } = useQuery<ScraperHealthResponse>({
    queryKey: ['scraper-health'],
    queryFn: async () => {
      const { data } = await api.get('/admin/scrapers/health', { params: { hours: 24 } });
      return data;
    },
    refetchInterval: 60_000,
  });

  const successCount = data?.data.filter((l) => l.status === 'success').length ?? 0;
  const errorCount = data?.data.filter((l) => l.status === 'error' || l.status === 'blocked').length ?? 0;
  const avgDuration = data?.data
    .filter((l) => l.duration != null)
    .reduce((sum, l, _, arr) => sum + (l.duration! / arr.length), 0);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Scraper Logs</h1>
          <p className="section-subtitle">
            {data?.total?.toLocaleString() ?? 0} entries • auto-refreshes every 15s
          </p>
        </div>
      </div>

      {/* Restock screenshot pipeline test */}
      <div className="card p-4 mb-6">
        <h2 className="text-headline font-semibold text-dark-label1 mb-1">Restock screenshot test</h2>
        <p className="text-caption1 text-dark-label2 mb-3">
          Verify the proof-screenshot pipeline (env flag, volume writability, Chromium capture) without waiting for a real restock.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={ssUrl}
            onChange={(e) => setSsUrl(e.target.value)}
            placeholder="Product URL to capture (default: example.com)"
            className="input flex-1 min-w-[220px] text-sm"
          />
          <button onClick={runScreenshotTest} disabled={ssBusy} className="btn-primary px-5 py-2.5 text-subhead disabled:opacity-40">
            {ssBusy ? 'Capturing…' : 'Run test'}
          </button>
        </div>
        {ssResult && (
          <div className={clsx('mt-3 text-footnote rounded-apple p-3', ssResult.ok ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red')}>
            {ssResult.ok ? (
              <div className="space-y-1">
                <p className="font-semibold">✓ Screenshot captured successfully</p>
                <p className="text-dark-label2">Saved to {ssResult.dir}</p>
                <a href={`${import.meta.env.VITE_API_URL || '/api'}${ssResult.url}`} target="_blank" rel="noopener noreferrer" className="text-apple-blue hover:underline">
                  View captured image ↗
                </a>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">✗ {ssResult.reason || 'Failed'}</p>
                {ssResult.dir && <p className="text-dark-label2">dir: {ssResult.dir} · writable: {String(ssResult.writable)} · enabled: {String(ssResult.enabled)}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-retailer health — rolling window from logged scrape attempts */}
      {health && health.stores.length > 0 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-headline font-semibold text-dark-label1">
              Scraper health · last {health.windowHours}h
            </h2>
            <span className="text-caption2 text-dark-label3">
              advisory — scrapers are never auto-disabled
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-footnote">
              <thead>
                <tr className="text-caption2 text-dark-label3 text-left">
                  <th className="py-1.5 pr-3 font-medium">Store</th>
                  <th className="py-1.5 px-3 font-medium">Health</th>
                  <th className="py-1.5 px-3 font-medium text-right">Success</th>
                  <th className="py-1.5 px-3 font-medium text-right">Checks</th>
                  <th className="py-1.5 px-3 font-medium text-right">Avg</th>
                  <th className="py-1.5 pl-3 font-medium text-right">Last success</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-separator">
                {health.stores.map((s) => (
                  <tr key={s.storeSlug}>
                    <td className="py-2 pr-3 text-dark-label1 font-medium">{s.storeName}</td>
                    <td className="py-2 px-3">
                      <span className={clsx(
                        'text-caption2 font-bold px-2 py-0.5 rounded-pill border uppercase',
                        HEALTH_COLORS[s.health]
                      )}>
                        {s.health.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {s.successRate != null ? `${Math.round(s.successRate * 100)}%` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-dark-label2">{s.total}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-dark-label2">
                      {s.avgDurationMs != null ? `${s.avgDurationMs}ms` : '—'}
                    </td>
                    <td className="py-2 pl-3 text-right text-dark-label2">
                      {s.lastSuccessAt
                        ? formatDistanceToNow(new Date(s.lastSuccessAt), { addSuffix: true })
                        : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Success (page)', value: successCount, color: 'text-apple-green' },
            { label: 'Errors (page)', value: errorCount, color: 'text-apple-red' },
            { label: 'Avg Duration', value: avgDuration ? `${Math.round(avgDuration)}ms` : '—', color: 'text-dark-label1' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4 text-center">
              <p className={`text-title2 font-bold ${color}`}>{value}</p>
              <p className="text-caption1 text-dark-label2 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-10 text-sm"
            placeholder="Search product or store slug…"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['', 'success', 'error', 'blocked'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={clsx(
                'px-4 py-2 rounded-pill text-footnote font-semibold capitalize transition-all',
                statusFilter === s
                  ? s === 'success'
                    ? 'bg-apple-green text-black'
                    : s === 'error'
                    ? 'bg-apple-red text-white'
                    : s === 'blocked'
                    ? 'bg-apple-orange text-black'
                    : 'bg-apple-blue text-white'
                  : 'bg-dark-surface2 text-dark-label2 border border-dark-separator hover:bg-dark-surface3 hover:text-dark-label1'
              )}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Logs */}
      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="card p-3.5 animate-pulse flex gap-3">
              <div className="w-16 h-5 bg-dark-surface2 rounded-pill" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-dark-surface2 rounded w-1/2" />
                <div className="h-3 bg-dark-surface2 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-dark-separator">
          {data?.data.map((log, i) => (
            <motion.div
              key={log.id}
              className={clsx(
                'flex items-start gap-3 px-5 py-3.5',
                log.status === 'error' && 'bg-apple-red/3'
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.01 }}
            >
              {/* Status badge */}
              <span className={clsx(
                'text-caption2 font-bold px-2.5 py-1 rounded-pill border shrink-0 mt-0.5 uppercase',
                STATUS_COLORS[log.status] ?? STATUS_COLORS.skipped
              )}>
                {log.status}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-footnote font-semibold text-dark-label1">
                    {log.productSlug ?? '(unknown product)'}
                  </p>
                  <span className="text-caption2 text-dark-label3">@</span>
                  <p className="text-footnote text-dark-label2">{log.storeSlug}</p>
                </div>
                {log.message && (
                  <p className={clsx(
                    'text-caption2 mt-1 break-words line-clamp-2',
                    log.status === 'error' ? 'text-apple-red' : 'text-dark-label2'
                  )}>
                    {log.message}
                  </p>
                )}
              </div>

              {/* Meta */}
              <div className="text-right shrink-0">
                {log.duration != null && (
                  <p className={clsx(
                    'text-caption2 font-semibold',
                    log.duration > 5000 ? 'text-apple-red' : log.duration > 2000 ? 'text-apple-orange' : 'text-apple-green'
                  )}>
                    {log.duration}ms
                  </p>
                )}
                <p
                  className="text-caption2 text-dark-label3 mt-0.5"
                  title={format(new Date(log.createdAt), 'PPpp')}
                >
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </p>
              </div>
            </motion.div>
          ))}
          {data?.data.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-subhead text-dark-label2">No logs found</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-4 py-2 disabled:opacity-30">← Prev</button>
          <span className="text-footnote text-dark-label2">Page {page} of {data.totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="btn-secondary px-4 py-2 disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  );
}
