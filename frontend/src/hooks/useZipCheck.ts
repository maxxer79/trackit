import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';

export interface ZipCheckRow {
  zip: string;
  storeSlug: string;
  storeId?: string;
  storeName?: string;
  status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'LIMITED' | 'PREORDER' | 'UNKNOWN';
  price?: number;
  pickupAvailable?: boolean;
  pickupLocation?: string;
  /**
   * False means the ZIP couldn't be mapped to a store, so there is NO price for
   * it. Render these as "couldn't check" — never as that ZIP's price.
   */
  locationResolved: boolean;
  message?: string;
  checkedAt: string;
  cached: boolean;
}

export interface ZipCheckResponse {
  storeSlug: string;
  productUrl: string;
  results: ZipCheckRow[];
  cheapestZip: string | null;
  unresolvedCount: number;
}

export interface ZipCheckVars {
  productUrl: string;
  zips: string[];
  storeProductId?: string;
  force?: boolean;
}

export const MAX_ZIPS = 5;

export function useZipCheck() {
  return useMutation<ZipCheckResponse, unknown, ZipCheckVars>({
    mutationFn: async (vars) => {
      const { data } = await api.post<ZipCheckResponse>('/zip-check', vars);
      return data;
    },
  });
}

/** Retailers that support per-ZIP checks (mirrors storeLocator.ZIP_CHECK_STORES). */
export const ZIP_CHECK_STORES = ['walmart', 'target', 'homedepot', 'lowes'];

export function supportsZipCheck(storeSlug?: string | null): boolean {
  if (!storeSlug) return false;
  const s = storeSlug.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/com$/, '');
  return ZIP_CHECK_STORES.includes(s);
}
