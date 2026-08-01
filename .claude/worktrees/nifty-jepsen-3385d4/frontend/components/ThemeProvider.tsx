'use client';

import { ReactNode, useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';

type ThemeProviderProps = {
  children: ReactNode;
};

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useThemeStore((state) => state.theme);
  const hydrated = useThemeStore((state) => state.hydrated);
  const hydrateTheme = useThemeStore((state) => state.hydrateTheme);

  useEffect(() => {
    hydrateTheme();
  }, [hydrateTheme]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [hydrated, theme]);

  return <>{children}</>;
}
