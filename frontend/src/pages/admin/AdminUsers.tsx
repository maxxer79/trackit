import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { AdminUser } from '../../types';
import Modal from '../../components/ui/Modal';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

export default function AdminUsers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({ role: '', trackingLimit: '', isActive: true });

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin-users', search],
    queryFn: async () => {
      const { data } = await api.get('/admin/users', { params: { search } });
      return data.data ?? data;
    },
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; role?: string; trackingLimit?: number; isActive?: boolean }) => {
      await api.patch(`/admin/users/${id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('User updated');
      setEditUser(null);
    },
    onError: () => toast.error('Failed to update user'),
  });

  const openEdit = (user: AdminUser) => {
    setEditUser(user);
    setEditForm({
      role: user.role,
      trackingLimit: user.trackingLimit === -1 ? '-1' : String(user.trackingLimit),
      isActive: user.isActive,
    });
  };

  const handleSave = () => {
    if (!editUser) return;
    updateUser.mutate({
      id: editUser.id,
      role: editForm.role as 'USER' | 'ADMIN',
      trackingLimit: parseInt(editForm.trackingLimit, 10),
      isActive: editForm.isActive,
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Users</h1>
          <p className="section-subtitle">{users?.length ?? 0} accounts</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-11"
          placeholder="Search by name or email…"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse flex gap-3">
              <div className="w-10 h-10 rounded-full bg-dark-surface2 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-dark-surface2 rounded w-1/3" />
                <div className="h-3 bg-dark-surface2 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-dark-separator">
          {users?.map((user, i) => (
            <motion.div
              key={user.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-dark-surface2 transition-colors"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
            >
              {/* Avatar */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0 ${
                user.role === 'ADMIN' ? 'bg-apple-orange' : 'bg-apple-blue'
              }`}>
                {user.name?.[0]?.toUpperCase() ?? '?'}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-subhead font-semibold text-white truncate">{user.name}</p>
                  {user.role === 'ADMIN' && (
                    <span className="text-caption2 px-2 py-0.5 rounded-pill bg-apple-orange/15 text-apple-orange font-semibold">Admin</span>
                  )}
                  {!user.isActive && (
                    <span className="text-caption2 px-2 py-0.5 rounded-pill bg-apple-red/15 text-apple-red font-semibold">Suspended</span>
                  )}
                </div>
                <p className="text-caption1 text-dark-label2 truncate">{user.email}</p>
              </div>

              {/* Tracking */}
              <div className="hidden sm:block text-right shrink-0">
                <p className="text-footnote font-semibold text-white">
                  {user.trackingLimit === -1 ? '∞' : `${user.trackingCount}/${user.trackingLimit}`}
                </p>
                <p className="text-caption2 text-dark-label3">tracking</p>
              </div>

              {/* Last seen */}
              <div className="hidden md:block text-right shrink-0">
                <p className="text-caption2 text-dark-label3">
                  {user.lastLoginAt
                    ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                    : 'Never'}
                </p>
              </div>

              {/* Edit */}
              <button
                onClick={() => openEdit(user)}
                className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-blue hover:bg-apple-blue/10 shrink-0"
                title="Edit user"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/>
                </svg>
              </button>
            </motion.div>
          ))}
          {users?.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">👥</p>
              <p className="text-subhead text-dark-label2">No users found</p>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`Edit: ${editUser?.name}`}>
        <div className="space-y-5">
          {/* Role */}
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Role</label>
            <div className="flex gap-2">
              {['USER', 'ADMIN'].map((r) => (
                <button
                  key={r}
                  onClick={() => setEditForm((f) => ({ ...f, role: r }))}
                  className={`flex-1 py-2.5 rounded-apple text-footnote font-semibold transition-all ${
                    editForm.role === r
                      ? 'bg-apple-blue text-white'
                      : 'bg-dark-surface2 text-dark-label2 hover:text-white'
                  }`}
                >
                  {r === 'ADMIN' ? '🛡 Admin' : '👤 User'}
                </button>
              ))}
            </div>
          </div>

          {/* Tracking Limit */}
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">
              Tracking Limit <span className="text-dark-label3 font-normal">(−1 = unlimited)</span>
            </label>
            <input
              type="number"
              min={-1}
              value={editForm.trackingLimit}
              onChange={(e) => setEditForm((f) => ({ ...f, trackingLimit: e.target.value }))}
              className="input"
              placeholder="-1 for unlimited"
            />
            <div className="flex gap-2 mt-2">
              {[1, 5, 10, 25, -1].map((v) => (
                <button
                  key={v}
                  onClick={() => setEditForm((f) => ({ ...f, trackingLimit: String(v) }))}
                  className={`text-caption2 px-2.5 py-1 rounded-apple font-semibold transition-all ${
                    editForm.trackingLimit === String(v)
                      ? 'bg-apple-blue text-white'
                      : 'bg-dark-surface2 text-dark-label2 hover:text-white'
                  }`}
                >
                  {v === -1 ? '∞ Unlimited' : v}
                </button>
              ))}
            </div>
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-subhead font-semibold text-white">Account Active</p>
              <p className="text-caption1 text-dark-label2">Suspended users cannot log in</p>
            </div>
            <button
              onClick={() => setEditForm((f) => ({ ...f, isActive: !f.isActive }))}
              className={`relative w-12 rounded-full transition-colors ${editForm.isActive ? 'bg-apple-green' : 'bg-dark-surface3'}`}
              style={{ height: '1.625rem' }}
            >
              <span
                className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform"
                style={{ width: '1.375rem', height: '1.375rem', transform: editForm.isActive ? 'translateX(1.375rem)' : 'translateX(0)' }}
              />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditUser(null)} className="btn-secondary flex-1 py-3">Cancel</button>
            <button
              onClick={handleSave}
              disabled={updateUser.isPending}
              className="btn-primary flex-1 py-3"
            >
              {updateUser.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
