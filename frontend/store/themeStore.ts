'use client';

import { create } from 'zustand';

export type AppTheme = 'dark' | 'light';

type ThemeState = {
  theme: AppTheme;
  hydrated: boolean;
  hydrateTheme: () => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
};

function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('chronos_theme', theme);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  hydrated: false,
  hydrateTheme: () => {
    if (typeof window === 'undefined') return;
    const storedTheme = localStorage.getItem('chronos_theme');
    const theme: AppTheme = storedTheme === 'light' ? 'light' : 'dark';
    applyTheme(theme);
    set({ theme, hydrated: true });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme, hydrated: true });
  },
  toggleTheme: () => {
    const nextTheme: AppTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    set({ theme: nextTheme, hydrated: true });
  },
}));
