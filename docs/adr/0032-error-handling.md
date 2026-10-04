# Centralized Error Handling

**Status**: accepted

ErrorBoundary + error codes → user messages. Consistent UX, easier translation, single source of truth.

**Error Codes** (partial):
| Code | User Message |
|------|--------------|
| TOR_CONNECTION_FAILED | "Connecting to Tor..." with retry button |
| RELAY_UNREACHABLE | "Cannot reach messenger. Retrying..." |
| ADMIN_SERVICE_DOWN | "Service unavailable. Cached data shown." |
| PAYMENT_EXPIRED | "Payment window closed. Order cancelled." |
| PAYMENT_PARTIAL | "Partial payment received. Waiting for remainder." |
| INVALID_ADDRESS | "Invalid Monero address. Please scan QR." |
| ZK_PROOF_FAILED | "Location verification failed. Try again or use coarse location." |
| PHOTO_ATTESTATION_FAILED | "Could not sign photo. Ensure biometric is enrolled." |
| PROOF_REJECTED | "Delivery proof rejected. You can re-upload." |
| INSUFFICIENT_BALANCE | "Insufficient funds. Includes network fee." |
| FEE_TOO_HIGH | "Network fee elevated. Wait or increase fee." |
| SYNC_FAILED | "Balance sync failed. Retrying..." |

**Implementation**: React ErrorBoundary at root. Error code map in `@damz/ui/utils/errors.ts`. Per-screen can override with custom UI.