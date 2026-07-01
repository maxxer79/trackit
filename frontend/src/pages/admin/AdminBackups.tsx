import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api from '../../lib/api';

interface BackupInfo {
  name: string;
  kind: 'auto' | 'manual' | 'pre-import';
  createdAt: string;
  size: number;
}
interface BackupStatus {
  last: BackupInfo | null;
  count: number;
  totalSize: number;
  retention: number;
  schedule: string;
  dir: string;
  backups: BackupInfo[];
}

type Phase = 'idle' | 'running' | 'success' | 'error';

const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  auto: 'Scheduled',
  manual: 'Manual',
  'pre-import': 'Pre-import snapshot',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function StatusLight({ phase }: { phase: Phase }) {
  const map: Record<Phase, { color: string; label: string; pulse?: boolean }> = {
    idle: { color: 'bg-dark-label3', label: 'Idle' },
    running: { color: 'bg-apple-orange', label: 'Working…', pulse: true },
    success: { color: 'bg-apple-green', label: 'Up to date' },
    error: { color: 'bg-apple-red', label: 'Failed' },
  };
  const s = map[phase];
  return (
    <span className="flex items-center gap-2">
      <span className={clsx('inline-block w-3 h-3 rounded-full', s.color, s.pulse && 'animate-pulse')} />
      <span className="text-caption1 text-dark-label2">{s.label}</span>
    </span>
  );
}

