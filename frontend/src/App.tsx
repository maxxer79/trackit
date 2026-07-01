import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { useStockUpdates } from './hooks/useStockUpdates';
import { useSocketConnection } from './hooks/useSocketConnection';
import Layout from './components/layout/Layout';
import LoadingScreen from './components/ui/LoadingScreen';

// Lazy-loaded pages
const LandingPage    = lazy(() => import('./pages/LandingPage'));
const LoginPage      = lazy(() => import('./pages/LoginPage'));
const RegisterPage   = lazy(() => import('./pages/RegisterPage'));
const BrowsePage     = lazy(() => import('./pages/BrowsePage'));
const ProductPage    = lazy(() => import('./pages/ProductPage'));
const DashboardPage  = lazy(() => import('./pages/DashboardPage'));
const PriceWatchPage = lazy(() => import('./pages/PriceWatchPage'));
const AlertsPage     = lazy(() => import('./pages/AlertsPage'));
const PurchasesPage  = lazy(() => import('./pages/PurchasesPage'));
const SettingsPage   = lazy(() => import('./pages/SettingsPage'));
const AdminPage      = lazy(() => import('./pages/admin/AdminPage'));
const AdminUsers     = lazy(() => import('./pages/admin/AdminUsers'));
const AdminProducts  = lazy(() => import('./pages/admin/AdminProducts'));
const AdminReports   = lazy(() => import('./pages/admin/AdminReports'));
const AdminLogs      = lazy(() => import('./pages/admin/AdminLogs'));
const AdminStores    = lazy(() => import('./pages/admin/AdminStores'));
const AdminBackups   = lazy(() => import('./pages/admin/AdminBackups'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || user.role !== 'ADMIN') return <Navigate to="/browse" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user) return <Navigate to="/browse" replace />;
  return <>{children}</>;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setTheme = useThemeStore((s) => s.setTheme);
  const theme = useThemeStore((s) => s.theme);

  useStockUpdates();
  useSocketConnection();

  useEffect(() => {
    // Apply persisted theme on mount
    setTheme(theme);
  }, []);

  useEffect(() => {
    // Restore session if we have a token
    if (accessToken) fetchMe();
  }, []);

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login"    element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />

        {/* Main app — requires auth */}
        <Route element={<Layout />}>
          <Route path="/browse"         element={<BrowsePage />} />
          <Route path="/product/:slug"  element={<ProductPage />} />
          <Route path="/dashboard"      element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/price-watch"    element={<RequireAuth><PriceWatchPage /></RequireAuth>} />
          <Route path="/alerts"         element={<RequireAuth><AlertsPage /></RequireAuth>} />
          <Route path="/purchases"      element={<RequireAuth><PurchasesPage /></RequireAuth>} />
          <Route path="/settings"       element={<RequireAuth><SettingsPage /></RequireAuth>} />

          {/* Admin */}
          <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/users"    element={<RequireAuth><RequireAdmin><AdminUsers /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/products" element={<RequireAuth><RequireAdmin><AdminProducts /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/logs"     element={<RequireAuth><RequireAdmin><AdminLogs /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/reports"  element={<RequireAuth><RequireAdmin><AdminReports /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/stores"   element={<RequireAuth><RequireAdmin><AdminStores /></RequireAdmin></RequireAuth>} />
          <Route path="/admin/backups"  element={<RequireAuth><RequireAdmin><AdminBackups /></RequireAdmin></RequireAuth>} />
        </Route>

        <Route path="*" element={<Navigate to="/browse" replace />} />
      </Routes>
    </Suspense>
  );
}
