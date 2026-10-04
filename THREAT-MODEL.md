# DAMZ — Threat Model

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Adversary Model

**Primary Adversaries**:
- **Network-level surveillance**: ISP, state actors observing all traffic to/from device
- **Platform-level surveillance**: Google Play Services, Apple telemetry, app store analysis
- **Server compromise**: Relay, gateway, IPFS pinner, admin service infrastructure
- **Physical device seizure**: Device confiscation while locked

**Capabilities Assumed**:
- Observes all network traffic (metadata, timing, volume)
- Controls malicious relay nodes
- Compromises server infrastructure (but not user devices)
- May attempt a forensic memory capture while an app is unlocked; native wallet handling reduces stale wallet-secret exposure but does not prevent active-operation or privileged live-memory capture
- Cannot break AES-256-GCM, X25519, Ed25519, zk-SNARK soundness
- Cannot extract keys from Secure Enclave / StrongBox

**Out of Scope**:
- Compromised OS (rooted/jailbroken device)
- Hardware key extraction from Secure Enclave/StrongBox
- Rubber-hose cryptanalysis
- Side-channel attacks on device hardware

---

## 2. Attack Surface

| Component | Exposure | Mitigation |
|-----------|----------|------------|
| Tor transport | All network traffic | `react-native-nitro-tor` in-process daemon; no clearnet fallback |
| Signal Protocol | Message content | Double Ratchet + X3DH + Sealed Sender; keys in Secure Store |
| Monero payments | Payment metadata; Runner private view key | AcceptXMR gateway keeps the view key encrypted at rest in view-only config; no spend key |
| ZK location proofs | Runner location | Proof reveals only "within radius"; coordinates never leave device |
| Photo attestation | Delivery evidence | C2PA + device attestation; hardware-bound signing |
| IPFS storage | Proof bundles | Client-side AES-256-GCM; key sent separately over Signal chat |
| Local storage | App data and wallet secrets | SQLCipher for app data; Keychain/Keystore at rest; native `SecureMemory` for wallet-secret access |
| Admin service | Moderation state | Tor-hidden; DID-signed requests; SQLite+SQLCipher; no order data |

---

## 3. Security Properties

| Property | Mechanism | Verified By |
|----------|-----------|-------------|
| **Anonymity** | Tor + no accounts + DIDs | Traffic analysis, narvy SAST |
| **Confidentiality (orders/chats)** | Signal Protocol + SQLCipher | libsignal test vectors, code review |
| **Integrity (proofs)** | Hardware signing + ZK proofs | POE proof verification, attestation check |
| **Unlinkability (payments)** | Monero subaddresses per order | Subaddress derivation test vectors |
| **Forward secrecy (chats)** | Signal Double Ratchet | Session re-keying tests |
| **Ephemerality** | Auto-purge (30d msgs, 90d orders) | Purge job tests, dispute freeze tests |
| **Tamper evidence** | SQLCipher + signed price lists | narvy SAST, signature verification tests |
| **Reduced wallet-secret exposure in unlocked-app memory dumps** | Native `SecureMemory` in both apps, `mlock()`, `secure_memset()`, and no JavaScript wallet-secret values | Planned native buffer lifecycle tests and platform verification (Phases 2–3) |

---

## 4. Residual Risks (Accepted)

### 4.1 Decrypted Messages in Memory

**Risk**: SQLCipher encrypts data at rest, but decrypted message bodies exist in application memory during app operation. A memory dump on a compromised (rooted) device could expose plaintext order chats, delivery addresses, and proof keys.

**Assessment**: 
- Probability: Low (requires rooted device + memory dump during active session)
- Impact: High (full chat history, delivery addresses, proof keys exposed)
- **Accepted under "no rooted devices" assumption**

**Mitigations in Place**:
- Messages purge at 30 days (reduces window)
- Proof keys separate from chat; only retrieved on demand
- No sensitive data in memory when app backgrounded without active orders
- Signal Protocol forward secrecy limits exposure to current session

