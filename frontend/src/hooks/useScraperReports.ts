import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export interface ScraperReport {
  id: string;
  productId: string | null;
  productName: string | null;
  storeSlug: string | null;
  storeName: string | null;
  productUrl: string | null;
  issueType: string;
  description: string;
  suggestedSelector: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  user?: { id: string; name: string | null; email: string };
}

export const ISSUE_TYPES = [
  { id: 'WRONG_STOCK', label: 'Stock status is wrong' },
  { id: 'WRONG_PRICE', label: 'Price is wrong' },
  { id: 'NOT_LOADING', label: 'Store never updates / not loading' },
  { id: 'SELECTOR_BROKEN', label: 'Page layout changed (selector broken)' },
  { id: 'OTHER', label: 'Something else' },
];

export const REPORT_STATUSES = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'];
export const REPORT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  REVIEWING: 'Reviewing',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

export interface NewReport {
  productId?: string | null;
  productName?: string | null;
  storeSlug?: string | null;
  storeName?: string | null;
  productUrl?: string | null;
  issueType: string;
  description: string;
  suggestedSelector?: string | null;
}

export function useCreateScraperReport() {
  return useMutation({
    mutationFn: async (body: NewReport) => {
      const { data } = await api.post('/scraper-reports', body);
      return data as { id: string; message: string };
    },
  });
}

export function useAdminScraperReports(status?: string) {
  return useQuery<{ reports: ScraperReport[]; counts: Record<string, number> }>({
    queryKey: ['admin-scraper-reports', status ?? 'ALL'],
    queryFn: async () => {
      const { data } = await api.get('/admin/scraper-reports', { params: { status: status || undefined } });
      return data;
    },
  });
}

export function useUpdateScraperReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; status?: string; adminNote?: string | null }) => {
      const { data } = await api.patch(`/admin/scraper-reports/${id}`, body);
      return data as ScraperReport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-scraper-reports'] }),
  });
}