export default function AdminBackups() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmText, setConfirmText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<BackupStatus>({
    queryKey: ['admin-backups'],
    queryFn: async () => (await api.get('/admin/backups/status')).data,
    refetchInterval: 20_000,
  });

  const backupNow = useMutation({
    mutationFn: async () => (await api.post('/admin/backups/run')).data,
    onMutate: () => setPhase('running'),
    onSuccess: (res) => {
      setPhase('success');
      toast.success(`Backup complete (${formatBytes(res?.backup?.size ?? 0)})`);
      qc.invalidateQueries({ queryKey: ['admin-backups'] });
    },
    onError: (e: any) => {
      setPhase('error');
      toast.error(e?.response?.data?.detail || 'Backup failed');
    },
  });

  const download = async (name?: string) => {
    try {
      const res = await api.get('/admin/backups/export', {
        params: name ? { name } : {},
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'trackit-backup.dump';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  };

  const importMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('no file');
      return (
        await api.post('/admin/backups/import', file, {
          params: { confirm: 'CONFIRM', filename: file.name },
          headers: { 'Content-Type': 'application/octet-stream' },
          timeout: 0,
        })
      ).data;
    },
    onMutate: () => setPhase('running'),
    onSuccess: () => {
      setPhase('success');
      toast.success('Database restored. Reloading…');
      setConfirmText('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['admin-backups'] });
      // A restore changes the underlying data — reload so the app reflects it.
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (e: any) => {
      setPhase('error');
      toast.error(e?.response?.data?.detail || 'Import failed (a safety snapshot was taken)');
    },
  });

  const last = data?.last ?? null;
  const canImport = confirmText === 'CONFIRM' && !!file && !importMut.isPending;
  const displayPhase: Phase =
    phase === 'idle' && last ? 'success' : phase;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="section-title">Database Backups</h1>
          <p className="section-subtitle">Back up, export, and restore the TrackIt database</p>
        </div>
        <StatusLight phase={displayPhase} />
      </div>

      {/* Status card */}
      <div className="card p-6 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-caption2 text-dark-label3 mb-1">Last backup</p>
            <p className="text-subhead font-semibold text-dark-label1">
              {last ? formatDistanceToNow(new Date(last.createdAt), { addSuffix: true }) : '—'}
            </p>
            {last && (
              <p className="text-caption2 text-dark-label3 mt-0.5">
                {format(new Date(last.createdAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
          </div>
          <div>
            <p className="text-caption2 text-dark-label3 mb-1">Last size</p>
            <p className="text-subhead font-semibold text-dark-label1">{last ? formatBytes(last.size) : '—'}</p>
          </div>
          <div>
            <p className="text-caption2 text-dark-label3 mb-1">Stored backups</p>
            <p className="text-subhead font-semibold text-dark-label1">
              {isLoading ? '…' : `${data?.count ?? 0} (${formatBytes(data?.totalSize ?? 0)})`}
            </p>
          </div>
          <div>
            <p className="text-caption2 text-dark-label3 mb-1">Schedule</p>
            <p className="text-subhead font-semibold text-dark-label1">Nightly · keep {data?.retention ?? 30}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-6">
          <button
            onClick={() => backupNow.mutate()}
            disabled={backupNow.isPending}
            className="btn-primary px-5 py-2.5 text-subhead flex items-center gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={backupNow.isPending ? 'animate-spin' : ''}>
              <path d="M13 7.5A5.5 5.5 0 1 1 7.5 2" /><path d="M13 2v3.5H9.5" />
            </svg>
            {backupNow.isPending ? 'Backing up…' : 'Back up now'}
          </button>
          <button
            onClick={() => download()}
            disabled={!last}
            className="btn-secondary px-5 py-2.5 text-subhead flex items-center gap-2"
          >
            ⬇ Export latest
          </button>
        </div>
      </div>

      {/* Import (destructive) */}
      <div className="card p-6 mb-6 border border-apple-red/30">
        <h2 className="text-title2 font-bold text-dark-label1 mb-1">Import / Restore</h2>
        <p className="text-footnote text-dark-label2 mb-4">
          Restoring <strong className="text-apple-red">overwrites the entire live database</strong>. A safety
          snapshot is taken automatically first, so a bad import can be rolled back. Accepts a{' '}
          <code className="font-mono text-apple-blue">.dump</code> or{' '}
          <code className="font-mono text-apple-blue">.sql</code> file.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".dump,.sql"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-footnote text-dark-label2 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-dark-surface2 file:text-dark-label1 file:text-caption1"
          />
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type CONFIRM"
            className="input text-caption1 py-1.5 w-40"
          />
          <button
            onClick={() => importMut.mutate()}
            disabled={!canImport}
            className={clsx(
              'px-5 py-2.5 text-subhead rounded-xl font-semibold transition-colors',
              canImport ? 'bg-apple-red text-white hover:bg-apple-red/90' : 'bg-dark-surface2 text-dark-label3 cursor-not-allowed'
            )}
          >
            {importMut.isPending ? 'Restoring…' : 'Import & Restore'}
          </button>
        </div>
        {file && (
          <p className="text-caption2 text-dark-label3 mt-2">
            Selected: {file.name} ({formatBytes(file.size)})
          </p>
        )}
      </div>

      {/* Backup list */}
      <h2 className="text-title2 font-bold text-dark-label1 mb-3">Stored backups</h2>
      <div className="card divide-y divide-dark-separator">
        {isLoading ? (
          <div className="p-6 text-center text-dark-label3 text-footnote">Loading…</div>
        ) : (data?.backups?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-dark-label3 text-footnote">
            No backups yet — press “Back up now”.
          </div>
        ) : (
          data!.backups.map((b) => (
            <div key={b.name} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-footnote font-medium text-dark-label1 truncate">
                  {format(new Date(b.createdAt), 'MMM d, yyyy h:mm a')}
                  <span
                    className={clsx(
                      'ml-2 text-caption2 px-1.5 py-0.5 rounded',
                      b.kind === 'pre-import' ? 'bg-apple-orange/15 text-apple-orange' : 'bg-apple-blue/15 text-apple-blue'
                    )}
                  >
                    {KIND_LABEL[b.kind]}
                  </span>
                </p>
                <p className="text-caption2 text-dark-label3 truncate mt-0.5">
                  {b.name} · {formatBytes(b.size)}
                </p>
              </div>
              <button
                onClick={() => download(b.name)}
                className="btn-secondary px-3 py-1.5 text-caption1 shrink-0"
              >
                Export
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
