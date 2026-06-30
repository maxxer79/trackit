import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  storeName: string | null;
  storeSlug: string | null;
  price: number | null;
  purchasedAt: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  deliveredAt: string | null;
  note: string | null;
  trackingUrl: string | null;
  deliveryMilestone: string | null;
  deliveryUpdatedAt: string | null;
  liveTrackingEnabled?: boolean;
}

export const MILESTONE_LABEL: Record<string, string> = {
  pending: 'Pending',
  info_received: 'Info received',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  available_for_pickup: 'Ready for pickup',
  failed_attempt: 'Failed attempt',
  delivered: 'Delivered',
  exception: 'Exception',
};

export const CARRIERS = [
  { id: 'ups', name: 'UPS' },
  { id: 'usps', name: 'USPS' },
  { id: 'fedex', name: 'FedEx' },
  { id: 'dhl', name: 'DHL' },
  { id: 'amazon', name: 'Amazon' },
  { id: 'other', name: 'Other' },
];

export const PURCHASE_STATUSES = ['ORDERED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

export const STATUS_LABEL: Record<string, string> = {
  ORDERED: 'Ordered',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function usePurchases() {
  return useQuery<Purchase[]>({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data } = await api.get('/purchases');
      return data;
    },
  });
}

export interface SavingsRow {
  id: string;
  productName: string | null;
  storeName: string | null;
  purchasedAt: string;
  paid: number | null;
  reference: number | null;
  saved: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
}

export interface SavingsSummary {
  totalSaved: number;
  counted: number;
  rows: SavingsRow[];
}

export function usePurchaseSavings() {
  return useQuery<SavingsSummary>({
    queryKey: ['purchase-savings'],
    queryFn: async () => {
      const { data } = await api.get('/purchases/savings');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Purchase> & { productId: string }) => {
      const { data } = await api.post('/purchases', body);
      return data as Purchase;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Partial<Purchase>) => {
      const { data } = await api.patch(`/purchases/${id}`, body);
      return data as Purchase;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function useRefreshPurchaseTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/purchases/${id}/refresh-tracking`);
      return data as Purchase;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchases/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}
