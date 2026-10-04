/**
 * DAMZ Design Tokens — TypeScript Constants
 *
 * Single source of truth for design values used in:
 * - NativeWind/Tailwind (via tailwind.config.js)
 * - Reanimated animations
 * - Non-CSS contexts (canvas, Skia, etc.)
 *
 * Generated from checkstar theme with DAMZ overrides:
 * - Primary: #FFD801 (yellow/gold)
 * - Black: #020101 (near-black)
 */

// ============================================================================
// COLOR PRIMITIVES
// ============================================================================

export const brand = {
  primary: '#FFD801',
  primaryPressed: '#E6C200',
  primarySoft: '#FFF3CC',
  primaryDeep: '#B39700',
  black: '#020101',
  white: '#FFFFFF',
} as const;

export const neutral = {
  // Light warm neutrals
  warm50: '#FFFCF9',
  warm100: '#FAF7F4',
  warm200: '#F0ECE5',
  warm300: '#E6DFD6',
  warm400: '#DCCFC4',
  warm500: '#CEC0B3',
  warm600: '#C9BFB7',
  warm700: '#968D84',
  warm800: '#7B716A',
  warm900: '#6B625C',
  warm950: '#1B1816',

  // Dark warm neutrals
  dark950: '#0F0D0C',
  dark900: '#14110F',
  dark800: '#1E1B18',
  dark700: '#2A2622',
  dark600: '#0E0C0A',
  dark500: '#35302A',
  dark400: '#423C35',
  dark300: '#5A524A',
  dark200: '#8A8178',
  dark100: '#B0A8A0',
  dark50: '#D4CCC4',
  dark0: '#FFF9F5',

  // Pure
  white: '#FFFFFF',
  black: '#000000',
} as const;

// Status colors (semantic, not brand)
export const status = {
  success: {
    primary: '#2D6A4F',
    soft: '#E5F1EB',
    strong: '#1F513B',
    darkPrimary: '#6EC88A',
    darkSoft: '#1E3D2B',
  },
  warning: {
    primary: '#8A5A00',
    soft: '#FFF4D6',
    strong: '#744D00',
    darkPrimary: '#FFD85D',
    darkSoft: '#3F3400',
  },
  error: {
    primary: '#B42318',
    soft: '#FDE8E7',
    strong: '#8E1B12',
    darkPrimary: '#F98070',
    darkSoft: '#3D1C1A',
  },
} as const;

// ============================================================================
// SEMANTIC COLOR TOKENS
// ============================================================================

export const lightColors = {
  bg: {
    primary: neutral.warm50,
    secondary: neutral.warm100,
  },
  surface: {
    primary: neutral.warm200,
    elevated: neutral.white,
    sunken: neutral.warm300,
  },
  border: {
    subtle: neutral.warm300,
    default: neutral.warm400,
    strong: neutral.warm500,
  },
  text: {
    primary: brand.black,
    secondary: neutral.warm900,
    tertiary: neutral.warm800,
    disabled: neutral.warm700,
    inverse: neutral.dark0,
    brand: brand.primary,
  },
  action: {
    primary: {
      bg: brand.primary,
      fg: brand.black,
      pressed: brand.primaryPressed,
      disabledBg: neutral.warm500,
      disabledFg: neutral.warm700,
    },
    secondary: {
      bg: brand.primarySoft,
      fg: brand.primaryDeep,
      border: '#F0E0A0',
      pressedBg: '#F0E0A0',
    },
    destructive: {
      bg: status.error.primary,
      fg: neutral.white,
      pressedBg: status.error.strong,
    },
  },
  status: {
    success: status.success,
    warning: status.warning,
    error: status.error,
  },
  overlay: 'rgba(2, 1, 1, 0.4)',
} as const;

