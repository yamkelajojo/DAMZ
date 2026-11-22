/**
 * @damz/ui — Shared Design System
 *
 * Public surface. Only modules that actually exist are re-exported, so the
 * package typechecks and an import of a missing component fails at the import
 * site rather than being advertised here and failing at build time.
 *
 * Still to be built (planned surface, kept here so the intent is not lost):
 * - Primitives: Tooltip, Dialog, Avatar, Badge, Separator, ScrollView, View,
 *   Text, Image, Pressable, ActivityIndicator, RefreshControl, Switch,
 *   Checkbox, RadioGroup, Slider, Progress, Skeleton, TabBar, NavigationBar
 * - Composites: OrderCard, PriceListItem, ProofViewer, RunnerCard, ItemPicker,
 *   AddressInput, PaymentScreen, ChatBubble, EmptyState, ErrorBoundary
 * - Hooks: useAnimatedStyle, usePressable, useKeyboard, useSafeArea,
 *   useOrientation (theme hooks live in `./theme/ThemeProvider`)
 * - Utilities: format, accessibility
 *
 * Add each export in the same change that adds its module.
 */

// Re-export NativeWind v4 theme setup (including `useTheme`)
export { ThemeProvider, useTheme, useColorScheme } from './theme/ThemeProvider';

// Tokens (TypeScript constants for non-CSS usage)
export * from './tokens';

// Primitives
export * from './components/ui/Button';
export * from './components/ui/Input';
export * from './components/ui/Card';
export * from './components/ui/Sheet';
export * from './components/ui/Toast';

// Utilities
export * from './utils/cn';
