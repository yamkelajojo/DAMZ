# UI stack: React Native Reusables + NativeWind + Reanimated 3

**Status**: accepted

Build the "nicest friendliest easiest interface ever" with:
- **React Native Reusables** (shadcn/ui for RN): Accessible, composable primitives (Button, Input, Dialog, Sheet, Toast, Tooltip, etc.). Copy-paste customizable.
- **NativeWind** (Tailwind CSS in RN): JIT compiler, design tokens as Tailwind config, dark/light mode via `media` or `class` strategy. Fast iteration.
- **Reanimated 3**: Worklet-based 60fps animations on UI thread. Shared values, `useAnimatedStyle`, `withTiming`/`withSpring`/`withSequence`. Gesture Handler for swipe/drag/pan.

**Context**: User wants premium consumer-app feel, not privacy-tool aesthetic. Grilling selected the stack used by Linear, Cal.com, and other design-forward RN apps.

**Consequences**:
- **Design tokens in `tailwind.config.js`**: Colors (semantic: `primary`, `surface`, `on-surface`), spacing, radius, shadows, fonts. No hardcoded values in components.
- **Reusables components**: Copy into `packages/ui/src/components/`. Customize per DAMZ brand (warm, human, approachable). No `className` overrides — extend via `tailwind.config.js`.
- **Animation philosophy**: Every interaction has feedback. Button press → scale 0.98. Sheet enter → spring from bottom. List reorder → smooth reflow. No jank.
- **Skia escape hatch**: If Reanimated + NativeWind can't achieve an effect (complex shader, blur glass morphism), drop to `@shopify/react-native-skia` for that component only.
- **Storybook/Playground**: Develop components in isolation at 60fps on device. `rnx-kit` or `storybook-react-native`.
- **Accessibility**: Reusables primitives are accessible by default. Test with VoiceOver/TalkBack every sprint.