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

export function useAddTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, watchStores }: { productId: string; watchStores?: string[] }) => {
      const { data } = await api.post(`/tracking/${productId}`, { watchStores });
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

export function useUpdateTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      watchStores,
      autoBuyEnabled,
      autoBuyMaxPrice,
    }: {
      productId: string;
      watchStores?: string[];
      autoBuyEnabled?: boolean;
      autoBuyMaxPrice?: number | null;
    }) => {
      const { data } = await api.patch(`/tracking/${productId}`, {
        watchStores,
        autoBuyEnabled,
        autoBuyMaxPrice,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracking'] }),
  });
}
