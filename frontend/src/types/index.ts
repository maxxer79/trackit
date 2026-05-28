// ─── Auth / User ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  trackingLimit: number;      // -1 = unlimited
  trackingCount: number;
  emailAlerts: boolean;
  pushAlerts: boolean;
  browserAlerts: boolean;
  notifyEmail?: boolean;
  notifySms?: boolean;
  notifyPush?: boolean;
  notifyDiscord?: boolean;
  phoneNumber?: string | null;
  discordWebhook?: string | null;
  autoBuyEnabled?: boolean;
  avatar?: string;
  isActive?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  _count?: { trackings: number };
}

// ─── Store ─────────────────────────────────────────────────────────────────

export interface Store {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  domain?: string;
  country: string;
  isActive: boolean;
  sortOrder: number;
}

// ─── Stock ─────────────────────────────────────────────────────────────────

export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'LIMITED' | 'PREORDER' | 'UNKNOWN';

export interface StockStatusEntry {
  storeSlug: string;
  storeName: string;
  storeId?: string;
  storeLogo?: string;
  status: StockStatus;
  price?: number | null;
  currency?: string;
  url?: string;
  productUrl?: string;
  lastChecked?: string;
  lastCheckedAt?: string;
}

// ─── StoreProduct ──────────────────────────────────────────────────────────

export interface StoreProduct {
  id: string;
  productId: string;
  storeId: string;
  url: string;
  price?: number | null;
  currency: string;
  inStock: boolean;
  stockLevel?: number;
  lastChecked?: string;
  store: Store;
}

// ─── Product ───────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string;
  category?: string;
  description?: string;
  tags: string[];
  isActive: boolean;
  isNew: boolean;
  isFeatured: boolean;
  viewCount: number;
  createdAt: string;
  // Rich fields returned by API
  storeListings?: StoreProduct[];
  stockStatuses?: StockStatusEntry[];
  bestStatus?: StockStatus;
  lowestPrice?: number | null;
  isTracking?: boolean;
  isNewlyAdded?: boolean;
  trackingCount?: number;
  _count?: { trackings: number };
}

// ─── Tracking ──────────────────────────────────────────────────────────────

export interface Tracking {
  id: string;
  userId: string;
  productId: string;
  isActive: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  watchStores?: string[];
  autoBuyEnabled?: boolean;
  autoBuyMaxPrice?: number | null;
  createdAt: string;
  stockStatuses?: StockStatusEntry[];
  product: Product & {
    stockStatuses?: StockStatusEntry[];
    bestStatus?: StockStatus;
    lowestPrice?: number | null;
  };
}

// ─── Alert / Notification ──────────────────────────────────────────────────

export interface Alert {
  id: string;
  userId: string;
  productId: string;
  productSlug: string;
  productName: string;
  productImageUrl?: string;
  storeName: string;
  storeSlug: string;
  productUrl: string;
  status: StockStatus;
  price?: number | null;
  type: 'IN_STOCK' | 'PRICE_DROP' | 'BACK_IN_STOCK' | 'OUT_OF_STOCK';
  isRead: boolean;
  emailSent: boolean;
  smsSent: boolean;
  pushSent: boolean;
  discordSent: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  url?: string;
  imageUrl?: string;
  isRead: boolean;
  type: string;
  createdAt: string;
}

// ─── Pagination ────────────────────────────────────────────────────────────

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Admin ─────────────────────────────────────────────────────────────────

export interface AdminUser extends User {
  isActive: boolean;
  _count: { trackings: number };
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalProducts: number;
  activeTrackings: number;
  alertsToday: number;
  alertsThisWeek: number;
  totalAlerts: number;
  scraperErrors: number;
  recentUsers: AdminUser[];
  topProducts: { id: string; name: string; slug: string; _count: { trackings: number } }[];
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  stats: {
    users: number;
    products: number;
    trackings: number;
    alertsToday: number;
  };
  recentUsers: User[];
  topTracked: Product[];
  recentAlerts?: Array<{
    id: string;
    productName: string;
    storeName: string;
    userEmail: string;
    createdAt: string;
  }>;
}
