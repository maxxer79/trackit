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
import StoreLogo from '../../components/ui/StoreLogo';

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

interface StoreForm { storeId: string; url: string; price: string; }

export default function AdminProducts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [storeProduct, setStoreProduct] = useState<Product | null>(null);
  const [storeForm, setStoreForm] = useState<StoreForm>({ storeId: '', url: '', price: '' });
  const [fetchingImage, setFetchingImage] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [scrapingId, setScrapingId] = useState<string | null>(null);

  const handleFetchImage = async () => {
    const urlToFetch = imageUrlInput || form.imageUrl;
    if (!urlToFetch) { toast.error('Enter a store URL or image URL to fetch from'); return; }
    setFetchingImage(true);
    try {
      const { data } = await api.get('/admin/fetch-image', { params: { url: urlToFetch } });
      setForm(f => ({ ...f, imageUrl: data.imageUrl }));
      toast.success('Image found!');
    } catch {
      toast.error('No image found at that URL. Try a different store link.');
    } finally {
      setFetchingImage(false);
    }
  };

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
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/admin/products/${id}/scrape`);
      return data;
    },
    onSuccess: (data: any) => {
      setScrapingId(null);
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      if (!data.results || data.results.length === 0) {
        toast.error(data.message ?? 'No store links found — add stores first');
        return;
      }
      const inStock = data.results.filter((r: any) => r.status === 'IN_STOCK').length;
      const out = data.results.filter((r: any) => r.status === 'OUT_OF_STOCK').length;
      const unknown = data.results.filter((r: any) => r.status !== 'IN_STOCK' && r.status !== 'OUT_OF_STOCK').length;
      toast.success(
        `Checked ${data.results.length} store(s): ${inStock} in stock, ${out} out, ${unknown} unknown`,
        { duration: 5000 }
      );
    },
    onError: () => { setScrapingId(null); toast.error('Scrape failed'); },
  });

  // Stores
  const { data: allStores = [] } = useQuery<any[]>({
    queryKey: ['stores'],
    queryFn: async () => { const { data } = await api.get('/products/stores'); return data; },
  });

  const { data: productStoreListings = [], refetch: refetchStoreListings } = useQuery<any[]>({
    queryKey: ['product-stores', storeProduct?.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${storeProduct!.slug}`);
      return data.stockStatuses ?? [];
    },
    enabled: !!storeProduct,
  });

  const addStoreListing = useMutation({
    mutationFn: async (body: { productId: string; storeId: string; url: string; price?: number }) =>
      api.post('/admin/store-products', body),
    onSuccess: () => {
      refetchStoreListings();
      setStoreForm({ storeId: '', url: '', price: '' });
      toast.success('Store link added');
    },
    onError: () => toast.error('Failed to add store link'),
  });

  const removeStoreListing = useMutation({
    mutationFn: async (storeProductId: string) => api.delete(`/admin/store-products/${storeProductId}`),
    onSuccess: () => { refetchStoreListings(); toast.success('Store link removed'); },
    onError: () => toast.error('Failed to remove store link'),
  });

  const setStockManual = useMutation({
    mutationFn: async ({ id, inStock }: { id: string; inStock: boolean }) =>
      api.patch(`/admin/store-products/${id}/stock`, { inStock }),
    onSuccess: () => { refetchStoreListings(); toast.success('Stock status updated'); },
    onError: () => toast.error('Failed to update stock'),
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
            const storeListings = (p as any).storeListings ?? [];
            const bestStatus: StockStatus = storeListings.some((s: any) => s.inStock) ? 'IN_STOCK' : 'OUT_OF_STOCK';

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
                    onClick={() => { setStoreProduct(p); setStoreForm({ storeId: '', url: '', price: '' }); }}
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-purple hover:bg-apple-purple/10"
                    title="Manage store links"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 3h12M1 7h12M1 11h12"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => { setScrapingId(p.id); triggerScrape.mutate(p.id); }}
                    disabled={scrapingId === p.id}
                    className="btn-icon w-8 h-8 text-dark-label2 hover:text-apple-green hover:bg-apple-green/10 disabled:opacity-50"
                    title="Check stock at all stores"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                      className={scrapingId === p.id ? 'animate-spin' : ''}>
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
            <div className="flex gap-2 mb-2">
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                className="input flex-1"
                placeholder="https://… (paste URL or let us fetch it)"
              />
              {form.imageUrl && (
                <img src={form.imageUrl} alt="preview"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                  className="w-10 h-10 rounded-apple object-contain bg-dark-surface2 border border-dark-separator shrink-0" />
              )}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="url"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                className="input flex-1 text-sm"
                placeholder="Paste a store product URL to auto-fetch image…"
              />
              <button
                type="button"
                onClick={handleFetchImage}
                disabled={fetchingImage}
                className="btn-secondary px-3 py-2 text-caption1 shrink-0 flex items-center gap-1.5 hover:text-apple-blue hover:border-apple-blue/50"
              >
                {fetchingImage ? (
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1"/>
                  </svg>
                )}
                {fetchingImage ? 'Fetching…' : 'Fetch Image'}
              </button>
            </div>
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

      {/* Store Links Modal */}
      <Modal isOpen={!!storeProduct} onClose={() => setStoreProduct(null)} title={`Store Links: ${storeProduct?.name}`}>
        <div className="space-y-4">
          {/* Existing listings */}
          {productStoreListings.length > 0 && (
            <div>
              <p className="text-footnote font-semibold text-dark-label2 mb-2">Current Stores</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {productStoreListings.map((s: any) => (
                  <div key={s.storeId ?? s.storeName} className="flex items-center gap-3 px-3 py-2.5 rounded-apple bg-dark-surface2">
                    <StoreLogo logoUrl={s.storeLogo} domain={s.storeSlug ? `${s.storeSlug}.com` : null} name={s.storeName ?? ''} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-footnote font-semibold text-white">{s.storeName}</p>
                      {s.productUrl && (
                        <a href={s.productUrl} target="_blank" rel="noopener noreferrer"
                          className="text-caption2 text-apple-blue hover:underline truncate block">
                          {s.productUrl.length > 40 ? s.productUrl.substring(0, 40) + '…' : s.productUrl}
                        </a>
                      )}
                    </div>
                    {s.storeProductId && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Manual stock toggle */}
                        <button
                          onClick={() => setStockManual.mutate({ id: s.storeProductId, inStock: s.status !== 'IN_STOCK' })}
                          className={`text-caption2 font-semibold px-2 py-1 rounded-apple transition-colors ${
                            s.status === 'IN_STOCK'
                              ? 'bg-apple-green/15 text-apple-green hover:bg-apple-red/15 hover:text-apple-red'
                              : 'bg-dark-surface3 text-dark-label3 hover:bg-apple-green/15 hover:text-apple-green'
                          }`}
                          title="Click to toggle stock status"
                        >
                          {s.status === 'IN_STOCK' ? '● In Stock' : '○ Out of Stock'}
                        </button>
                        <button
                          onClick={() => removeStoreListing.mutate(s.storeProductId)}
                          className="btn-icon w-7 h-7 text-dark-label3 hover:text-apple-red hover:bg-apple-red/10"
                          title="Remove store link"
                        >
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M2 3.5h10M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new store link */}
          <div className="border-t border-dark-separator pt-4">
            <p className="text-footnote font-semibold text-dark-label2 mb-3">Add Store Link</p>
            <div className="space-y-3">
              <div>
                <label className="block text-caption2 text-dark-label3 mb-1">Store *</label>
                <select value={storeForm.storeId} onChange={(e) => setStoreForm(f => ({ ...f, storeId: e.target.value }))}
                  className="input">
                  <option value="">Select a store…</option>
                  {(allStores as any[]).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-caption2 text-dark-label3 mb-1">Product URL at this store *</label>
                <input type="url" value={storeForm.url} onChange={(e) => setStoreForm(f => ({ ...f, url: e.target.value }))}
                  className="input" placeholder="https://www.bestbuy.com/site/..." />
              </div>
              <div>
                <label className="block text-caption2 text-dark-label3 mb-1">Price (optional)</label>
                <input type="number" value={storeForm.price} onChange={(e) => setStoreForm(f => ({ ...f, price: e.target.value }))}
                  className="input" placeholder="999.99" step="0.01" min="0" />
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setStoreProduct(null)} className="btn-secondary flex-1 py-3">Close</button>
            <button
              onClick={() => {
                if (!storeProduct || !storeForm.storeId || !storeForm.url) { toast.error('Store and URL are required'); return; }
                addStoreListing.mutate({
                  productId: storeProduct.id,
                  storeId: storeForm.storeId,
                  url: storeForm.url,
                  price: storeForm.price ? parseFloat(storeForm.price) : undefined,
                });
              }}
              disabled={addStoreListing.isPending || !storeForm.storeId || !storeForm.url}
              className="btn-primary flex-1 py-3"
            >
              {addStoreListing.isPending ? 'Adding…' : 'Add Store Link'}
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
