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

/**
 * The web-only `darkMode: 'class'` toggle.
 *
 * `document` is reached through `globalThis` with a structural type instead of
 * the DOM lib: this package also builds for React Native, and pulling in `DOM`
 * would let native-only files reference browser globals without a `typeof` guard.
 */
type WebDocument = {
  documentElement: { classList: { toggle: (token: string, force?: boolean) => void } };
};

function applyWebDarkClass(isDark: boolean): void {
  const webDocument = (globalThis as { document?: WebDocument }).document;
  webDocument?.documentElement.classList.toggle('dark', isDark);
}

/**
 * `ColorSchemeName` is `'light' | 'dark' | 'unspecified'` in current React
 * Native, and the appearance APIs may also return `null`/`undefined`; only
 * light and dark are themes.
 */
function toTheme(colorScheme: ColorSchemeName | null | undefined): 'light' | 'dark' {
  return colorScheme === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [mounted, setMounted] = useState(false);
  // Tracked so a change to the OS appearance re-renders. The resolved theme is
  // derived during render rather than mirrored into state: storing it would mean
  // calling setState from an effect, which triggers a second render pass for a
  // value that is already computable (see react.dev, "You Might Not Need an
  // Effect").
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    toTheme(Appearance.getColorScheme()),
  );

  const resolvedTheme: 'light' | 'dark' = mode === 'system' ? systemTheme : mode;

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

  // Listen for system theme changes. setState happens only inside the
  // subscription callback, never directly in the effect body.
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemTheme(toTheme(colorScheme));
    });

    return () => subscription?.remove?.();
  }, []);

  // Apply to the document for NativeWind's `darkMode: 'class'` (web only).
  // Updating an external system is what an effect is for.
  useEffect(() => {
    if (!mounted) return;
    applyWebDarkClass(resolvedTheme === 'dark');
  }, [resolvedTheme, mounted]);

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