import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import Modal from '../../components/ui/Modal';
import StoreLogo from '../../components/ui/StoreLogo';
import toast from 'react-hot-toast';

interface Store {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  logoUrl?: string;
  country: string;
  isActive: boolean;
  sortOrder: number;
}

const EMPTY_FORM = { name: '', slug: '', domain: '', logoUrl: '', country: 'us', sortOrder: '99' };


export default function AdminStores() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editStore, setEditStore] = useState<Store | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: stores = [], isLoading } = useQuery<Store[]>({
    queryKey: ['admin-stores'],
    queryFn: async () => { const { data } = await api.get('/admin/stores'); return data; },
  });

  const filtered = stores.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.domain?.toLowerCase().includes(search.toLowerCase())
  );

  const createStore = useMutation({
    mutationFn: async (body: typeof EMPTY_FORM) => api.post('/admin/stores', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-stores'] }); toast.success('Store created'); closeModal(); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create store'),
  });

  const updateStore = useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & typeof EMPTY_FORM) => api.patch(`/admin/stores/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-stores'] }); toast.success('Store updated'); closeModal(); },
    onError: () => toast.error('Failed to update store'),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/stores/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-stores'] }),
  });

  const deleteStore = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/stores/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-stores'] }); toast.success('Store deactivated'); setDeleteId(null); },
  });

  const openCreate = () => { setEditStore(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (s: Store) => {
    setEditStore(s);
    setForm({ name: s.name, slug: s.slug, domain: s.domain ?? '', logoUrl: s.logoUrl ?? '', country: s.country, sortOrder: String(s.sortOrder) });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditStore(null); setForm(EMPTY_FORM); };

  const handleSave = () => {
    if (editStore) updateStore.mutate({ id: editStore.id, ...form });
    else createStore.mutate(form);
  };

  // Auto-fill logo and slug from domain
  const handleDomainChange = (domain: string) => {
    setForm(f => ({
      ...f,
      domain,
      logoUrl: f.logoUrl || (domain ? `https://logo.clearbit.com/${domain}` : ''),
    }));
  };

  const handleNameChange = (name: string) => {
    setForm(f => ({
      ...f,
      name,
      slug: f.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Retailers</h1>
          <p className="section-subtitle">{stores.length} stores · {stores.filter(s => s.isActive).length} active</p>
        </div>
        <button onClick={openCreate} className="btn-primary px-5 py-2.5 text-subhead">+ Add Retailer</button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          className="input pl-11" placeholder="Search retailers…" />
      </div>

      {/* Table */}
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
          {filtered.map((store, i) => (
            <motion.div key={store.id}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-dark-surface2 transition-colors"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
              <StoreLogo logoUrl={store.logoUrl} domain={store.domain} name={store.name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-subhead font-semibold text-white truncate">{store.name}</p>
                  {!store.isActive && (
                    <span className="text-caption2 px-2 py-0.5 rounded-pill bg-dark-surface3 text-dark-label3 font-semibold">Inactive</span>
                  )}
                </div>
                <p className="text-caption1 text-dark-label3">{store.domain ?? '—'}</p>
              </div>
              <div className="hidden sm:block text-right shrink-0">
                <p className="text-caption2 text-dark-label3">Order: {store.sortOrder}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Toggle active */}
                <button
                  onClick={() => toggleActive.mutate({ id: store.id, isActive: !store.isActive })}
                  className={`btn-icon w-8 h-8 ${store.isActive ? 'text-apple-green hover:text-apple-red' : 'text-dark-label3 hover:text-apple-green'}`}
                  title={store.isActive ? 'Deactivate' : 'Activate'}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    {store.isActive
                      ? <><circle cx="7" cy="7" r="5"/><path d="M5 7l2 2 3-3"/></>
                      : <><circle cx="7" cy="7" r="5"/><path d="M5 5l4 4M9 5l-4 4"/></>
                    }
                  </svg>
                </button>
                <button onClick={() => openEdit(store)}
                  className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-blue hover:bg-apple-blue/10"
                  title="Edit store">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/>
                  </svg>
                </button>
                <button onClick={() => setDeleteId(store.id)}
                  className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-red hover:bg-apple-red/10"
                  title="Deactivate store">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 3.5h10M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"/>
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
          {filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">🏪</p>
              <p className="text-subhead text-dark-label2">No retailers found</p>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editStore ? 'Edit Retailer' : 'Add Retailer'}>
        <div className="space-y-4">
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Name *</label>
            <input type="text" value={form.name} onChange={(e) => handleNameChange(e.target.value)}
              className="input" placeholder="Best Buy" />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Slug *</label>
            <input type="text" value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
              className="input font-mono text-sm" placeholder="bestbuy" />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Domain</label>
            <input type="text" value={form.domain} onChange={(e) => handleDomainChange(e.target.value)}
              className="input" placeholder="bestbuy.com" />
            <p className="text-caption2 text-dark-label3 mt-1">Logo will be auto-fetched from this domain</p>
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Logo URL</label>
            <div className="flex gap-3 items-start">
              <input type="url" value={form.logoUrl} onChange={(e) => setForm(f => ({ ...f, logoUrl: e.target.value }))}
                className="input flex-1" placeholder="https://logo.clearbit.com/bestbuy.com" />
              {form.logoUrl && (
                <img src={form.logoUrl} alt="preview" onError={(e) => (e.currentTarget.style.display = 'none')}
                  className="w-10 h-10 rounded-full object-contain bg-white p-1 border border-dark-separator shrink-0" />
              )}
            </div>
            {form.domain && !form.logoUrl && (
              <button onClick={() => setForm(f => ({ ...f, logoUrl: `https://logo.clearbit.com/${form.domain}` }))}
                className="text-caption1 text-apple-blue hover:underline mt-1">
                Auto-fill from domain
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-footnote font-semibold text-dark-label2 mb-2">Country</label>
              <select value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input">
                <option value="us">🇺🇸 US</option>
                <option value="ca">🇨🇦 Canada</option>
                <option value="uk">🇬🇧 UK</option>
                <option value="au">🇦🇺 Australia</option>
                <option value="eu">🇪🇺 Europe</option>
              </select>
            </div>
            <div>
              <label className="block text-footnote font-semibold text-dark-label2 mb-2">Sort Order</label>
              <input type="number" value={form.sortOrder} onChange={(e) => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                className="input" placeholder="99" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={closeModal} className="btn-secondary flex-1 py-3">Cancel</button>
            <button onClick={handleSave}
              disabled={createStore.isPending || updateStore.isPending || !form.name || !form.slug}
              className="btn-primary flex-1 py-3">
              {(createStore.isPending || updateStore.isPending) ? 'Saving…' : editStore ? 'Save Changes' : 'Add Retailer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Deactivate Retailer">
        <div className="space-y-5">
          <p className="text-subhead text-dark-label2">This will hide the retailer from all product pages. Existing store links won't be deleted.</p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1 py-3">Cancel</button>
            <button onClick={() => deleteId && deleteStore.mutate(deleteId)} disabled={deleteStore.isPending}
              className="btn-danger flex-1 py-3">
              {deleteStore.isPending ? 'Deactivating…' : 'Deactivate'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