export const darkColors = {
  bg: {
    primary: brand.black,
    secondary: '#0A0A0A',
  },
  surface: {
    primary: '#1A1A1A',
    elevated: '#242424',
    sunken: '#101010',
  },
  border: {
    subtle: '#333333',
    default: '#444444',
    strong: '#555555',
  },
  text: {
    primary: brand.white,
    secondary: '#E0E0E0',
    tertiary: '#B0B0B0',
    disabled: '#888888',
    inverse: brand.black,
    brand: brand.primary,
  },
  action: {
    primary: {
      bg: brand.primary,
      fg: brand.black,
      pressed: brand.primaryPressed,
      disabledBg: '#555555',
      disabledFg: '#888888',
    },
    secondary: {
      bg: '#2A2500',
      fg: '#FFE066',
      border: '#444000',
      pressedBg: '#3A3300',
    },
    destructive: {
      bg: '#E06C5C',
      fg: neutral.white,
      pressedBg: '#C05C4C',
    },
  },
  status: {
    success: {
      primary: status.success.darkPrimary,
      soft: status.success.darkSoft,
      strong: '#9FF0B8',
    },
    warning: {
      primary: status.warning.darkPrimary,
      soft: status.warning.darkSoft,
      strong: '#FFEB9A',
    },
    error: {
      primary: status.error.darkPrimary,
      soft: status.error.darkSoft,
      strong: '#FCBAB6',
    },
  },
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

// ============================================================================
// SPACING (4pt base grid)
// ============================================================================

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  massive: 64,
  extreme: 80,
} as const;

export const semanticSpacing = {
  screenPadding: spacing.md,
  cardPadding: spacing.md,
  cardPaddingComfortable: spacing.lg,
  sectionGap: spacing.xl,
  groupGap: spacing.md,
  elementGap: spacing.sm,
  tightGap: spacing.xs,
  microGap: spacing.xxs,
  inlineGap: spacing.xs,
  fieldGap: spacing.md,
  listItemPadding: spacing.md,
  navBarHeight: 56,
  tabBarHeight: 56,
  stickyBarHeight: 72,
  sheetHandleGap: spacing.sm,
} as const;

// ============================================================================
// BORDER RADIUS
// ============================================================================

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 9999,
  full: 9999,
} as const;

export const semanticRadius = {
  input: radius.md,
  button: radius.md,
  buttonPill: radius.pill,
  card: radius.lg,
  cardLarge: radius.xl,
  sheet: radius.xxl,
  modal: radius.xxl,
  chip: radius.pill,
  badge: radius.pill,
  avatar: radius.full,
  imageFrame: radius.xl,
  smallControl: radius.sm,
} as const;

// ============================================================================
// BORDER WIDTHS
// ============================================================================

export const borderWidth = {
  hairline: 0.5,
  thin: 1,
  thick: 2,
  focus: 2,
} as const;

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const fontFamily = {
  primary: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
} as const;

export const fontWeight = {
  black: '900',
  extrabold: '800',
  bold: '700',
  semibold: '600',
  medium: '500',
  regular: '400',
  light: '300',
} as const;

export const letterSpacing = {
  tight: -0.02,
  tighter: -0.04,
  normal: 0,
  wide: 0.02,
  wider: 0.06,
  widest: 0.08,
} as const;

