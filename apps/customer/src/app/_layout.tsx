import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from '@damz/ui';

/**
 * Root layout.
 *
 * `ThemeProvider` owns the light / dark / system preference (persisted through
 * `expo-secure-store`) and exposes it to every screen through `useTheme`.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
