# ADR-0045: Authenticated Encrypted Gateway Notifications over the Relay

**Status**: Accepted
**Date**: 2026-11-22

## Context

Before this decision was implemented, the Gateway attempted
`POST /notify/payment` on the relay. The relay did not expose that route, and
the Gateway ignored the request result while logging that notification
succeeded. Sending the JSON payment callback to the relay would also violate
the relay's opaque-ciphertext contract. The mobile relay transport supports
recipient-addressed queueing, but does not provide encryption or authenticate
the sender.

The Runner's `did:key` identity has an Ed25519 verification key and a derived
X25519 key-agreement key. Gateway notifications need both confidentiality to
that Runner and verifiable Gateway authorship. The relay must continue to see
only an opaque envelope.

## Decision

Use a versioned Gateway notification envelope with these properties:

1. The Gateway encrypts the payment event to the Runner's X25519 key using HPKE
   Auth mode (RFC 9180, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM).
   The Gateway's static X25519 key-agreement key is derived from its configured
   Ed25519 `did:key`; the Runner verifies that authenticated HPKE sender against
   the already trusted Gateway DID.
2. The Gateway enqueues only the resulting ciphertext at
   `PUT /blob/{runner_onion_hash}`. The Runner fetches it through
   `GET /inbox/{runner_onion_hash}`, decrypts it locally, persists the event
   ID, and only then acknowledges the relay item. It acts only after HPKE
   authentication succeeds for the trusted Gateway DID.
3. The Gateway DID must be pinned from the existing trusted gateway
   configuration. A public key supplied by an untrusted callback is not a
   trust anchor.
4. Do not treat a notification as enqueued until the relay returns `202`. An
   inbox item stays queued until Runner acknowledges it after durable storage,
   so a crash before storage or acknowledgement causes redelivery. Durable
   event-ID deduplication makes that safe. Payment status remains queryable
   through the Gateway for reconciliation and recovery if the in-memory relay
   loses its queue.

The relay does not authenticate inbox pollers. A party that knows the public
recipient hash can retrieve the blob ID and issue its acknowledgement, causing
an availability loss, but cannot read or forge a valid Gateway event. The
relay also keeps its queue in memory and loses it on restart. These are
documented residual limitations of the v1 relay protocol.

## Required implementation gates

- Store the Runner DID and onion recipient with the payment record; never accept
  those routing values from the payment-confirmation callback. Derive and
  validate the Runner's X25519 key-agreement public key from that DID.
- Load the Gateway Ed25519 seed from deployment secret storage, derive its
  X25519 key-agreement key, and verify at startup that it matches the
  configured Gateway DID.
- Authenticate payment-monitor callbacks with a configured watcher DID,
  timestamp, nonce, and signature over the exact request body before state
  changes. Reject replays.
- Use the identical RFC 9180 Auth-mode suite, `info` context, envelope encoding,
  and sender-DID key derivation in Rust Gateway code and the mobile client. Run
  cross-language interoperability in both directions before enabling push.
- If encryption, signature verification, relay enqueue, local decryption,
  durable storage, or relay acknowledgement fails, report the failure; never
  log success or expose plaintext to the relay.
- Configure a private Gateway-to-relay HTTP address separately from the
  Runner-facing onion URL. Do not assume `reqwest` can resolve `.onion` names.

## Consequences

- Payment confirmation can notify a Runner without disclosing payment details
  to the relay or Tor transport, and the authenticated HPKE envelope proves it
  came from the configured Gateway DID.
- Runner notification keys are bound to the existing DID identity and must be
  protected by platform secure storage.
- The Gateway callback is disabled by default. Operators must leave it disabled
  until all authentication, key matching, replay-store, and Rust/mobile
  interoperability gates pass; only then may they set
  `GATEWAY_PAYMENT_NOTIFICATIONS_ENABLED=true`.
- Runner can safely retry an unacknowledged relay item after a crash. The
  existing HTTP status endpoint remains the reconciliation path if the
  in-memory relay loses a queued item or an unauthenticated poller acknowledges
  it.

## References

- RFC 9180: Hybrid Public Key Encryption.
- `services/relay/SPEC.md`: opaque ciphertext and recipient inbox contract.
- `packages/core/src/did/DIDManager.ts`: `did:key` identity and DID resolution.
- `packages/core/src/relay/RelayClient.ts`: Tor relay transport boundary.
