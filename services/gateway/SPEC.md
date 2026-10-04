# Monero Gateway Specification

**Version**: 1.0
**Status**: Approved (Prepared but Not Active in v1)
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Overview

The Monero gateway is a custom Rust service using the `acceptxmr` library, deployed as a Tor-hidden service. It handles subaddress generation and payment watching via monerod RPC.

**Status**: **Prepared but Not Active** in v1. The v1 app uses `MockPaymentProvider` (ADR-0023) with the same interface. This SPEC defines the contract so the real gateway can be dropped in without schema or app changes.

**Stack**: Rust + `acceptxmr` + `monerod` RPC + Axum HTTP server, all behind Tor.

---

## 2. Activation Requirements

To activate the real gateway (replace mock), the following must be deployed:

| Component | Requirement |
|-----------|-------------|
| **MoneroPay / AcceptXMR** | Deploy `acceptxmr` Rust library as HTTP service |
| **Monero node** | `monerod` running on stagenet (testing) → mainnet (production); RPC over localhost |
| **Subaddress generation** | View key + primary address configured in gateway |
| **Payment detection callback** | Gateway → relay → runner app notification flow |
| **Rate oracle** | XMR/ZAR rate source (e.g., XmrBazaar API, Haveno API, or aggregated) |

---

## 3. API Contract

The app communicates with the gateway via the `PaymentProvider` interface (defined in ADR-0023). The gateway implements this HTTP API:

### 3.1 Create Payment Request

```
POST /receive
Content-Type: application/json

{
  "order_id": "uuid-v4",
  "amount_zar": "150.00",
  "rate_xmr_per_zar": "0.00012345",
  "expires_in_seconds": 900
}
```

**Response** (`200 OK`):
```json
{
  "subaddress": "84WsptnLmjTYQjm52SMkhQWsepprkcchNguxdyLkURTSW1WLo3tShTnCRvepijbc2X8GAKPGxJK9hfQhLHzoKSxh7y8Yqrg",
  "amount_xmr": "0.0185175",
  "amount_piconero": "1851750000000",
  "expires_at": 1234567890,
  "payment_id": "internal-gateway-id"
}
```

### 3.2 Check Payment Status

```
GET /receive/{subaddress}
```

**Response** (`200 OK`):
```json
{
  "status": "pending" | "confirmed" | "expired",
  "amount_received_piconero": "1851750000000",
  "confirmations": 0,
  "txid": null | "abc123..."
}
```

- `status`: `pending` (mempool or <3 confirmations), `confirmed` (≥3 confirmations), `expired` (past `expires_at` with insufficient payment)
- `amount_received_piconero`: Total received (handles partial payments)
- `confirmations`: Current blockchain confirmations
- `txid`: Monero transaction ID (set when detected)

### 3.3 Callback to Relay (Payment Confirmed)

When gateway detects ≥3 confirmations, it calls the relay to notify the runner:

```
POST /notify/payment
Content-Type: application/json
X-DAMZ-Signature: <Ed25519 signature of body by gateway DID>

{
  "order_id": "uuid-v4",
  "runner_onion_hash": "sha256-of-runner-tor-pubkey",
  "subaddress": "...",
  "txid": "abc123...",
  "amount_piconero": "1851750000000",
  "confirmed_at": 1234567890
}
```

The relay forwards this encrypted blob to the runner's onion service.

---

## 4. Subaddress Generation Flow

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   App       │────▶│   Gateway    │────▶│  monerod   │
│ (Customer)  │     │ (acceptxmr)  │     │ (RPC)      │
└─────────────┘     └──────────────┘     └────────────┘
      │                    │                    │
      ▼                    ▼                    ▼
  amount_zar         derive_subaddr()      get_new_address()
  rate_xmr_per_zar   (view_key +           (account_index,
  expires_at         primary_addr)          subaddress_index)
                        │                    │
                        └────────────────────┘
                                    │
                                    ▼
                           Returns subaddress
                                    │
                                    ▼
                              App receives subaddr
