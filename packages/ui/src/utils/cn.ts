/**
 * Class name utility — NativeWind compatible
 *
 * Merges class names, handles conditional classes, Tailwind conflicts.
 * Lightweight alternative to clsx/tailwind-merge for RN.
 */

type ClassValue = string | number | boolean | undefined | null | ClassValue[] | Record<string, boolean | undefined | null>;

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string' || typeof input === 'number') {
      classes.push(String(input));
    } else if (Array.isArray(input)) {
      classes.push(cn(...input));
    } else if (typeof input === 'object') {
      for (const [key, value] of Object.entries(input)) {
        if (value) classes.push(key);
      }
    }
  }

  // Simple Tailwind conflict resolution: last class wins for same utility
  // This is a simplified version; for production consider tailwind-merge
  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = classes.length - 1; i >= 0; i--) {
    const cls = classes[i].trim();
    if (!cls) continue;

    // Extract utility prefix (e.g., "bg-" from "bg-primary")
    const prefixMatch = cls.match(/^([a-z-]+)-/);
    const prefix = prefixMatch?.[1];

    if (prefix && seen.has(prefix)) continue;

    if (prefix) seen.add(prefix);
    result.unshift(cls);
  }

  return result.join(' ');
}

// Variant helper for component APIs
export function variant<T extends Record<string, Record<string, string>>>(
  base: string,
  variants: T
): (props: { [K in keyof T]?: string } & { className?: string }) => string {
  return (props) => {
    const { className, ...variantProps } = props;
    const variantClasses = Object.entries(variantProps)
      .map(([key, value]) => variants[key]?.[value])
      .filter(Boolean)
      .join(' ');
    return cn(base, variantClasses, className);
  };
}