/**
 * App-level Tailwind entry point.
 *
 * Design tokens have exactly one source of truth: the generated config in
 * `@damz/ui` (see `packages/ui/scripts/generate-tailwind-config.ts`). Spread
 * rather than listed as a preset so `presets` — which must keep NativeWind's own
 * preset in the chain — survives the merge.
 *
 * `content` is restated because Tailwind resolves those globs relative to the
 * directory the bundler runs in (this app), not the package the config came from.
 */
module.exports = {
  ...require('@damz/ui/tailwind.config.js'),
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
};
