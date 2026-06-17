import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../store/auth';
import { useThemeStore } from '../../store/theme';
import ConnectionStatus from '../ui/ConnectionStatus';
import clsx from 'clsx';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Close on any click outside the menu
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const cycleTheme = () => {
    const themes = ['dark', 'light', 'system'] as const;
    const idx = themes.indexOf(theme as any);
    setTheme(themes[(idx + 1) % themes.length]);
  };

  const themeIcon = theme === 'light' ? '☀️' : theme === 'system' ? '💻' : '🌙';

  return (
    <nav className="fixed top-0 inset-x-0 z-40 glass border-b border-dark-separator safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link to={user ? '/browse' : '/'} className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-[10px] bg-apple-blue flex items-center justify-center shadow-glow-blue">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L3 6.5v9h3.5v-5h5v5H15v-9L9 2z" fill="white" />
            </svg>
          </div>
          <span className="text-title2 font-bold text-dark-label1 hidden sm:block">TrackIt</span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden sm:flex items-center gap-1">
          <NavLink to="/browse" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
            Browse
          </NavLink>
          {user && (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
                Dashboard
              </NavLink>
              <NavLink to="/alerts" className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
                Alerts
              </NavLink>
              {user.role === 'ADMIN' && (
                <NavLink to="/admin" className={({ isActive }) => clsx('nav-link text-apple-purple', isActive && 'bg-apple-purple/10')}>
                  Admin
                </NavLink>
              )}
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Realtime connection indicator */}
          <ConnectionStatus />

          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            className="btn-icon w-9 h-9 text-sm"
            title={`Theme: ${theme}`}
          >
            {themeIcon}
          </button>

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-pill bg-dark-surface2 border border-dark-separator hover:bg-dark-surface3 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-apple-blue flex items-center justify-center text-xs font-bold">
                  {(user.name || user.email)[0].toUpperCase()}
                </div>
                <span className="text-subhead font-medium text-dark-label1 hidden sm:block">
                  {user.name || user.email.split('@')[0]}
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className={clsx('text-dark-label2 transition-transform duration-150', menuOpen && 'rotate-180')}>
                  <path d="M6 8L1 3h10L6 8z" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  {/* Full-screen backdrop — catches all outside clicks including touch */}
                  <div
                    className="fixed inset-0 z-10"
                    onMouseDown={() => setMenuOpen(false)}
                    onTouchStart={() => setMenuOpen(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-2 w-52 bg-dark-surface1 border border-dark-separator rounded-apple-lg shadow-apple-lg z-20 overflow-hidden"
                    style={{ animation: 'fadeSlideDown 0.12s ease' }}
                  >
                      <div className="px-4 py-3 border-b border-dark-separator">
                        <p className="text-footnote font-semibold text-dark-label1 truncate">{user.name || 'User'}</p>
                        <p className="text-caption1 text-dark-label2 truncate">{user.email}</p>
                      </div>
                      <div className="p-1">
                        {[
                          { to: '/dashboard', label: 'Dashboard' },
                          { to: '/settings', label: 'Settings' },
                          ...(user.role === 'ADMIN' ? [{ to: '/admin', label: '⚡ Admin Panel' }] : []),
                        ].map(({ to, label }) => (
                          <Link
                            key={to}
                            to={to}
                            className="block px-3 py-2 text-subhead text-dark-label1 hover:bg-dark-surface2 rounded-apple transition-colors"
                          >
                            {label}
                          </Link>
                        ))}
                        <button
                          onClick={handleLogout}
                          className="w-full text-left px-3 py-2 text-subhead text-apple-red hover:bg-apple-red/10 rounded-apple transition-colors mt-1"
                        >
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="btn-ghost py-2 px-4 text-subhead">Sign In</Link>
              <Link to="/register" className="btn-primary py-2 px-4 text-subhead">Get Started</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
