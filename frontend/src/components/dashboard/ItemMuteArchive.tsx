import { useState } from 'react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { useUpdateTracking } from '../../hooks/useProducts';

const FOREVER = '2999-01-01T00:00:00.000Z';

interface Props {
  productId: string;
  mutedUntil?: string | null;
  archived?: boolean;
}

export default function ItemMuteArchive({ productId, mutedUntil, archived }: Props) {
  const update = useUpdateTracking();
  const [open, setOpen] = useState(false);

  const muted = !!mutedUntil && new Date(mutedUntil) > new Date();
  const indefinite = mutedUntil === FOREVER;

  const mute = (ms: number | 'forever') => {
    const until = ms === 'forever' ? FOREVER : new Date(Date.now() + ms).toISOString();
    update.mutate({ productId, mutedUntil: until }, { onSuccess: () => toast.success('Alerts muted (still tracking)') });
    setOpen(false);
  };
  const unmute = () => update.mutate({ productId, mutedUntil: null }, { onSuccess: () => toast.success('Alerts unmuted') });

  const archive = () =>
    update.mutate({ productId, archivedAt: new Date().toISOString() }, { onSuccess: () => toast.success('Archived') });
  const restore = () =>
    update.mutate({ productId, archivedAt: null }, { onSuccess: () => toast.success('Restored') });

  if (archived) {
    return (
      <button onClick={restore} className="btn-secondary px-3 py-1.5 text-caption1">
        Restore
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-3 text-caption2">
      {muted ? (
        <span className="text-apple-orange">
          🔕 Muted {indefinite ? 'indefinitely' : `${formatDistanceToNow(new Date(mutedUntil!), { addSuffix: true })}`}
          <button onClick={unmute} className="ml-1.5 text-apple-blue hover:underline">unmute</button>
        </span>
      ) : (
        <div className="relative">
          <button onClick={() => setOpen(!open)} className="text-dark-label3 hover:text-apple-orange">
            🔕 Mute
          </button>
          {open && (
            <div className="absolute z-10 mt-1 bg-dark-surface3 border border-dark-separator rounded-apple p-1 shadow-apple-dark whitespace-nowrap">
              {[
                { label: '1 day', ms: 86_400_000 },
                { label: '1 week', ms: 7 * 86_400_000 },
                { label: 'Until I unmute', ms: 'forever' as const },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => mute(o.ms)}
                  className="block w-full text-left px-3 py-1.5 text-caption1 text-dark-label1 hover:bg-dark-surface2 rounded"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={archive} className="text-dark-label3 hover:text-dark-label1" title="Hide from dashboard (restorable)">
        📦 Archive
      </button>
    </div>
  );
}
