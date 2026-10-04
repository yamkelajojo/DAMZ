# Security validation: Internal red-team + narvy SAST for v1

**Status**: accepted

v1 security validation relies on internal red-team exercise + `narvy-cli` SAST in CI. No third-party pentest or bug bounty at launch.

**Context**: SPEC testing strategy named OWASP MASVS and narvy. Grilling confirmed budget/time constraints favor internal validation for v1, with external review deferred to post-launch.

**Consequences**:
- **narvy-cli**: Runs on every CI build (Stage 4). Fails pipeline on hardcoded secrets, weak crypto, insecure config, SSRF, injection.
- **Internal red-team (2 weeks pre-launch)**:
  1. Tor traffic analysis: confirm no clearnet leaks, correlation resistance.
  2. SQLCipher key extraction: attempt key retrieval from Keychain/Keystore on rooted/jailbroken device.
  3. Signal session compromise: test prekey reuse, forward secrecy, Sealed Sender metadata.
  4. ZK proof soundness: verify `@ajna-inc/poe-proofs` cannot be tricked with synthetic sensor data.
  5. Monero subaddress linkability: confirm unlinkability across orders.
  6. Relay compromise simulation: malicious relay sees only encrypted blobs + recipient onion hashes.
  7. Admin service: SQL injection, auth bypass, dispute evidence tampering.
- **Output**: `SECURITY.md` with findings, mitigations, and residual risk register.
- **Post-v1**: Open bug bounty (Immunefi or self-hosted) for v1.1+. Invite Monero/Privacy community audit.