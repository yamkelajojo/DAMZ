# Monero gateway: Custom Rust gateway using AcceptXMR library

**Status**: accepted

Build a custom Monero payment gateway in Rust using the `acceptxmr` library, deployed as a .onion service. Do not use MoneroPay.

**Context**: The grilling session initially chose MoneroPay for simplicity, but then pivoted to AcceptXMR to keep the entire server stack in Rust (admin service + relay + gateway) and avoid running a separate Node.js/Go process.

**Consequences**:
- `acceptxmr` handles subaddress generation (from view key + primary address) and payment watching via monerod RPC.
- You build the HTTP API: `POST /receive` → returns subaddress + amount, `GET /receive/:address` → payment status, callback to relay on confirmation.
- Runs on same VPS as admin service + relay, all Rust, single binary or small set of binaries.
- monerod runs alongside (separate process, RPC over localhost).
- More development effort than MoneroPay, but unified stack, no external service dependency, full control over payment flow.
- View-only mode: gateway only needs view key + primary address; spend key stays offline.