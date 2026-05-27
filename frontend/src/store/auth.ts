import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  trackingLimit: number;
  trackingCount: number;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
  notifyDiscord: boolean;
  phoneNumber: string | null;
  discordWebhook: string | null;
  autoBuyEnabled: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,

      setUser: (user) => set({ user }),
      setAccessToken: (token) => {
        set({ accessToken: token });
        if (token) {
          localStorage.setItem('accessToken', token);
        } else {
          localStorage.removeItem('accessToken');
        }
      },

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        get().setAccessToken(data.accessToken);
        set({ user: data.user });
        connectSocket();
      },

      register: async (email, password, name) => {
        const { data } = await api.post('/auth/register', { email, password, name });
        get().setAccessToken(data.accessToken);
        set({ user: data.user });
        connectSocket();
      },

      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {}
        get().setAccessToken(null);
        set({ user: null });
        disconnectSocket();
      },

      fetchMe: async () => {
        set({ isLoading: true });
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data });
          connectSocket();
        } catch {
          get().setAccessToken(null);
          set({ user: null });
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'trackit-auth',
      partialize: (state) => ({ accessToken: state.accessToken }),
    }
  )
);
