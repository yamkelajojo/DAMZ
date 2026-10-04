/**
 * @damz/ui — Shared Design System
 *
 * Exports:
 * - Tokens (colors, spacing, typography, radius, shadows)
 * - Primitives (Button, Input, Card, Sheet, Toast, Tooltip, etc.)
 * - Composites (OrderCard, PriceListItem, ProofViewer, etc.)
 * - Hooks (useTheme, useColorScheme, useAnimatedStyle)
 * - ThemeProvider (NativeWind v4)
 */

// Re-export NativeWind v4 theme setup
export { ThemeProvider, useColorScheme } from './theme/ThemeProvider';

// Tokens (TypeScript constants for non-CSS usage)
export * from './tokens';

// Primitives
export * from './components/ui/Button';
export * from './components/ui/Input';
export * from './components/ui/Card';
export * from './components/ui/Sheet';
export * from './components/ui/Toast';
export * from './components/ui/Tooltip';
export * from './components/ui/Dialog';
export * from './components/ui/Avatar';
export * from './components/ui/Badge';
export * from './components/ui/Separator';
export * from './components/ui/ScrollView';
export * from './components/ui/View';
export * from './components/ui/Text';
export * from './components/ui/Image';
export * from './components/ui/Pressable';
export * from './components/ui/ActivityIndicator';
export * from './components/ui/RefreshControl';
export * from './components/ui/Switch';
export * from './components/ui/Checkbox';
export * from './components/ui/RadioGroup';
export * from './components/ui/Slider';
export * from './components/ui/Progress';
export * from './components/ui/Skeleton';
export * from './components/ui/TabBar';
export * from './components/ui/NavigationBar';

// Composites (DAMZ-specific)
export * from './components/composite/OrderCard';
export * from './components/composite/PriceListItem';
export * from './components/composite/ProofViewer';
export * from './components/composite/RunnerCard';
export * from './components/composite/ItemPicker';
export * from './components/composite/AddressInput';
export * from './components/composite/PaymentScreen';
export * from './components/composite/ChatBubble';
export * from './components/composite/EmptyState';
export * from './components/composite/ErrorBoundary';

// Hooks
export * from './hooks/useTheme';
export * from './hooks/useAnimatedStyle';
export * from './hooks/usePressable';
export * from './hooks/useKeyboard';
export * from './hooks/useSafeArea';
export * from './hooks/useOrientation';

// Utilities
export * from './utils/cn';
export * from './utils/format';
export * from './utils/accessibility';