/**
 * NativeWind v4 ThemeProvider
 *
 * Handles light/dark theme switching with persistence.
 * Uses React Context + expo-secure-store for persistence.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import * as SecureStore from 'expo-secure-store';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: 'light' | 'dark';
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'damz_theme_mode';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  // Load persisted mode on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored && ['light', 'dark', 'system'].includes(stored)) {
          setModeState(stored as ThemeMode);
        }
      } catch {
        // SecureStore not available (web, testing)
      }
      setMounted(true);
    })();
  }, []);

  // Resolve theme from mode + system preference
  useEffect(() => {
    if (!mounted) return;

    const resolve = (m: ThemeMode) => {
      if (m === 'system') {
        return Appearance.getColorScheme() ?? 'light';
      }
      return m;
    };

    const theme = resolve(mode);
    setResolvedTheme(theme);

    // Apply to document for NativeWind darkMode: 'class'
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, [mode, mounted]);

  // Listen for system theme changes
  useEffect(() => {
    if (!mounted || mode !== 'system') return;

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      const theme = colorScheme ?? 'light';
      setResolvedTheme(theme);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }
    });

    return () => subscription?.remove?.();
  }, [mode, mounted]);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, newMode);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleTheme = useCallback(async () => {
    const next = resolvedTheme === 'light' ? 'dark' : 'light';
    await setMode(next);
  }, [resolvedTheme, setMode]);

  if (!mounted) {
    return null; // Or render a loading skeleton
  }

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, mode, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useColorScheme(): 'light' | 'dark' {
  const { theme } = useTheme();
  return theme;
}