```

**Key Derivation** (per `acceptxmr`):
- Gateway holds: **Private view key** + **Primary address** (from Runner's wallet setup)
- Subaddress = `derive_subaddress(view_key, primary_address, account_index, subaddress_index)`
- Each order gets unique `(account_index, subaddress_index)` — unlinkable across orders

---

## 5. Key Management

### 5.1 Gateway Wallet (View-Only)

| Key | Location | Protection |
|-----|----------|------------|
| **Primary address** | Gateway config (env var) | Plaintext (public) |
| **Private view key** | Gateway config (env var) | **Encrypted at rest** via `age`/`sops`; decrypted in memory at startup |
| **Private spend key** | **Never on gateway** | Stored offline by Admin (paper/backup) |

**View-only mode**: Gateway can generate subaddresses and detect payments, but **cannot spend**. Spend key stays offline.

### 5.2 Fee Extraction (5% Platform Fee)

**Flow**:
1. Runner receives payment to order subaddress (full amount)
2. Admin periodically (weekly) sweeps runner's wallet:
   - Runner's app shows "Withdraw" with fee preview
   - Runner initiates withdrawal to their cold wallet
   - App constructs TX with 5% fee output to Admin's fee address
   - Runner signs with spend key (biometric unlock)
3. **Alternative (v2)**: Gateway sweeps fees automatically on payment detection (requires spend key on gateway — rejected for v1)

**Admin fee address**: Configured in `platform_settings.fee_address` (synced to devices).

---

## 6. Rate Oracle

| Source | Type | Fallback |
|--------|------|----------|
| **XmrBazaar API** | P2P market rate (ZAR/XMR) | Primary for customer |
| **Haveno API** | DEX order book (ZAR/XMR) | Cross-check |
| **Aggregated median** | Median of above | Used if single source unavailable |

**Rate freshness**: Cached for 5 minutes. App displays "Rate as of HH:MM".

---

## 6. Monero Node Configuration

```bash
# Stagenet (testing)
monerod --stagenet --rpc-bind-port 38081 --rpc-restricted-bind-port 38082 \
  --no-igd --hide-my-port --p2p-bind-port 38080 \
  --rpc-login user:pass

# Mainnet (production)
monerod --rpc-bind-port 18081 --rpc-restricted-bind-port 18082 \
  --no-igd --hide-my-port \
  --rpc-login user:pass
```

Gateway connects via RPC (localhost only, authenticated).

---

## 7. Deployment Guide

### 7.1 Binary

```bash
cargo build --release -p damz-gateway
# Binary: target/release/damz-gateway
```

### 7.2 Tor Hidden Service

Same pattern as relay (ADR-0008, ADR-0034).

### 7.3 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GATEWAY_PORT` | No (default 3001) | HTTP port |
| `MONEROD_RPC_URL` | Yes | `http://user:pass@127.0.0.1:18081/json_rpc` |
| `MONEROD_RPC_USER` | Yes | RPC username |
| `MONEROD_RPC_PASS` | Yes | RPC password |
| `PRIMARY_ADDRESS` | Yes | Runner's primary Monero address |
| `VIEW_KEY_ENCRYPTED` | Yes | `age`-encrypted private view key |
| `VIEW_KEY_PASSPHRASE` | Yes | Passphrase to decrypt view key (injected at deploy) |
| `FEE_ADDRESS` | Yes | Admin's 5% fee collection address |
| `RELAY_ONION_URL` | Yes | Relay URL for payment callbacks |
| `RUST_LOG` | No | Logging level |

### 7.4 Systemd Service

```ini
[Unit]
Description=DAMZ Monero Gateway
After=network-online.target monerod.service tor.service
Wants=monerod.service tor.service

[Service]
Type=simple
User=damz-gateway
ExecStart=/opt/damz/gateway/damz-gateway
EnvironmentFile=/etc/damz/gateway.env
Restart=on-failure
RestartSec=10
MemoryMax=512M
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

---

## 8. v1 Mock Implementation

`MockPaymentProvider` (ADR-0023) implements the same `PaymentProvider` interface with scenarios:
- `success`: Confirmed after 2s
- `timeout`: Expires at 15 min
- `partial`: Partial then full
- `double`: Idempotency test

**Switching to real gateway**: Feature flag `useRealGateway` in settings. No code changes needed.

---

## 9. Testing

### 9.1 Unit Tests
- Subaddress derivation against Monero test vectors
- Amount conversion (ZAR → piconero) with rate precision
- Payment status state machine
- Callback signature verification

### 9.2 Integration Tests (Stagenet)
- Full flow: App → Gateway → monerod → Relay → Runner
- Partial payment handling
- Expiry handling
- Reorg handling (confirmation drop)

### 9.3 Contract Tests
- OpenAPI spec validation in CI
- Test vectors from Monero test suite

---

## 10. Open Questions

- **OQ-GATEWAY-001**: Should gateway support multiple runners (multi-tenant) or single-runner per instance? Current design: single-runner per gateway instance (simpler, matches invite-only onboarding).
- **OQ-GATEWAY-002**: Rate oracle source — XmrBazaar API stability? Need SLA or fallback to Haveno.
- **OQ-GATEWAY-003**: Fee extraction UX — runner-initiated withdrawal (v1) vs automatic sweep (v2)? Current: runner-initiated.