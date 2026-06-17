import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token from localStorage to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// There is no refresh-token flow server-side yet: the previous code POSTed to a
// nonexistent /auth/refresh, which 404'd and then logged the user out anyway.
// So on an auth failure we just clear the stored session and go to login —
// except for the login/register requests themselves (so their forms can surface
// the error) and when already on /login (avoid a redirect loop).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? '';
    const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register');

    if (status === 401 && !isAuthAttempt && window.location.pathname !== '/login') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('trackit-auth'); // zustand persist key — see store/auth.ts
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
