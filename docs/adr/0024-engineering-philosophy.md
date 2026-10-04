# Engineering philosophy: Silicon-grade precision, hacker-grade paranoia, delightful UI

**Status**: accepted

No timeline pressure. Build v1 with:
- **Silicon-level engineering**: Zero tolerance for undefined behavior, memory leaks, race conditions. Every crypto primitive tested against vectors. Every state transition exhaustively verified. SQLCipher keys never in memory longer than necessary. Tor circuits monitored. Signal sessions forward-secret.
- **Russian hacker paranoia**: Assume adversary has root on device, controls network, runs malicious relays, compromises server. Design so compromise of any single component yields zero user data. No logs. No analytics. No telemetry. No fallback to clearnet. No central database.
- **Sleek innovation**: First anonymous medicine delivery over Tor + Monero + ZK proofs + hardware attestation. Push the envelope on mobile ZK (Zakura port). First `react-native-libsignal-client` + `react-native-nitro-tor` + `acceptxmr` integration.
- **Delightful UI**: "Nicest friendliest easiest interface ever" — not a privacy-tool aesthetic. Warm, human, approachable. Hides all complexity. Runner and Customer apps feel like premium consumer apps, not opsec tools.

**Consequences**:
- Code quality gates: `narvy-cli` SAST on every commit. `cargo clippy --deny warnings`. TypeScript `strict: true`. Zero `any`. Zero `@ts-ignore`. Zero `unwrap()`/`expect()` in production paths.
- UI library: Must support custom design system, smooth 60fps animations, gesture-driven interactions, dark/light theming, accessibility. Not a generic component library.
- Design process: Design in code (Storybook/Playground), not Figma. Iterate at 60fps on device.
- Documentation: Every ADR is a contract. Every glossary term is precise. `CONTEXT.md` is the source of truth.