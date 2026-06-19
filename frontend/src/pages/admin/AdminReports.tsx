import { useState } from 'react';
import { format } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  useAdminScraperReports,
  useUpdateScraperReport,
  ScraperReport,
  ISSUE_TYPES,
  REPORT_STATUSES,
  REPORT_STATUS_LABEL,
} from '../../hooks/useScraperReports';

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'text-apple-orange',
  REVIEWING: 'text-apple-blue',
  RESOLVED: 'text-apple-green',
  DISMISSED: 'text-dark-label3',
};

const issueLabel = (id: string) => ISSUE_TYPES.find((t) => t.id === id)?.label ?? id;

function ReportCard({ report }: { report: ScraperReport }) {
  const update = useUpdateScraperReport();
  const [note, setNote] = useState(report.adminNote ?? '');

  const patch = (body: { status?: string; adminNote?: string | null }) =>
    update.mutate({ id: report.id, ...body }, { onError: () => toast.error('Update failed') });

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-subhead font-semibold text-dark-label1">
            {issueLabel(report.issueType)}
            {report.storeName && <span className="text-dark-label2"> · {report.storeName}</span>}
          </p>
          <p className="text-caption2 text-dark-label3 mt-0.5">
            {report.productName || 'Unknown product'}
            {' · '}reported by {report.user?.name || report.user?.email || 'a user'} ·{' '}
            {format(new Date(report.createdAt), 'MMM d, yyyy')}
          </p>
        </div>
        <span className={clsx('text-caption2 font-semibold shrink-0', STATUS_COLOR[report.status])}>
          {REPORT_STATUS_LABEL[report.status]}
        </span>
      </div>

      <p className="text-footnote text-dark-label1 mt-2 whitespace-pre-wrap">{report.description}</p>

      {report.suggestedSelector && (
        <p className="text-caption1 text-dark-label2 mt-2">
          Suggested selector: <code className="font-mono text-apple-blue">{report.suggestedSelector}</code>
        </p>
      )}
      {report.productUrl && (
        <a href={report.productUrl} target="_blank" rel="noopener noreferrer" className="text-caption2 text-apple-blue hover:underline mt-1 block truncate">
          {report.productUrl}
        </a>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <select
          value={report.status}
          onChange={(e) => patch({ status: e.target.value })}
          className={clsx('input text-caption1 py-1 w-32 font-semibold', STATUS_COLOR[report.status])}
        >
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>{REPORT_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (report.adminNote ?? '')) patch({ adminNote: note || null }); }}
          placeholder="Admin note (optional)"
          className="input text-caption1 py-1 flex-1 min-w-[160px]"
        />
      </div>
    </div>
  );
}

export default function AdminReports() {
  const [status, setStatus] = useState<string>('OPEN');
  const { data, isLoading } = useAdminScraperReports(status === 'ALL' ? undefined : status);
  const counts = data?.counts ?? {};

  const tabs = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED', 'ALL'];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="section-title">Scraper Reports</h1>
        <p className="section-subtitle">User-submitted problems — review and triage. Nothing is applied automatically.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setStatus(t)}
            className={clsx('text-caption1 px-3 py-1.5 rounded-pill border transition-colors',
              status === t ? 'border-apple-blue text-apple-blue bg-apple-blue/10' : 'border-dark-separator text-dark-label2 hover:text-dark-label1')}
          >
            {t === 'ALL' ? 'All' : REPORT_STATUS_LABEL[t]}
            {t !== 'ALL' && counts[t] ? ` (${counts[t]})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-subhead text-dark-label3">Loading…</p>
      ) : !data || data.reports.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-subhead text-dark-label2">No reports here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
