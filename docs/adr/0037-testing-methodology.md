# ADR-0037: Testing Methodology and Tool Selection

**Status**: Accepted

## Context

The testing strategy (V-Model + STLC, Maestro vs Detox, OWASP MASVS, narvy-cli) is documented in `DB_ARC_and_TEST_PLANNING.md` Part II but has no ADR. Every major architectural decision must be recorded in an ADR.

## Decision

Adopt the following testing methodology and tools as the project standard:

### Methodology: V-Model + STLC

- **V-Model**: Each development phase on the left has a corresponding verification phase on the right. Testing activities are planned in parallel with development, not after.
- **STLC Phases**: Requirement Analysis → Test Planning → Test Case Design → Test Environment Setup → Test Execution → Test Cycle Closure
- **Rationale**: Safety-critical components (Monero payments, location proofs, encrypted storage) require early test planning. Security testing must be integrated at every level.

### Tool Selection

| Layer | Tool | Rationale |
|-------|------|-----------|
| **Unit Testing** | Jest + React Native Testing Library (RNTL) | Default RN test runner; tests component behavior not implementation; TypeScript native |
| **Integration Testing** | Jest + RNTL + Mocked Native Modules | Verifies multi-component flows (Signal+Tor, Monero+UI, Proof bundle creation) |
| **E2E Testing** | **Maestro (v1)** → Detox (fallback) | Maestro: YAML-based, minimal setup, cross-platform, readable by non-developers. Detox: fallback if Maestro flaky on Tor flows |
| **Security Verification** | OWASP MASVS (8 categories, 24 controls) | Industry standard for mobile app security; maps to DAMZ threat model |
| **SAST** | `narvy-cli` | Free, local, no account required; finds hardcoded secrets, weak crypto, insecure config, SSRF, injection |
| **Contract Testing** | OpenAPI (Admin API) + JSON Schema (Relay) + libsignal test vectors + Monero test vectors | Client/server compatibility without integration environment |

### Test Case Design Techniques

- **Equivalence Partitioning**: Monero amount validation (≤0, 0-10000, >10000)
- **Boundary Value Analysis**: Order expiry timer (899s, 900s, 901s)
- **Decision Tables**: Delivery confirmation (4 conditions → 16 combinations)
- **State Transition Testing**: Order state machine (8 states, valid/invalid edges)

### Test Environments

| Environment | Purpose |
|-------------|---------|
| Local (Jest) | Unit + integration |
| Monero Stagenet | Payment flow testing |
| Tor Testnet | Transport testing |
| Android Emulator / iOS Simulator | E2E + UI |
| Physical Device (GrapheneOS Pixel, iPhone) | Security + biometric testing |

### CI/CD Integration

Pipeline stages (must pass in order):
1. Lint + Type Check
2. Unit Tests (with coverage)
3. Integration Tests
4. Contract Tests (OpenAPI, Relay schema, libsignal vectors, Monero vectors)
5. Security Scan (`narvy-cli` — **fails pipeline on any finding**)
6. Build APK/IPA (EAS)
7. E2E Tests (Maestro)
8. Coverage Gate (fail if <70% on core modules)

**Consequences**:
- All code must have test cases enumerated before implementation
- Security scan is a hard gate — no exceptions
- Contract tests run in CI without requiring deployed services
- Maestro flows cover all 13 customer screens, 13 runner screens, converter tab, dispute flow, wallet flow, error states