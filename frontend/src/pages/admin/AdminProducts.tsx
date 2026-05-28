import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { Product } from '../../types';
import Modal from '../../components/ui/Modal';
import StatusBadge from '../../components/ui/StatusBadge';
import { StockStatus } from '../../types';
import toast from 'react-hot-toast';

interface ProductForm {
  name: string;
  slug: string;
  description: string;
  category: string;
  imageUrl: string;
  isActive: boolean;
}

const EMPTY_FORM: ProductForm = {
  name: '',
  slug: '',
  description: '',
  category: '',
  imageUrl: '',
  isActive: true,
};

export default function AdminProducts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: Product[]; total: number; totalPages: number }>({
    queryKey: ['admin-products', search, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/products', { params: { search, page, limit: 20 } });
      return data;
    },
  });

  const createProduct = useMutation({
    mutationFn: async (body: ProductForm) => api.post('/admin/products', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success('Product created');
      closeModal();
    },
    onError: () => toast.error('Failed to create product'),
  });

  const updateProduct = useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & ProductForm) => api.patch(`/admin/products/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success('Product updated');
      closeModal();
    },
    onError: () => toast.error('Failed to update product'),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      toast.success('Product deleted');
      setDeleteId(null);
    },
    onError: () => toast.error('Failed to delete product'),
  });

  const triggerScrape = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/products/${id}/scrape`),
    onSuccess: () => toast.success('Scrape queued'),
    onError: () => toast.error('Failed to queue scrape'),
  });

  const openCreate = () => {
    setEditProduct(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setForm({
      name: p.name,
      slug: p.slug,
      description: p.description ?? '',
      category: p.category ?? '',
      imageUrl: p.imageUrl ?? '',
      isActive: (p as any).isActive ?? true,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditProduct(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = () => {
    if (editProduct) {
      updateProduct.mutate({ id: editProduct.id, ...form });
    } else {
      createProduct.mutate(form);
    }
  };

  // Auto-generate slug from name
  const handleNameChange = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      slug: f.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="section-title">Products</h1>
          <p className="section-subtitle">{data?.total?.toLocaleString() ?? 0} products</p>
        </div>
        <button onClick={openCreate} className="btn-primary px-5 py-2.5 text-subhead">
          + Add Product
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-label2 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input pl-11"
          placeholder="Search products…"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse flex gap-3">
              <div className="w-12 h-12 rounded-apple bg-dark-surface2 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-dark-surface2 rounded w-1/2" />
                <div className="h-3 bg-dark-surface2 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-dark-separator">
          {data?.data.map((p, i) => {
            const bestStatus: StockStatus = (p.stockStatuses as any)?.find((s: any) => s.status === 'IN_STOCK')?.status
              ?? (p.stockStatuses as any)?.find((s: any) => s.status === 'LIMITED')?.status
              ?? 'OUT_OF_STOCK';

            return (
              <motion.div
                key={p.id}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-dark-surface2 transition-colors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
              >
                {/* Image */}
                <div className="w-12 h-12 rounded-apple bg-dark-surface2 overflow-hidden flex items-center justify-center shrink-0">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain p-1" />
                  ) : (
                    <span className="text-xl opacity-30">📦</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-subhead font-semibold text-white truncate">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-caption2 text-dark-label3 capitalize">{p.category}</span>
                    <StatusBadge status={bestStatus} size="sm" />
                    {(p.trackingCount ?? 0) > 0 && (
                      <span className="text-caption2 text-dark-label3">{p.trackingCount} tracking</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Link
                    to={`/product/${p.slug}`}
                    target="_blank"
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-white"
                    title="View product"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M7 2.5H2.5v9h9V7M9 2.5h2.5V5M6.5 7.5l4-4"/>
                    </svg>
                  </Link>
                  <button
                    onClick={() => triggerScrape.mutate(p.id)}
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-green hover:bg-apple-green/10"
                    title="Trigger scrape"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 7A5 5 0 1 1 7 2"/>
                      <path d="M12 2v3h-3"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-blue hover:bg-apple-blue/10"
                    title="Edit product"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteId(p.id)}
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-red hover:bg-apple-red/10"
                    title="Delete product"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 3.5h10M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"/>
                    </svg>
                  </button>
                </div>
              </motion.div>
            );
          })}
          {data?.data.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">📦</p>
              <p className="text-subhead text-dark-label2">No products found</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-4 py-2 disabled:opacity-30">← Prev</button>
          <span className="text-footnote text-dark-label2">Page {page} of {data.totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="btn-secondary px-4 py-2 disabled:opacity-30">Next →</button>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editProduct ? 'Edit Product' : 'Add Product'}>
        <div className="space-y-4">
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="input"
              placeholder="PlayStation 5 Console"
            />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Slug *</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              className="input font-mono text-sm"
              placeholder="playstation-5-console"
            />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Category *</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="input"
              placeholder="gaming, gpu, cpu, toy…"
            />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="input resize-none"
              rows={3}
              placeholder="Short product description…"
            />
          </div>
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Image URL</label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              className="input"
              placeholder="https://…"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-subhead font-semibold text-white">Active</p>
              <p className="text-caption1 text-dark-label2">Inactive products are hidden from browse</p>
            </div>
            <button
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              className={`relative w-12 rounded-full transition-colors ${form.isActive ? 'bg-apple-green' : 'bg-dark-surface3'}`}
              style={{ height: '1.625rem' }}
            >
              <span
                className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform"
                style={{ width: '1.375rem', height: '1.375rem', transform: form.isActive ? 'translateX(1.375rem)' : 'translateX(0)' }}
              />
            </button>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={closeModal} className="btn-secondary flex-1 py-3">Cancel</button>
            <button
              onClick={handleSave}
              disabled={createProduct.isPending || updateProduct.isPending || !form.name || !form.slug}
              className="btn-primary flex-1 py-3"
            >
              {(createProduct.isPending || updateProduct.isPending) ? 'Saving…' : editProduct ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Product">
        <div className="space-y-5">
          <p className="text-subhead text-dark-label2">
            Are you sure you want to delete this product? This will remove all associated tracking and alerts.
            This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1 py-3">Cancel</button>
            <button
              onClick={() => deleteId && deleteProduct.mutate(deleteId)}
              disabled={deleteProduct.isPending}
              className="btn-danger flex-1 py-3"
            >
              {deleteProduct.isPending ? 'Deleting…' : 'Delete Product'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
