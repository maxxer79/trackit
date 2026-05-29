import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../../lib/api';
import { AdminStats } from '../../types';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { APP_VERSION, BUILD_DATE } from '../../version';

export default function AdminPage() {
  const scrapeAll = useMutation({
    mutationFn: () => api.post('/admin/scrape-all'),
    onSuccess: () => toast.success('Full stock check queued — running in background'),
    onError: () => toast.error('Failed to queue scrape'),
  });

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/stats');
      return data.data ?? data;
    },
    refetchInterval: 30_000,
  });

  const cards = stats
    ? [
        { label: 'Total Users', value: stats.totalUsers, icon: '👥', color: 'text-apple-blue', link: '/admin/users' },
        { label: 'Active Users', value: stats.activeUsers, icon: '✅', color: 'text-apple-green', link: '/admin/users' },
        { label: 'Total Products', value: stats.totalProducts, icon: '📦', color: 'text-white', link: '/admin/products' },
        { label: 'Alerts Today', value: stats.alertsToday, icon: '🔔', color: 'text-apple-orange', link: '/admin/logs' },
        { label: 'Scraper Errors', value: stats.scraperErrors, icon: '⚠️', color: 'text-apple-red', link: '/admin/logs' },
        { label: 'Total Alerts Sent', value: stats.totalAlerts, icon: '📨', color: 'text-white', link: '/admin/logs' },
      ]
    : [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Admin Dashboard</h1>
          <p className="section-subtitle">System overview and management</p>
        </div>
        <button
          onClick={() => scrapeAll.mutate()}
          disabled={scrapeAll.isPending}
          className="btn-secondary px-5 py-2.5 text-subhead flex items-center gap-2 hover:text-apple-green hover:border-apple-green/50"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={scrapeAll.isPending ? 'animate-spin' : ''}>
            <path d="M12 7A5 5 0 1 1 7 2"/><path d="M12 2v3h-3"/>
          </svg>
          {scrapeAll.isPending ? 'Queuing…' : 'Scrape All'}
        </button>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse">
              <div className="h-8 bg-dark-surface2 rounded w-1/2 mb-2" />
              <div className="h-4 bg-dark-surface2 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {cards.map(({ label, value, icon, color, link }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Link to={link} className="card p-6 block hover:bg-dark-surface2 transition-colors group">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{icon}</span>
                  <svg className="w-4 h-4 text-dark-label3 group-hover:text-white transition-colors" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className={`text-title1 font-bold ${color}`}>{value?.toLocaleString() ?? '—'}</p>
                <p className="text-caption1 text-dark-label2 mt-1">{label}</p>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {/* Quick links */}
      <h2 className="text-title2 font-bold text-white mb-4">Management</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { to: '/admin/users', icon: '👥', title: 'Users', desc: 'Manage accounts & limits' },
          { to: '/admin/products', icon: '📦', title: 'Products', desc: 'Add, edit, delete products' },
          { to: '/admin/logs', icon: '📋', title: 'Scraper Logs', desc: 'Monitor scraper health' },
          { to: '/browse', icon: '🛍', title: 'Browse', desc: 'View product catalog' },
        ].map(({ to, icon, title, desc }) => (
          <Link
            key={to}
            to={to}
            className="card p-5 hover:bg-dark-surface2 transition-colors group flex items-center gap-4"
          >
            <span className="text-3xl">{icon}</span>
            <div>
              <p className="text-subhead font-semibold text-white group-hover:text-apple-blue transition-colors">{title}</p>
              <p className="text-caption1 text-dark-label2">{desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      {stats?.recentAlerts && stats.recentAlerts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-title2 font-bold text-white mb-4">Recent Alerts</h2>
          <div className="card divide-y divide-dark-separator">
            {stats.recentAlerts.map((alert: any) => (
              <div key={alert.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-footnote font-semibold text-white">{alert.productName}</p>
                  <p className="text-caption2 text-dark-label2">{alert.storeName} — {alert.userEmail}</p>
                </div>
                <span className="text-caption2 text-dark-label3">
                  {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Version footer */}
      <div className="mt-10 pt-6 border-t border-dark-separator flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-caption2 font-mono px-2 py-0.5 rounded bg-dark-surface2 text-apple-blue border border-apple-blue/20">
            v{APP_VERSION}
          </span>
          <span className="text-caption2 text-dark-label3">TrackIt Admin</span>
        </div>
        <span className="text-caption2 text-dark-label3">Built {BUILD_DATE}</span>
      </div>
    </div>
  );
}
