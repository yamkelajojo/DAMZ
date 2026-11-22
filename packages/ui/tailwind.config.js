/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: packages/ui/scripts/generate-tailwind-config.ts
 * Regenerate: bun run tailwind:generate   (from packages/ui)
 *
 * `@type {import('tailwindcss').Config}`
 */
module.exports = {
  // NativeWind v4 refuses to start unless its own preset is in the presets
  // chain ("Tailwind CSS has not been configured with the NativeWind preset"),
  // so it is listed ahead of the generated keys.
  presets: [require('nativewind/preset')],
    "content": [
      "./src/**/*.{js,jsx,ts,tsx}",
      "../../apps/*/src/**/*.{js,jsx,ts,tsx}"
    ],
    "darkMode": "class",
    "theme": {
      "extend": {
        "colors": {
          "damz": {
            "primary": "#FFD801",
            "primaryPressed": "#E6C200",
            "black": "#020101",
            "white": "#FFFFFF"
          },
          "bg": {
            "primary": "#FFFCF9",
            "secondary": "#FAF7F4"
          },
          "surface": {
            "primary": "#F0ECE5",
            "elevated": "#FFFFFF",
            "sunken": "#E6DFD6"
          },
          "border": {
            "subtle": "#E6DFD6",
            "DEFAULT": "#DCCFC4",
            "strong": "#CEC0B3"
          },
          "text": {
            "primary": "#020101",
            "secondary": "#6B625C",
            "tertiary": "#7B716A",
            "disabled": "#968D84",
            "inverse": "#FFF9F5",
            "brand": "#FFD801"
          },
          "action": {
            "primary": {
              "bg": "#FFD801",
              "fg": "#020101",
              "pressed": "#E6C200",
              "disabledBg": "#CEC0B3",
              "disabledFg": "#968D84"
            },
            "secondary": {
              "bg": "#FFF3CC",
              "fg": "#B39700",
              "border": "#F0E0A0",
              "pressedBg": "#F0E0A0"
            },
            "destructive": {
              "bg": "#B42318",
              "fg": "#FFFFFF",
              "pressedBg": "#8E1B12"
            }
          },
          "status": {
            "success": {
              "primary": "#2D6A4F",
              "soft": "#E5F1EB",
              "strong": "#1F513B"
            },
            "warning": {
              "primary": "#8A5A00",
              "soft": "#FFF4D6",
              "strong": "#744D00"
            },
            "error": {
              "primary": "#B42318",
              "soft": "#FDE8E7",
              "strong": "#8E1B12"
            }
          },
          "dark": {
            "bg": {
              "primary": "#020101",
              "secondary": "#0A0A0A"
            },
            "surface": {
              "primary": "#1A1A1A",
              "elevated": "#242424",
              "sunken": "#101010"
            },
            "border": {
              "subtle": "#333333",
              "DEFAULT": "#444444",
              "strong": "#555555"
            },
            "text": {
              "primary": "#FFFFFF",
              "secondary": "#E0E0E0",
              "tertiary": "#B0B0B0",
              "disabled": "#888888",
              "inverse": "#020101",
              "brand": "#FFD801"
            },
            "action": {
              "primary": {
                "bg": "#FFD801",
                "fg": "#020101",
                "pressed": "#E6C200",
                "disabledBg": "#555555",
                "disabledFg": "#888888"
              },
              "secondary": {
                "bg": "#2A2500",
                "fg": "#FFE066",
                "border": "#444000",
                "pressedBg": "#3A3300"
              },
              "destructive": {
                "bg": "#E06C5C",
                "fg": "#FFFFFF",
                "pressedBg": "#C05C4C"
              }
            },
            "status": {
              "success": {
                "primary": "#6EC88A",
                "soft": "#1E3D2B",
                "strong": "#9FF0B8"
              },
              "warning": {
                "primary": "#FFD85D",
                "soft": "#3F3400",
                "strong": "#FFEB9A"
              },
              "error": {
                "primary": "#F98070",
                "soft": "#3D1C1A",
                "strong": "#FCBAB6"
              }
            }
          }
        },
        "spacing": {
          "xxs": "4px",
          "xs": "8px",
          "sm": "12px",
          "md": "16px",
          "lg": "20px",
          "xl": "24px",
          "xxl": "32px",
          "xxxl": "40px",
          "huge": "48px",
          "massive": "64px",
          "extreme": "80px",
          "screenPadding": "16px",
          "cardPadding": "16px",
          "cardPaddingComfortable": "20px",
          "sectionGap": "24px",
          "groupGap": "16px",
          "elementGap": "12px",
          "tightGap": "8px",
          "microGap": "4px",
          "inlineGap": "8px",
          "fieldGap": "16px",
          "listItemPadding": "16px",
          "navBarHeight": "56px",
          "tabBarHeight": "56px",
          "stickyBarHeight": "72px",
          "sheetHandleGap": "12px"
        },
        "borderRadius": {
          "xs": "6px",
          "sm": "8px",
          "md": "12px",
          "lg": "16px",
          "xl": "20px",
          "xxl": "24px",
          "pill": "9999px",
          "full": "9999px",
          "input": "12px",
          "button": "12px",
          "buttonPill": "9999px",
          "card": "16px",
          "cardLarge": "20px",
          "sheet": "24px",
          "modal": "24px",
          "chip": "9999px",
          "badge": "9999px",
          "avatar": "9999px",
          "imageFrame": "20px",
          "smallControl": "8px"
        },
        "fontFamily": {
          "primary": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
          "mono": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, monospace"
        },
        "fontSize": {
          "display": [
            "34px",
            {
              "lineHeight": "42px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ],
          "h1": [
            "28px",
            {
              "lineHeight": "36px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ],
          "h2": [
            "24px",
            {
              "lineHeight": "32px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ],
          "h3": [
            "20px",
            {
              "lineHeight": "28px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ],
          "title": [
            "17px",
            {
              "lineHeight": "24px",
              "fontWeight": "600",
              "letterSpacing": "-0.02em"
            }
          ],
          "bodyLarge": [
            "17px",
            {
              "lineHeight": "26px",
              "fontWeight": "400"
            }
          ],
          "body": [
            "16px",
            {
              "lineHeight": "24px",
              "fontWeight": "400"
            }
          ],
          "bodySmall": [
            "14px",
            {
              "lineHeight": "22px",
              "fontWeight": "400"
            }
          ],
          "label": [
            "14px",
            {
              "lineHeight": "20px",
              "fontWeight": "500",
              "letterSpacing": "0.02em"
            }
          ],
          "labelStrong": [
            "14px",
            {
              "lineHeight": "20px",
              "fontWeight": "600",
              "letterSpacing": "0.02em"
            }
          ],
          "buttonPrimary": [
            "14px",
            {
              "lineHeight": "20px",
              "fontWeight": "600",
              "letterSpacing": "0.02em"
            }
          ],
          "caption": [
            "12px",
            {
              "lineHeight": "16px",
              "fontWeight": "500"
            }
          ],
          "micro": [
            "11px",
            {
              "lineHeight": "14px",
              "fontWeight": "500"
            }
          ],
          "price": [
            "20px",
            {
              "lineHeight": "28px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ],
          "priceLarge": [
            "28px",
            {
              "lineHeight": "36px",
              "fontWeight": "700",
              "letterSpacing": "-0.02em"
            }
          ]
        },
        "fontWeight": {
          "black": "900",
          "extrabold": "800",
          "bold": "700",
          "semibold": "600",
          "medium": "500",
          "regular": "400",
          "light": "300"
        },
        "letterSpacing": {
          "tight": "-0.02em",
          "tighter": "-0.04em",
          "normal": "0",
          "wide": "0.02em",
          "wider": "0.06em",
          "widest": "0.08em"
        },
        "boxShadow": {
          "level0": "none",
          "level1": "0 1px 3px rgba(2, 1, 1, 0.05)",
          "level2": "0 4px 8px rgba(2, 1, 1, 0.08)",
          "level3": "0 8px 16px rgba(2, 1, 1, 0.12)",
          "level4": "0 12px 24px rgba(2, 1, 1, 0.15)"
        },
        "transitionDuration": {
          "fast": "150ms",
          "normal": "200ms",
          "slow": "300ms"
        },
        "transitionTimingFunction": {
          "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)"
        }
      }
    },
    "plugins": []
};
