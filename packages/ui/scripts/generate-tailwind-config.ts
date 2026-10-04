#!/usr/bin/env bun
/**
 * Generate tailwind.config.js from checkstar theme tokens with DAMZ overrides.
 * Run: bun run scripts/generate-tailwind-config.ts
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

// DAMZ Brand Overrides
const DAMZ_PRIMARY = '#FFD801';    // Yellow/Gold
const DAMZ_BLACK = '#020101';      // Near-black
const DAMZ_WHITE = '#FFFFFF';

// Checkstar's neutral scale (warm grays) - preserved for semantic tokens
const neutral = {
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
  white: '#FFFFFF',
  black: '#000000',
};

// DAMZ semantic colors derived from checkstar structure
const light = {
  background: {
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
    primary: DAMZ_BLACK,
    secondary: neutral.warm900,
    tertiary: neutral.warm800,
    disabled: neutral.warm700,
    inverse: neutral.dark0,
    brand: DAMZ_PRIMARY,
  },
  action: {
    primary: {
      background: DAMZ_PRIMARY,
      foreground: DAMZ_BLACK,
      pressed: '#E6C200',
      disabledBackground: neutral.warm500,
      disabledForeground: neutral.warm700,
    },
    secondary: {
      background: '#FFF3CC',
      foreground: '#B39700',
      border: '#F0E0A0',
      pressedBackground: '#F0E0A0',
    },
    destructive: {
      background: '#B42318',
      foreground: neutral.white,
      pressedBackground: '#8E1B12',
    },
  },
  status: {
    success: {
      primary: '#2D6A4F',
      soft: '#E5F1EB',
      strong: '#1F513B',
    },
    warning: {
      primary: '#8A5A00',
      soft: '#FFF4D6',
      strong: '#744D00',
    },
    error: {
      primary: '#B42318',
      soft: '#FDE8E7',
      strong: '#8E1B12',
    },
  },
  overlay: 'rgba(2, 1, 1, 0.4)',
};

const dark = {
  background: {
    primary: DAMZ_BLACK,
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
    primary: DAMZ_WHITE,
    secondary: '#E0E0E0',
    tertiary: '#B0B0B0',
    disabled: '#888888',
    inverse: DAMZ_BLACK,
    brand: DAMZ_PRIMARY,
  },
  action: {
    primary: {
      background: DAMZ_PRIMARY,
      foreground: DAMZ_BLACK,
      pressed: '#E6C200',
      disabledBackground: '#555555',
      disabledForeground: '#888888',
    },
    secondary: {
      background: '#2A2500',
      foreground: '#FFE066',
      border: '#444000',
      pressedBackground: '#3A3300',
    },
    destructive: {
      background: '#E06C5C',
      foreground: neutral.white,
      pressedBackground: '#C05C4C',
    },
  },
  status: {
    success: {
      primary: '#6EC88A',
      soft: '#1E3D2B',
      strong: '#9FF0B8',
    },
    warning: {
      primary: '#FFD85D',
      soft: '#3F3400',
      strong: '#FFEB9A',
    },
    error: {
      primary: '#F98070',
      soft: '#3D1C1A',
      strong: '#FCBAB6',
    },
  },
  overlay: 'rgba(0, 0, 0, 0.6)',
};

// Spacing scale (4pt base grid from checkstar)
const spacing = {
  xxs: '4px',
  xs: '8px',
  sm: '12px',
  md: '16px',
  lg: '20px',
  xl: '24px',
  xxl: '32px',
  xxxl: '40px',
  huge: '48px',
  massive: '64px',
  extreme: '80px',
};

// Radius scale from checkstar
const radius = {
  xs: '6px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  pill: '9999px',
  full: '9999px',
};

// Typography from checkstar (system font)
const fontFamily = {
  primary: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
};

const fontSize = {
  display: ['34px', { lineHeight: '42px', fontWeight: '700', letterSpacing: '-0.02em' }],
  h1: ['28px', { lineHeight: '36px', fontWeight: '700', letterSpacing: '-0.02em' }],
  h2: ['24px', { lineHeight: '32px', fontWeight: '700', letterSpacing: '-0.02em' }],
  h3: ['20px', { lineHeight: '28px', fontWeight: '700', letterSpacing: '-0.02em' }],
  title: ['17px', { lineHeight: '24px', fontWeight: '600', letterSpacing: '-0.02em' }],
  bodyLarge: ['17px', { lineHeight: '26px', fontWeight: '400' }],
  body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
  bodySmall: ['14px', { lineHeight: '22px', fontWeight: '400' }],
  label: ['14px', { lineHeight: '20px', fontWeight: '500', letterSpacing: '0.02em' }],
  labelStrong: ['14px', { lineHeight: '20px', fontWeight: '600', letterSpacing: '0.02em' }],
  buttonPrimary: ['14px', { lineHeight: '20px', fontWeight: '600', letterSpacing: '0.02em' }],
  caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
  micro: ['11px', { lineHeight: '14px', fontWeight: '500' }],
  price: ['20px', { lineHeight: '28px', fontWeight: '700', letterSpacing: '-0.02em' }],
  priceLarge: ['28px', { lineHeight: '36px', fontWeight: '700', letterSpacing: '-0.02em' }],
};

// Generate tailwind.config.js
const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    '../../apps/*/src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // DAMZ Brand
        damz: {
          primary: '${DAMZ_PRIMARY}',
          primaryPressed: '#E6C200',
          black: '${DAMZ_BLACK}',
          white: '${DAMZ_WHITE}',
        },
        // Semantic Light
        bg: {
          primary: light.background.primary,
          secondary: light.background.secondary,
        },
        surface: {
          primary: light.surface.primary,
          elevated: light.surface.elevated,
          sunken: light.surface.sunken,
        },
        border: {
          subtle: light.border.subtle,
          DEFAULT: light.border.default,
          strong: light.border.strong,
        },
        text: {
          primary: light.text.primary,
          secondary: light.text.secondary,
          tertiary: light.text.tertiary,
          disabled: light.text.disabled,
          inverse: light.text.inverse,
          brand: light.text.brand,
        },
        action: {
          primary: {
            bg: light.action.primary.background,
            fg: light.action.primary.foreground,
            pressed: light.action.primary.pressed,
            disabledBg: light.action.primary.disabledBackground,
            disabledFg: light.action.primary.disabledForeground,
          },
          secondary: {
            bg: light.action.secondary.background,
            fg: light.action.secondary.foreground,
            border: light.action.secondary.border,
            pressedBg: light.action.secondary.pressedBackground,
          },
          destructive: {
            bg: light.action.destructive.background,
            fg: light.action.destructive.foreground,
            pressedBg: light.action.destructive.pressedBackground,
          },
        },
        status: {
          success: {
            primary: light.status.success.primary,
            soft: light.status.success.soft,
            strong: light.status.success.strong,
          },
          warning: {
            primary: light.status.warning.primary,
            soft: light.status.warning.soft,
            strong: light.status.warning.strong,
          },
          error: {
            primary: light.status.error.primary,
            soft: light.status.error.soft,
            strong: light.status.error.strong,
          },
        },
        // Semantic Dark (NativeWind handles dark: automatically via class strategy)
        dark: {
          bg: {
            primary: dark.background.primary,
            secondary: dark.background.secondary,
          },
          surface: {
            primary: dark.surface.primary,
            elevated: dark.surface.elevated,
            sunken: dark.surface.sunken,
          },
          border: {
            subtle: dark.border.subtle,
            DEFAULT: dark.border.default,
            strong: dark.border.strong,
          },
          text: {
            primary: dark.text.primary,
            secondary: dark.text.secondary,
            tertiary: dark.text.tertiary,
            disabled: dark.text.disabled,
            inverse: dark.text.inverse,
            brand: dark.text.brand,
          },
          action: {
            primary: {
              bg: dark.action.primary.background,
              fg: dark.action.primary.foreground,
              pressed: dark.action.primary.pressed,
              disabledBg: dark.action.primary.disabledBackground,
              disabledFg: dark.action.primary.disabledForeground,
            },
            secondary: {
              bg: dark.action.secondary.background,
              fg: dark.action.secondary.foreground,
              border: dark.action.secondary.border,
              pressedBg: dark.action.secondary.pressedBackground,
            },
            destructive: {
              bg: dark.action.destructive.background,
              fg: dark.action.destructive.foreground,
              pressedBg: dark.action.destructive.pressedBackground,
            },
          },
          status: {
            success: {
              primary: dark.status.success.primary,
              soft: dark.status.success.soft,
              strong: dark.status.success.strong,
            },
            warning: {
              primary: dark.status.warning.primary,
              soft: dark.status.warning.soft,
              strong: dark.status.warning.strong,
            },
            error: {
              primary: dark.status.error.primary,
              soft: dark.status.error.soft,
              strong: dark.status.error.strong,
            },
          },
        },
      },
      spacing: {
        ...spacing,
        // Semantic aliases
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
        navBarHeight: '56px',
        tabBarHeight: '56px',
        stickyBarHeight: '72px',
        sheetHandleGap: spacing.sm,
      },
      borderRadius: {
        ...radius,
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
      },
      fontFamily: {
        primary: fontFamily.primary,
        mono: fontFamily.mono,
      },
      fontSize: {
        ...Object.fromEntries(
          Object.entries(fontSize).map(([key, val]) => [key, val])
        ),
      },
      fontWeight: {
        black: '900',
        extrabold: '800',
        bold: '700',
        semibold: '600',
        medium: '500',
        regular: '400',
        light: '300',
      },
      letterSpacing: {
        tight: '-0.02em',
        tighter: '-0.04em',
        normal: '0',
        wide: '0.02em',
        wider: '0.06em',
        widest: '0.08em',
      },
      boxShadow: {
        level0: 'none',
        level1: '0 1px 3px rgba(2, 1, 1, 0.05)',
        level2: '0 4px 8px rgba(2, 1, 1, 0.08)',
        level3: '0 8px 16px rgba(2, 1, 1, 0.12)',
        level4: '0 12px 24px rgba(2, 1, 1, 0.15)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
};
`;

writeFileSync(resolve(__dirname, '../../tailwind.config.js'), tailwindConfig);
console.log('✅ Generated tailwind.config.js');