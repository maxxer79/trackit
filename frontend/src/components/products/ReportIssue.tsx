import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth';
import { useCreateScraperReport, ISSUE_TYPES } from '../../hooks/useScraperReports';

interface Props {
  productId: string;
  productName: string;
  stores: { storeSlug?: string; storeName?: string }[];
}

export default function ReportIssue({ productId, productName, stores }: Props) {
  const user = useAuthStore((s) => s.user);
  const create = useCreateScraperReport();
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState('WRONG_STOCK');
  const [storeName, setStoreName] = useState('');
  const [description, setDescription] = useState('');
  const [selector, setSelector] = useState('');

  if (!user) return null; // only signed-in users can report

  const submit = () => {
    if (description.trim().length < 5) {
      toast.error('Please describe the problem (a few words).');
      return;
    }
    const store = stores.find((s) => s.storeName === storeName);
    create.mutate(
      {
        productId,
        productName,
        storeName: storeName || null,
        storeSlug: store?.storeSlug || null,
        issueType,
        description: description.trim(),
        suggestedSelector: selector.trim() || null,
      },
      {
        onSuccess: (d) => {
          toast.success(d.message || 'Report sent');
          setOpen(false);
          setDescription('');
          setSelector('');
        },
        onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not send report'),
      }
    );
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-caption1 text-dark-label3 hover:text-apple-orange transition-colors mb-6"
      >
        ⚠ Report a problem with this product’s tracking
      </button>
    );
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-subhead font-semibold text-dark-label1">Report a tracking problem</h3>
        <button onClick={() => setOpen(false)} className="text-caption1 text-dark-label3 hover:text-dark-label1">Cancel</button>
      </div>

      <label className="block text-caption2 text-dark-label3 mb-1">What’s wrong?</label>
      <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className="input mb-3 w-full text-sm">
        {ISSUE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      {stores.length > 0 && (
        <>
          <label className="block text-caption2 text-dark-label3 mb-1">Which store? (optional)</label>
          <select value={storeName} onChange={(e) => setStoreName(e.target.value)} className="input mb-3 w-full text-sm">
            <option value="">Any / not sure</option>
            {stores.map((s) => (
              <option key={s.storeSlug ?? s.storeName} value={s.storeName}>{s.storeName}</option>
            ))}
          </select>
        </>
      )}

      <label className="block text-caption2 text-dark-label3 mb-1">Details</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g. shows Out of Stock but it’s actually available, or price hasn’t updated in days."
        className="input w-full text-sm resize-none mb-3"
      />

      <label className="block text-caption2 text-dark-label3 mb-1">
        Suggested fix / CSS selector (optional, for the technical)
      </label>
      <input
        value={selector}
        onChange={(e) => setSelector(e.target.value)}
        placeholder="e.g. .add-to-cart-button[disabled]"
        className="input w-full text-sm mb-3 font-mono"
      />

      <button onClick={submit} disabled={create.isPending} className="btn-primary px-5 py-2.5 text-subhead disabled:opacity-40">
        {create.isPending ? 'Sending…' : 'Send report'}
      </button>
      <p className="text-caption2 text-dark-label3 mt-2">
        Reports go to the admins for review — nothing changes automatically.
      </p>
    </div>
  );
}
