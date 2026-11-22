# ADR-0017: Monorepo: Turborepo + Expo + Cargo Workspaces

**Status**: Accepted

## Context

SPEC shows `apps/` + `packages/` + `services/` structure. Grilling confirmed Turborepo for its cross-language task graph, remote caching, and industry adoption.

## Decision

Use Turborepo for task orchestration across TypeScript (Expo apps, shared packages) and Rust (services).

## Consequences

- **Root `package.json`**: Turborepo config, workspaces for `apps/*`, `packages/*`.
- **Root `Cargo.toml`**: `[workspace]` for `services/admin`, `services/relay`, `services/gateway`, `services/pinner`.
- **`turbo.json`**:
  ```json
  {
    "pipeline": {
      "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "target/**"] },
      "lint": { "outputs": [] },
      "typecheck": { "outputs": [] },
      "test": { "outputs": ["coverage/**"], "dependsOn": [] },
      "db:generate": { "outputs": ["packages/db/src/generated/**"] }
    }
  }
  ```
- **Expo apps**: `apps/customer`, `apps/runner`, `apps/converter` each have `app.json`, `package.json`, `tsconfig.json`.
- **Shared packages**: `packages/core` (crypto, Tor, Signal, Monero, ZK, IPFS), `packages/ui` (React Native components), `packages/types` (TypeScript interfaces, Zod schemas).
- **Services**: Each Rust service is a Cargo package. `cargo build --release` produces static binaries for deployment.
- **CI**: GitHub Actions runs `turbo run build lint typecheck test` with remote caching.
- **DB schema**: `packages/db` uses `sqlx` for compile-checked SQL (Rust) + TypeScript types generated via `sqlx-cli` or custom script.

## Addendum (2026-10-17)

The `sqlx`-derived TypeScript codegen above was never implemented, and ADR-0043 replaced it
as the client contract: the checked-in WatermelonDB schema, models, and shared Zod types are
now the source of truth, so there is no generated type layer to derive. The dead `db:generate`
task (which pointed at a non-existent `packages/db/scripts/generate.ts`) has been removed from
the root `package.json`, `turbo.json`, `packages/db`, `apps/customer`, and `apps/runner`. The
`db:generate` entry remains only in this ADR's original `turbo.json` snippet, which is left
intact as the historical record.

## Addendum (2026-10-17) — packages the isolated linker forces us to declare

Bun's default linker is *isolated*: a workspace's `node_modules` exposes only the
dependencies that workspace declares, and each package's transitive dependencies live
under `node_modules/.bun/<pkg>@<ver>+<hash>/node_modules/`. npm and yarn v1 would have
hoisted these to the root, so packages that were only ever reachable by accident still
resolve there but not here.

The rule that follows: **anything referenced by name from a config file must be a
declared dependency of the workspace that resolves it.** Wiring the app toolchain
(`babel.config.js` / `metro.config.js` / `tailwind.config.js`) surfaced three violations,
each fixed at the level where the name is resolved:

1. `babel-preset-expo` — `expo` depends on it, but `babel.config.js` names it, so each app
   declares it (`~57.0.13`, matching `expo`'s own spec).
2. `@babel/plugin-transform-react-jsx` — a phantom dependency of
   `react-native-css-interop`'s Babel preset. Babel resolves plugins declared *inside a
   preset* against the preset's ancestor `node_modules` directories, so it is declared at
   the repository root; the reason is recorded in each app's `babel.config.js`.
3. `react-native-css-interop` — the compiled JSX output `require`s
   `react-native-css-interop/jsx-runtime` directly, making it a genuine runtime dependency
   of every app. Each app declares it pinned to `0.2.7`, matching `nativewind`'s exact pin
   so both resolve to a single copy.

Verified rather than assumed: a dev-mode bundle (`expo export --dev`, which retains module
paths) contains exactly one copy of `react@19.2.3`, `react-native@0.86.3`, `nativewind@4.2.7`
and `react-native-css-interop@0.2.7`, even though the store holds several hashed copies of
the latter two. NativeWind's `cssInterop` registry is therefore not split across instances.
Re-check with that bundle if these versions or the linker mode ever change.