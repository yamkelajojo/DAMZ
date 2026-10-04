# ADR-0034: Build & CI/CD Pipeline

**Status**: Accepted

## Context

Need reproducible builds for F-Droid, Hermes bytecode, EAS for builds, GitHub Actions for CI.

## Decision

Reproducible builds for F-Droid. Hermes bytecode. EAS for builds. GitHub Actions for CI.

## Consequences

**Monorepo**: Turborepo + Bun workspaces + Cargo workspaces
- `apps/*` (Expo), `packages/*` (TS), `services/*` (Rust)

**Pipeline** (GitHub Actions):
1. Lint + Typecheck (`turbo run lint typecheck`)
2. Unit Tests (`turbo run test`)
3. Integration Tests (`turbo run test:integration`)
4. Security Scan (`narvy-cli` on APK/IPA)
5. Build Android APK + iOS IPA (EAS)
6. E2E Tests (Maestro on emulator/simulator)
7. Contract Tests (Admin API OpenAPI + Relay blob schema)
8. Coverage Gate (fail if <70% on core)
9. Deploy: APK to GitHub Releases, metadata to F-Droid

**Requirements**:
- Reproducible builds for F-Droid (mandatory)
- Hermes bytecode compilation
- AGPL-3.0 license

**Expo Config**: `app.json` with plugins (expo-router, expo-secure-store, expo-sqlite, react-native-nitro-tor), NativeWind, New Architecture enabled.