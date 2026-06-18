import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { Product, PaginatedResponse } from '../types';

interface ProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  inStock?: boolean;
  featured?: boolean;
  newlyAdded?: boolean;
}

export function useProducts(filters: ProductFilters = {}) {
  return useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page)       params.set('page', String(filters.page));
      if (filters.limit)      params.set('limit', String(filters.limit));
      if (filters.search)     params.set('search', filters.search);
      if (filters.category)   params.set('category', filters.category);
      if (filters.inStock)    params.set('inStock', 'true');
      if (filters.featured)   params.set('featured', 'true');
      if (filters.newlyAdded) params.set('newlyAdded', 'true');
      const { data } = await api.get(`/products?${params}`);
      return data;
    },
  });
}

export function useProduct(slug: string) {
  return useQuery<Product>({
    queryKey: ['product', slug],
    queryFn: async () => {
      const { data } = await api.get(`/products/${slug}`);
      return data;
    },
    enabled: !!slug,
  });
}

export function useCategories() {
  return useQuery<string[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await api.get('/products/categories');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useTracking() {
  return useQuery<any[]>({
    queryKey: ['tracking'],
    queryFn: async () => {
      const { data } = await api.get('/tracking');
      return data;
    },
  });
}

export interface RestockAnalytics {
  trackedCount: number;
  windowDays: number;
  timezone: string;
  summary: {
    total: number;
    spanDays: number;
    restocksPerMonth: number | null;
    peakHour: number | null;
    byHour: number[];
    byDayOfWeek: number[];
    topRetailers: { storeSlug: string; count: number }[];
    firstAt: string | null;
    lastAt: string | null;
  };
}

export function useTrackingAnalytics() {
  return useQuery<RestockAnalytics>({
    queryKey: ['tracking-analytics'],
    queryFn: async () => {
      const { data } = await api.get('/tracking/analytics');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface RestockFrequency {
  restockCount: number;
  lastRestockAt: string | null;
  avgIntervalDays: number | null;
  medianIntervalDays: number | null;
  intervalsCount: number;
}

export function useSimilarProducts(slug: string) {
  return useQuery<(Product & { similarSource?: 'co-tracked' | 'category'; coTrackCount?: number | null })[]>({
    queryKey: ['similar-products', slug],
    queryFn: async () => {
      const { data } = await api.get(`/products/${slug}/similar`);
      return data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export interface StockTimeline {
  segments: { state: 'in' | 'out'; start: string; end: string; days: number }[];
  restockCount: number;
  firstAt: string | null;
}

export function useStockTimeline(slug: string) {
  return useQuery<StockTimeline>({
    queryKey: ['stock-timeline', slug],
    queryFn: async () => {
      const { data } = await api.get(`/products/${slug}/timeline`);
      return data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRestockFrequency(slug: string) {
  return useQuery<RestockFrequency>({
    queryKey: ['restock-frequency', slug],
    queryFn: async () => {
      const { data } = await api.get(`/products/${slug}/restock-frequency`);
      return data;
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, watchStores }: { productId: string; watchStores?: string[] }) => {
      // Backend route is POST /api/tracking with productId in the body
      // (not /tracking/:productId — that route doesn't exist and 404s).
      const { data } = await api.post('/tracking', { productId, watchStores });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });
}

export function useRemoveTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      await api.delete(`/tracking/${productId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });
}

export interface BulkChanges {
  notifyEmail?: boolean;
  notifyPush?: boolean;
  autoBuyEnabled?: boolean;
  autoBuyMaxPrice?: number | null;
}

export function useBulkTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { productIds: string[]; op: 'update' | 'remove'; changes?: BulkChanges }) => {
      const { data } = await api.post('/tracking/bulk', body);
      return data as { affected: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });
}

export function useImportTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await api.post('/tracking/import', { url });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking'] });
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });
}

export function useUpdateTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      notifyEmail,
      notifyPush,
      watchStores,
      autoBuyEnabled,
      autoBuyMaxPrice,
      note,
      tags,
      alertMaxPrice,
      alertDays,
    }: {
      productId: string;
      notifyEmail?: boolean;
      notifyPush?: boolean;
      watchStores?: string[];
      autoBuyEnabled?: boolean;
      autoBuyMaxPrice?: number | null;
      note?: string | null;
      tags?: string[];
      alertMaxPrice?: number | null;
      alertDays?: number[];
    }) => {
      const { data } = await api.patch(`/tracking/${productId}`, {
        notifyEmail,
        notifyPush,
        watchStores,
        autoBuyEnabled,
        autoBuyMaxPrice,
        note,
        tags,
        alertMaxPrice,
        alertDays,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracking'] }),
  });
}