**Not Mitigated**: ADR-0028 covers Monero wallet secrets only. Decrypted message bodies and other plaintext handled by JavaScript can still be extracted from a rooted or otherwise privileged device; `SecureMemory` is not a universal in-memory decryption boundary.

---

### 4.2 DID Rotation Escapes Bans/Strikes

**Risk**: Banned runners and struck customers can generate a new `did:key` and re-enter the system. Bans and strikes are a deterrent against casual abuse, not an identity system. There is no cryptographic solution without introducing identity verification, which would break the anonymity model.

**Assessment**:
- Probability: High (trivial to generate new `did:key`)
- Impact: Medium (persistent abuser can re-register)
- **Accepted as fundamental property of anonymous design**

**Mitigations in Place**:
- Runner onboarding is invite-only (ADR-0015) — admin pre-creates registry entries
- Runner bans are public (runner directory shows `banned_at`) — community can avoid
- Customer strikes are private (ADR-0005) but three strikes = ban from placing orders
- Reputation/ratings deliberately omitted (no server, self-reported = meaningless)

**Not Mitigated**: Sybil resistance requires identity verification or proof-of-work, both incompatible with v1 scope. Documented honestly in ADR-0005 and GLOSSARY.

---

### 4.3 `zar_reference` Metadata Leak in Swaps Table

**Risk**: The `swaps.zar_reference` column stores a plaintext reference linking a swap to an external P2P platform (XmrBazaar/Haveno trade ID). This creates a metadata correlation: if the external platform is compromised or subpoenaed, the reference links the swap to a specific trade, potentially deanonymizing the user's ZAR↔XMR activity.

**Assessment**:
- Probability: Medium (external platform compromise is plausible)
- Impact: Medium (links on-chain XMR to off-chain ZAR trade)
- **Decision: Document as accepted risk with rationale**

**Rationale for Keeping Plaintext**:
1. **Operational necessity**: Customer support / dispute resolution on XmrBazaar/Haveno requires the trade reference
2. **No user identity in swap table**: Swaps are linked to `persona` (customer/runner) and `direction`, not to real identity
3. **Encryption alternative rejected**: Encrypting with a user-held key adds UX friction (key backup/recovery) for marginal gain — the reference is only useful *with* the external platform's cooperation
4. **Mitigation**: Users can use Haveno (Tor-routed, no KYC) instead of XmrBazaar for stronger unlinkability
5. **Retention**: `swaps` table purges at 90 days (same as orders), limiting exposure window

**Future Improvement (v2)**: Encrypt `zar_reference` with a key derived from the swap's HTLC secret, decryptable only by the swap participant after completion.

---

### 4.4 Native Secure-Memory Limitations

**Risk**: A privileged attacker with kernel-level access can read live memory in the native
module, including a locked buffer. A forensic capture taken while a wallet secret is
actively being used—before `secure_memset()` runs—may also expose it.

**Assessment**: `mlock()` prevents the buffer from being swapped; it does not make the
buffer inaccessible to a kernel-level reader. Immediate zeroization shortens the exposure
window but cannot erase a copy already acquired by an attacker. The control applies to each
app's Monero seed and any persisted spend/private-view keys routed through `SecureMemory`;
it does not eliminate the JavaScript-heap exposure of decrypted messages described in §4.1.

**Residual risk**: Rooted/jailbroken or kernel-compromised devices remain out of scope.
The architecture mitigates stale/swapped wallet-secret exposure, not all forensic memory
dumps or live privileged memory access.

---

## 5. Threat Model Validation

**Internal Red-Team Exercise (2 weeks pre-launch, ADR-0013)**:
1. Tor traffic analysis — confirm no clearnet leaks
2. SQLCipher key extraction attempt on rooted device
3. Signal session compromise (prekey reuse, forward secrecy)
4. ZK proof soundness — synthetic sensor data attacks
5. Monero subaddress linkability across orders
6. Relay compromise simulation
7. Admin service SQL injection, auth bypass, evidence tampering

**Output**: `SECURITY.md` with findings, mitigations, residual risk register

**Post-v1**: Open bug bounty (Immunefi or self-hosted) for v1.1+. Invite Monero/Privacy community audit.