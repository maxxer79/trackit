import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('trackit_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('trackit_token');
      localStorage.removeItem('trackit_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const authAPI = {
  register: (data: { email: string; password: string; name: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
  updateProfile: (data: any) => api.put('/auth/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/auth/password', data),
};

// Products
export const productsAPI = {
  getAll: (params?: any) => api.get('/products', { params }),
  getBySlug: (slug: string) => api.get(`/products/${slug}`),
  getFeatured: () => api.get('/products/featured'),
  getNew: () => api.get('/products/new'),
  getCategories: () => api.get('/products/categories'),
  getStores: () => api.get('/products/stores'),
};

// Tracking
export const trackingAPI = {
  getAll: () => api.get('/tracking'),
  add: (productId: string) => api.post('/tracking', { productId }),
  remove: (productId: string) => api.delete(`/tracking/${productId}`),
  getAlertHistory: (params?: any) => api.get('/tracking/alerts/history', { params }),
};

// Notifications
export const notificationsAPI = {
  getAll: (params?: any) => api.get('/notifications', { params }),
  markAllRead: () => api.put('/notifications/read-all'),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  savePushToken: (data: any) => api.post('/notifications/push-token', data),
  deletePushToken: (endpoint: string) => api.delete('/notifications/push-token', { data: { endpoint } }),
};

// Admin
export const adminAPI = {
  getStats: () => api.get('/admin/stats'),
  getUsers: (params?: any) => api.get('/admin/users', { params }),
  updateUser: (id: string, data: any) => api.patch(`/admin/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  createProduct: (data: any) => api.post('/admin/products', data),
  updateProduct: (id: string, data: any) => api.patch(`/admin/products/${id}`, data),
  deleteProduct: (id: string) => api.delete(`/admin/products/${id}`),
  addStoreProduct: (data: any) => api.post('/admin/store-products', data),
};

export default api;