export const textStyle = {
  display: { size: 34, lineHeight: 42, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  h1: { size: 28, lineHeight: 36, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  h2: { size: 24, lineHeight: 32, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  h3: { size: 20, lineHeight: 28, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  title: { size: 17, lineHeight: 24, weight: fontWeight.semibold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  bodyLarge: { size: 17, lineHeight: 26, weight: fontWeight.regular, letterSpacing: letterSpacing.normal, fontFamily: fontFamily.primary },
  body: { size: 16, lineHeight: 24, weight: fontWeight.regular, letterSpacing: letterSpacing.normal, fontFamily: fontFamily.primary },
  bodySmall: { size: 14, lineHeight: 22, weight: fontWeight.regular, letterSpacing: letterSpacing.normal, fontFamily: fontFamily.primary },
  label: { size: 14, lineHeight: 20, weight: fontWeight.medium, letterSpacing: letterSpacing.wide, fontFamily: fontFamily.primary },
  labelStrong: { size: 14, lineHeight: 20, weight: fontWeight.semibold, letterSpacing: letterSpacing.wide, fontFamily: fontFamily.primary },
  buttonPrimary: { size: 14, lineHeight: 20, weight: fontWeight.semibold, letterSpacing: letterSpacing.wide, fontFamily: fontFamily.primary },
  caption: { size: 12, lineHeight: 16, weight: fontWeight.medium, letterSpacing: letterSpacing.normal, fontFamily: fontFamily.primary },
  micro: { size: 11, lineHeight: 14, weight: fontWeight.medium, letterSpacing: letterSpacing.normal, fontFamily: fontFamily.primary },
  price: { size: 20, lineHeight: 28, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
  priceLarge: { size: 28, lineHeight: 36, weight: fontWeight.bold, letterSpacing: letterSpacing.tight, fontFamily: fontFamily.primary },
} as const;

export const semanticText = {
  screenTitle: textStyle.h1,
  sectionTitle: textStyle.h3,
  cardTitle: textStyle.title,
  listTitle: textStyle.title,
  bodyPrimary: textStyle.body,
  bodySecondary: textStyle.bodySmall,
  bodyTertiary: { ...textStyle.caption, weight: fontWeight.regular },
  buttonPrimary: textStyle.labelStrong,
  buttonSecondary: textStyle.label,
  buttonDestructive: textStyle.labelStrong,
  link: { ...textStyle.body, weight: fontWeight.medium },
  inputLabel: textStyle.label,
  inputValue: textStyle.body,
  inputPlaceholder: { ...textStyle.body, weight: fontWeight.regular },
  inputError: { ...textStyle.caption, weight: fontWeight.medium },
  inputHelper: textStyle.caption,
  statusSuccess: { ...textStyle.caption, weight: fontWeight.semibold },
  statusWarning: { ...textStyle.caption, weight: fontWeight.semibold },
  statusError: { ...textStyle.caption, weight: fontWeight.semibold },
  metadata: textStyle.caption,
  timestamp: textStyle.micro,
  price: textStyle.price,
  priceLarge: textStyle.priceLarge,
  brandPrimary: textStyle.title,
  brandSecondary: textStyle.body,
} as const;

// ============================================================================
// ELEVATION / SHADOWS
// ============================================================================

export const elevation = {
  level0: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  level1: {
    shadowColor: brand.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  level2: {
    shadowColor: brand.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  level3: {
    shadowColor: brand.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  level4: {
    shadowColor: brand.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

// ============================================================================
// HIT TARGETS (Accessibility)
// ============================================================================

export const hitTarget = {
  minimum: 44,
  comfortable: 48,
  large: 56,
} as const;

// ============================================================================
// ANIMATION / MOTION
// ============================================================================

export const motion = {
  duration: {
    fast: 150,
    normal: 200,
    slow: 300,
  },
  easing: {
    spring: [0.34, 1.56, 0.64, 1] as const,
    easeOut: [0.25, 0.46, 0.45, 0.94] as const,
    easeIn: [0.55, 0.055, 0.675, 0.19] as const,
    easeInOut: [0.645, 0.045, 0.355, 1] as const,
  },
} as const;

// ============================================================================
// Z-INDEX
// ============================================================================

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  modal: 1300,
  popover: 1400,
  toast: 1500,
  tooltip: 1600,
} as const;

// ============================================================================
// BREAKPOINTS (for container queries)
// ============================================================================

export const breakpoints = {
  xs: 320,
  sm: 375,
  md: 428,
  lg: 768,
  xl: 1024,
  xxl: 1280,
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BrandColor = typeof brand[keyof typeof brand];
export type NeutralColor = typeof neutral[keyof typeof neutral];
export type StatusColor = typeof status[keyof typeof status];
export type SpacingToken = typeof spacing[keyof typeof spacing];
export type RadiusToken = typeof radius[keyof typeof radius];
export type FontWeightToken = typeof fontWeight[keyof typeof fontWeight];
export type TextStyleKey = keyof typeof textStyle;
export type SemanticTextKey = keyof typeof semanticText;