/** @type {import('tailwindcss').Config} */
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
          primary: '#FFD801',
          primaryPressed: '#E6C200',
          black: '#020101',
          white: '#FFFFFF',
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
