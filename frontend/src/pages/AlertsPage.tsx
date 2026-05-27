import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import { Alert, StockStatus } from '../types';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function AlertsPage() {
  const qc = useQueryClient();

  const { data: alerts, isLoading } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/alerts');
      return data.data ?? data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (alertIds?: string[]) => {
      await api.post('/notifications/alerts/read', alertIds ? { alertIds } : {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const unreadCount = alerts?.filter((a) => !a.isRead).length ?? 0;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Alerts</h1>
          <p className="section-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markRead.mutate(undefined)}
            className="btn-ghost text-subhead"
          >
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-apple bg-dark-surface2" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-dark-surface2 rounded w-3/4" />
                  <div className="h-3 bg-dark-surface2 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !alerts || alerts.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-5xl mb-4">🔔</p>
          <h2 className="text-title1 font-bold text-white mb-2">No alerts yet</h2>
          <p className="text-subhead text-dark-label2 mb-6">
            Start tracking products and you'll be notified here when they come in stock.
          </p>
          <Link to="/browse" className="btn-primary">Browse Products</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <motion.div
              key={alert.id}
              className={clsx(
                'card p-4 transition-colors',
                !alert.isRead && 'border-apple-blue/30 bg-apple-blue/5'
              )}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => !alert.isRead && markRead.mutate([alert.id])}
            >
              <div className="flex items-start gap-3">
                {/* Unread dot */}
                <div className="mt-1.5 shrink-0">
                  {!alert.isRead ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-apple-blue" />
                  ) : (
                    <div className="w-2.5 h-2.5 rounded-full bg-transparent" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to={`/product/${alert.productSlug}`}
                        className="text-subhead font-semibold text-white hover:text-apple-blue transition-colors line-clamp-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {alert.productName}
                      </Link>
                      <p className="text-footnote text-dark-label2 mt-0.5">
                        Available at <strong className="text-white">{alert.storeName}</strong>
                        {alert.price && <span className="text-apple-blue"> — ${alert.price.toFixed(2)}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <StatusBadge status={alert.status as StockStatus} size="sm" />
                      <span className="text-caption2 text-dark-label3">
                        {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {/* Notification channels */}
                  <div className="flex items-center gap-2 mt-2">
                    {alert.emailSent   && <span className="text-caption2 text-dark-label2">📧 Email</span>}
                    {alert.smsSent     && <span className="text-caption2 text-dark-label2">💬 SMS</span>}
                    {alert.pushSent    && <span className="text-caption2 text-dark-label2">🔔 Push</span>}
                    {alert.discordSent && <span className="text-caption2 text-dark-label2">🎮 Discord</span>}
                  </div>
                </div>

                <a
                  href={alert.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary px-3 py-1.5 text-caption1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  Shop
                </a>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
