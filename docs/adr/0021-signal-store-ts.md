# Signal Protocol store: TypeScript implementation over expo-sqlite + expo-secure-store

**Status**: accepted

Implement `SignalProtocolStore` interface in TypeScript using `expo-sqlite` (SQLCipher) for prekeys/sessions and `expo-secure-store` for long-term identity keys.

**Context**: `react-native-libsignal-client` requires a custom store. Grilling chose pure TS implementation over native ports for auditability and single codebase.

**Consequences**:
- **Tables** (in same SQLCipher DB as app data, or separate):
  - `signal_prekeys` (signed + unsigned, one-time)
  - `signal_sessions` (Double Ratchet state per recipient)
  - `signal_sender_keys` (group Sender Keys)
  - `signal_identity_keys` (local identity + trusted recipient identities)
- **Secure Store**: `signal_identity_key_pair` (Ed25519), `signal_registration_id` (u16).
- **Interface**: Implement all `SignalProtocolStore` methods: `getIdentityKeyPair`, `getLocalRegistrationId`, `storePreKey`, `loadPreKey`, `removePreKey`, `storeSession`, `loadSession`, `removeSession`, `removeAllSessions`, `storeSenderKey`, `loadSenderKey`, `removeSenderKey`, `isTrustedIdentity`, `saveIdentity`.
- **SQLCipher key**: Same `damz_db_key` from `expo-secure-store` (or separate `signal_db_key` for isolation).
- **Testing**: Unit test each method with `expo-sqlite` mock. Integration test: two `SignalClient` instances exchange messages via mocked relay.