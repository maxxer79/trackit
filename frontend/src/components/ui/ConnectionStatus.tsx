import { useConnectionStore, type ConnectionStatus as Status } from '../../store/connection';
import { useAuthStore } from '../../store/auth';

const MAP: Record<Status, { dot: string; label: string; showLabel: boolean; pulse: boolean }> = {
  connected: { dot: 'bg-apple-green', label: 'Live', showLabel: false, pulse: false },
  reconnecting: { dot: 'bg-apple-orange', label: 'Connecting…', showLabel: true, pulse: true },
  disconnected: { dot: 'bg-dark-label3', label: 'Offline', showLabel: true, pulse: false },
};

// Compact realtime-connection indicator. A bare green dot when live (no clutter);
// an amber pulsing "Connecting…" or gray "Offline" when degraded.
export default function ConnectionStatus() {
  const user = useAuthStore((s) => s.user);
  const status = useConnectionStore((s) => s.status);

  if (!user) return null;
  const m = MAP[status];

  return (
    <div className="flex items-center gap-1.5" title={`Realtime updates: ${m.label}`} aria-live="polite">
      <span className={`inline-block w-2 h-2 rounded-full ${m.dot} ${m.pulse ? 'animate-pulse' : ''}`} />
      {m.showLabel && <span className="text-caption2 text-dark-label2 hidden sm:inline">{m.label}</span>}
    </div>
  );
}
