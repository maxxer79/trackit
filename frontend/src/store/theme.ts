import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light' | 'system';

export type Accent = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'teal' | 'red' | 'indigo';

export const ACCENTS: { id: Accent; name: string; rgb: string }[] = [
  { id: 'blue', name: 'Blue', rgb: '0 113 227' },
  { id: 'purple', name: 'Purple', rgb: '175 82 222' },
  { id: 'green', name: 'Green', rgb: '48 199 89' },
  { id: 'orange', name: 'Orange', rgb: '255 149 0' },
  { id: 'pink', name: 'Pink', rgb: '255 45 85' },
  { id: 'teal', name: 'Teal', rgb: '50 173 230' },
  { id: 'red', name: 'Red', rgb: '255 59 48' },
  { id: 'indigo', name: 'Indigo', rgb: '88 86 214' },
];

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  accent: Accent;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'dark' | 'light') {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
}

function applyAccent(accent: Accent) {
  document.documentElement.setAttribute('data-accent', accent);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      resolvedTheme: 'dark',
      accent: 'blue',

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme;
        applyTheme(resolved);
        set({ theme, resolvedTheme: resolved });
      },

      setAccent: (accent) => {
        applyAccent(accent);
        set({ accent });
      },
    }),
    {
      name: 'trackit-theme',
      // Re-apply the persisted accent (and theme class) once it's rehydrated,
      // so a reload keeps the chosen look.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyTheme(state.theme === 'system' ? getSystemTheme() : state.theme);
        applyAccent(state.accent ?? 'blue');
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const store = useThemeStore.getState();
    if (store.theme === 'system') {
      const resolved = e.matches ? 'dark' : 'light';
      applyTheme(resolved);
      useThemeStore.setState({ resolvedTheme: resolved });
    }
  });
}
