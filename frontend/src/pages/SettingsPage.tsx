import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import toast from 'react-hot-toast';

interface NotifPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  discordEnabled: boolean;
  priceDropEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
  phone: string | null;
  discordWebhook: string | null;
  autoBuyEnabled: boolean;
  autoBuyMaxPrice: number | null;
}

// The VAPID PUBLIC key is safe to ship in client code (browsers receive it
// anyway). Hardcoded as a fallback so push works regardless of build-arg /
// GitHub-variable plumbing; a VITE_VAPID_PUBLIC_KEY env value still overrides
// it (e.g. for key rotation). Must match the backend's VAPID_PUBLIC_KEY.
const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BDcSMPCqyzWtuL__6mEqEZDj3kMktKkqtZDCqCvXPo6Vx38xqzPgXypR4qk1spu0d067c-hTuFh4FcdkSf0EOOM';

// Quiet-hours times are stored as minutes-from-midnight; the <input type="time">
// uses "HH:MM".
const minToTime = (m?: number | null): string =>
  m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMin = (t: string): number | null => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useThemeStore();

  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const [form, setForm] = useState<Partial<NotifPrefs>>({});
  const [dirty, setDirty] = useState(false);

  const { data: prefs, isLoading } = useQuery<NotifPrefs>({
    queryKey: ['notif-prefs'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/preferences');
      return data.data ?? data;
    },
  });

  useEffect(() => {
    if (prefs) setForm(prefs);
  }, [prefs]);

  // Check push subscription state
  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true);
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      });
    }
  }, []);

  const savePrefs = useMutation({
    mutationFn: async (data: Partial<NotifPrefs>) => {
      await api.put('/notifications/preferences', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-prefs'] });
      toast.success('Settings saved');
      setDirty(false);
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const handleChange = <K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  // Capture the browser's IANA timezone on every save so quiet-hours math uses
  // the user's actual local time.
  const handleSave = () =>
    savePrefs.mutate({ ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  const subscribePush = async () => {
    if (!VAPID_PUBLIC_KEY) {
      toast.error('Push notifications not configured (missing VAPID key)');
      return;
    }
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await api.post('/notifications/push/subscribe', sub.toJSON());
      setPushSubscribed(true);
      toast.success('Push notifications enabled!');
    } catch (err) {
      toast.error('Failed to enable push notifications');
    } finally {
      setPushLoading(false);
    }
  };

  const unsubscribePush = async () => {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
      toast.success('Push notifications disabled');
    } catch {
      toast.error('Failed to disable push notifications');
    } finally {
      setPushLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-5 bg-dark-surface2 rounded w-1/3 mb-4" />
            <div className="space-y-3">
              <div className="h-4 bg-dark-surface2 rounded w-full" />
              <div className="h-4 bg-dark-surface2 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="section-title">Settings</h1>
        <p className="section-subtitle">Manage your preferences and notifications</p>
      </div>

      <div className="space-y-4">
        {/* Account Info (read-only — name/email/password are managed by an admin) */}
        <motion.div className="card p-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="text-title2 font-bold text-dark-label1 mb-4">Account</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-apple-blue flex items-center justify-center text-xl font-bold text-white shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="text-subhead font-semibold text-dark-label1">{user?.name}</p>
              <p className="text-footnote text-dark-label2">{user?.email}</p>
              <p className="text-caption2 text-dark-label3 mt-0.5">
                {user?.role === 'ADMIN' ? '🛡 Admin' : '👤 User'} •{' '}
                {user?.trackingLimit === -1 ? 'Unlimited tracking' : `${user?.trackingCount ?? 0}/${user?.trackingLimit ?? 1} items tracked`}
              </p>
            </div>
          </div>
          <p className="text-caption2 text-dark-label3 mt-4">
            To change your name, email, or password, contact an administrator.
          </p>
        </motion.div>

        {/* Appearance */}
        <motion.div className="card p-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h2 className="text-title2 font-bold text-dark-label1 mb-4">Appearance</h2>
          <div className="flex gap-2">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 py-2.5 rounded-apple text-footnote font-semibold capitalize transition-all ${
                  theme === t
                    ? 'bg-apple-blue text-white'
                    : 'bg-dark-surface2 text-dark-label2 hover:text-dark-label1'
                }`}
              >
                {t === 'dark' ? '🌙 Dark' : t === 'light' ? '☀️ Light' : '⚙️ System'}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Notification Channels */}
        <motion.div className="card p-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-title2 font-bold text-dark-label1 mb-1">Notification Channels</h2>
          <p className="text-footnote text-dark-label2 mb-5">Choose how you want to be alerted when items come in stock</p>

          <div className="space-y-4">
            {/* Email */}
            <ToggleRow
              icon="📧"
              label="Email Alerts"
              description={`Send alerts to ${user?.email}`}
              checked={form.emailEnabled ?? false}
              onChange={(v) => handleChange('emailEnabled', v)}
            />

            {/* SMS */}
            <div>
              <ToggleRow
                icon="💬"
                label="SMS / Text"
                description="Receive text message alerts"
                checked={form.smsEnabled ?? false}
                onChange={(v) => handleChange('smsEnabled', v)}
              />
              {form.smsEnabled && (
                <div className="mt-3 ml-12">
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="+1 555 000 0000"
                    className="input text-sm"
                  />
                </div>
              )}
            </div>

            {/* Push */}
            <div>
              <ToggleRow
                icon="🔔"
                label="Push Notifications"
                description="Browser / mobile push alerts"
                checked={form.pushEnabled ?? false}
                onChange={(v) => handleChange('pushEnabled', v)}
              />
              {form.pushEnabled && pushSupported && (
                <div className="mt-3 ml-12">
                  <button
                    onClick={pushSubscribed ? unsubscribePush : subscribePush}
                    disabled={pushLoading}
                    className={`text-caption1 font-semibold px-4 py-2 rounded-apple transition-all ${
                      pushSubscribed
                        ? 'bg-apple-red/10 text-apple-red hover:bg-apple-red/20'
                        : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/20'
                    }`}
                  >
                    {pushLoading ? '…' : pushSubscribed ? 'Disable Push on This Device' : 'Enable Push on This Device'}
                  </button>
                </div>
              )}
              {form.pushEnabled && !pushSupported && (
                <p className="mt-2 ml-12 text-caption2 text-apple-orange">
                  Push notifications are not supported in this browser.
                </p>
              )}
            </div>

            {/* Discord */}
            <div>
              <ToggleRow
                icon="🎮"
                label="Discord Webhook"
                description="Post alerts to a Discord channel"
                checked={form.discordEnabled ?? false}
                onChange={(v) => handleChange('discordEnabled', v)}
              />
              {form.discordEnabled && (
                <div className="mt-3 ml-12">
                  <input
                    type="url"
                    value={form.discordWebhook ?? ''}
                    onChange={(e) => handleChange('discordWebhook', e.target.value)}
                    placeholder="https://discord.com/api/webhooks/…"
                    className="input text-sm"
                  />
                </div>
              )}
            </div>

            {/* Price drops */}
            <ToggleRow
              icon="💸"
              label="Price Drop Alerts"
              description="Get notified when a tracked item's price falls"
              checked={form.priceDropEnabled ?? false}
              onChange={(v) => handleChange('priceDropEnabled', v)}
            />
          </div>
        </motion.div>

        {/* Quiet Hours */}
        <motion.div className="card p-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <h2 className="text-title2 font-bold text-dark-label1 mb-1">Quiet Hours</h2>
          <p className="text-footnote text-dark-label2 mb-5">
            Pause email, SMS, push, and Discord alerts during these hours. You'll still see them in the app.
          </p>

          <ToggleRow
            icon="🌙"
            label="Enable Quiet Hours"
            description="Suppress notification pings during a nightly window"
            checked={form.quietHoursEnabled ?? false}
            onChange={(v) => handleChange('quietHoursEnabled', v)}
          />

          {form.quietHoursEnabled && (
            <div className="mt-4 flex items-center gap-4 flex-wrap ml-12">
              <label className="flex items-center gap-2 text-footnote text-dark-label2">
                From
                <input
                  type="time"
                  value={minToTime(form.quietHoursStart)}
                  onChange={(e) => handleChange('quietHoursStart', timeToMin(e.target.value))}
                  className="input text-sm w-auto"
                />
              </label>
              <label className="flex items-center gap-2 text-footnote text-dark-label2">
                to
                <input
                  type="time"
                  value={minToTime(form.quietHoursEnd)}
                  onChange={(e) => handleChange('quietHoursEnd', timeToMin(e.target.value))}
                  className="input text-sm w-auto"
                />
              </label>
              <span className="text-caption2 text-dark-label3">
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>
          )}
        </motion.div>

        {/* AutoBuy */}
        <motion.div className="card p-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="text-title2 font-bold text-dark-label1 mb-1">AutoBuy</h2>
          <p className="text-footnote text-dark-label2 mb-5">
            Automatically attempt to purchase tracked items when they come in stock.{' '}
            <span className="text-apple-orange">Use with caution.</span>
          </p>

          <ToggleRow
            icon="⚡"
            label="Enable AutoBuy"
            description="Attempt to auto-purchase when stock is detected"
            checked={form.autoBuyEnabled ?? false}
            onChange={(v) => handleChange('autoBuyEnabled', v)}
          />

          {form.autoBuyEnabled && (
            <div className="mt-4">
              <label className="block text-footnote font-semibold text-dark-label2 mb-2">
                Maximum Price (USD)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 font-semibold">$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.autoBuyMaxPrice ?? ''}
                  onChange={(e) => handleChange('autoBuyMaxPrice', e.target.value ? parseFloat(e.target.value) : null)}
                  placeholder="0.00 (no limit)"
                  className="input pl-8"
                />
              </div>
              <p className="text-caption2 text-dark-label3 mt-2">
                Leave blank to buy at any price. AutoBuy will not exceed this price.
              </p>
            </div>
          )}
        </motion.div>

        {/* Save */}
        {dirty && (
          <motion.div
            className="sticky bottom-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="card p-4 border-apple-blue/30 bg-dark-surface1/95 backdrop-blur flex items-center justify-between">
              <p className="text-footnote text-dark-label2">You have unsaved changes</p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setForm(prefs ?? {}); setDirty(false); }}
                  className="btn-ghost text-footnote"
                >
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={savePrefs.isPending}
                  className="btn-primary px-5 py-2 text-footnote"
                >
                  {savePrefs.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xl w-8 shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="text-subhead font-semibold text-dark-label1">{label}</p>
        <p className="text-caption1 text-dark-label2">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6.5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-apple-blue' : 'bg-dark-surface3'
        }`}
        style={{ height: '1.625rem' }}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5.5 h-5.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5.5' : 'translate-x-0'
          }`}
          style={{ width: '1.375rem', height: '1.375rem', transform: checked ? 'translateX(1.375rem)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}
