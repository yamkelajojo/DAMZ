# Monorepo: Turborepo + Expo + Cargo workspaces

**Status**: accepted

Use Turborepo for task orchestration across TypeScript (Expo apps, shared packages) and Rust (services).

**Context**: SPEC shows `apps/` + `packages/` + `services/` structure. Grilling confirmed Turborepo for its cross-language task graph, remote caching, and industry adoption.

**Consequences**:
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