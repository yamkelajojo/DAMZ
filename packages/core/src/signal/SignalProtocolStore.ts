/**
 * SignalProtocolStore — TypeScript implementation over expo-sqlite (SQLCipher)
 *
 * Implements the libsignal SignalProtocolStore interface for React Native.
 * Uses expo-sqlite with SQLCipher for encrypted storage and expo-secure-store
 * for long-term identity keys.
 */

import { openDatabaseSync } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { IdentityKeyPair as LibsignalIdentityKeyPair } from 'react-native-libsignal-client';

const DB_NAME = 'damz_signal.db';

/** Signal registration IDs are 16-bit values; 0 is reserved per the spec. */
const MAX_REGISTRATION_ID = 16380;

export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface PreKeyRecord {
  keyId: number;
  keyPair: {
    pubKey: string;
    privKey: string;
  };
}

export interface SessionRecord {
  sessionData: string;
}

export interface SenderKeyRecord {
  senderKeyId: number;
  key: string;
}

export interface SignalAddress {
  name: string;
  deviceId: number;
}

const IDENTITY_KEY_PAIR_KEY = 'signal_identity_key_pair';
const REGISTRATION_ID_KEY = 'signal_registration_id';

export class SignalProtocolStore {
  private db: ReturnType<typeof openDatabaseSync>;
  private dbKey: string;

  constructor(dbKey: string) {
    this.dbKey = dbKey;
    // expo-sqlite silently ignores unknown open options: its native
    // `OpenDatabaseOptions` records have no `key` field and the C++ binding
    // never calls `sqlite3_key`. Passing `{ key: dbKey }` here (as the previous
    // implementation did, via `as any`) left the Signal database — identity
    // keys, sessions, prekeys, sender keys — stored in plaintext.
    this.db = openDatabaseSync(DB_NAME);
    this.applyEncryptionKey();
    this.initTables();
  }

  /**
   * Applies the SQLCipher key and verifies encryption is actually available.
   *
   * `PRAGMA key` must be the first statement on the connection; once a page has
   * been read or written SQLCipher refuses to key the file. The key is supplied
   * as a raw 32-byte hex blob (`x'…'`) matching `getDatabaseKey()` in @damz/db.
   */
  private applyEncryptionKey(): void {
    const hexKey = this.dbKey.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error(
        'SignalProtocolStore: the SQLCipher key must be a 64-character hex string (32 bytes).',
      );
    }

    this.db.execSync(`PRAGMA key = "x'${hexKey}'"`);

    const row = this.db.getFirstSync<Record<string, unknown>>('PRAGMA cipher_version');
    const cipherVersion = row ? Object.values(row)[0] : undefined;
    if (!cipherVersion) {
      throw new Error(
        'SignalProtocolStore: SQLCipher is not available in this expo-sqlite build, so Signal ' +
          'sessions would be stored unencrypted. Enable the expo-sqlite plugin option ' +
          '`useSQLCipher: true` and rebuild the app.',
      );
    }
  }

  private initTables(): void {
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS signal_identity_keys (
        identifier TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS signal_prekeys (
        key_id INTEGER PRIMARY KEY,
        key_data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS signal_sessions (
        identifier TEXT NOT NULL,
        device_id INTEGER NOT NULL,
        session_data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (identifier, device_id)
      );

      CREATE TABLE IF NOT EXISTS signal_sender_keys (
        sender_key_id TEXT NOT NULL,
        key_id INTEGER NOT NULL,
        key_data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (sender_key_id, key_id)
      );
    `);
  }

  // =========================================================================
  // Identity Key Pair (Secure Store)
  // =========================================================================

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    try {
      const stored = await SecureStore.getItemAsync(IDENTITY_KEY_PAIR_KEY, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to access your Signal identity',
      });

      if (stored) {
        return JSON.parse(stored);
      }

      // Generate new Ed25519 key pair
      const keyPair = await this.generateIdentityKeyPair();
      await SecureStore.setItemAsync(IDENTITY_KEY_PAIR_KEY, JSON.stringify(keyPair), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to save your Signal identity',
      });

      return keyPair;
    } catch (error) {
      throw new Error(`Failed to get identity key pair: ${error}`);
    }
  }

  private generateIdentityKeyPair(): IdentityKeyPair {
    // Use libsignal's own Ed25519 identity key pair so the serialized public and
    // private keys are exactly the format the Signal protocol expects.
    //
    // Security: the previous implementation derived a 32-byte seed and returned
    // it as BOTH keys, so `publicKey === privateKey`. Publishing the "public"
    // key therefore disclosed the private key to every peer.
    const keyPair = LibsignalIdentityKeyPair.generate();

    return {
      publicKey: SignalProtocolStore.toBase64(keyPair.publicKey.serialized),
      privateKey: SignalProtocolStore.toBase64(keyPair.privateKey.serialized),
    };
  }

  /**
   * Dependency-free base64 encoder.
   *
   * React Native has no global `Buffer`, so this module cannot rely on it — and
   * it must run identically under Node in tests.
   */
  private static toBase64(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const remaining = bytes.length - i;
      const b0 = bytes[i];
      const b1 = remaining > 1 ? bytes[i + 1] : 0;
      const b2 = remaining > 2 ? bytes[i + 2] : 0;

      out += alphabet[b0 >> 2];
      out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += remaining > 1 ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
      out += remaining > 2 ? alphabet[b2 & 0x3f] : '=';
    }
    return out;
  }

  async getLocalRegistrationId(): Promise<number> {
    try {
      const stored = await SecureStore.getItemAsync(REGISTRATION_ID_KEY, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      if (stored) {
        return parseInt(stored, 10);
      }

      // Generate random 16-bit registration ID (1-16380 per Signal spec).
      // Must use a CSPRNG: `Math.random()` is predictable, and the previous
      // implementation used it, making IDs guessable and collision-prone.
      const regId = SignalProtocolStore.randomRegistrationId();
      await SecureStore.setItemAsync(REGISTRATION_ID_KEY, regId.toString(), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      return regId;
    } catch (error) {
      throw new Error(`Failed to get registration ID: ${error}`);
    }
  }

  /**
   * Generates a registration ID from a cryptographically secure source.
   *
   * Fails loud when no CSPRNG is present rather than falling back to
   * `Math.random()`: a predictable registration ID is guessable and collides
   * across devices.
   */
  private static randomRegistrationId(): number {
    const webCrypto = (
      globalThis as {
        crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array };
      }
    ).crypto;

    if (!webCrypto?.getRandomValues) {
      throw new Error(
        'SignalProtocolStore: no CSPRNG available (crypto.getRandomValues is missing). ' +
          'Refusing to derive a registration ID from a non-cryptographic source.',
      );
    }

    const entropy = new Uint32Array(1);
    webCrypto.getRandomValues(entropy);
    return (entropy[0] % MAX_REGISTRATION_ID) + 1;
  }

  // =========================================================================
  // PreKey Management
  // =========================================================================

  async storePreKey(keyId: number, keyPair: { pubKey: string; privKey: string }): Promise<void> {
    try {
      this.db.runSync(
        `INSERT OR REPLACE INTO signal_prekeys (key_id, key_data, created_at)
         VALUES (?, ?, strftime('%s', 'now'))`,
        [keyId, JSON.stringify(keyPair)]
      );
    } catch (error) {
      throw new Error(`Failed to store prekey: ${error}`);
    }
  }

  async loadPreKey(keyId: number): Promise<{ pubKey: string; privKey: string } | null> {
    try {
      const row = this.db.getFirstSync<{ key_data: string }>(
        `SELECT key_data FROM signal_prekeys WHERE key_id = ?`,
        [keyId]
      );

      if (!row) return null;
      return JSON.parse(row.key_data);
    } catch (error) {
      throw new Error(`Failed to load prekey: ${error}`);
    }
  }

  async removePreKey(keyId: number): Promise<void> {
    try {
      this.db.runSync(`DELETE FROM signal_prekeys WHERE key_id = ?`, [keyId]);
    } catch (error) {
      throw new Error(`Failed to remove prekey: ${error}`);
    }
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  async storeSession(address: SignalAddress, session: Record<string, unknown>): Promise<void> {
    try {
      this.db.runSync(
        `INSERT OR REPLACE INTO signal_sessions (identifier, device_id, session_data, updated_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))`,
        [address.name, address.deviceId, JSON.stringify(session)]
      );
    } catch (error) {
      throw new Error(`Failed to store session: ${error}`);
    }
  }

  async loadSession(address: SignalAddress): Promise<Record<string, unknown> | null> {
    try {
      const row = this.db.getFirstSync<{ session_data: string }>(
        `SELECT session_data FROM signal_sessions WHERE identifier = ? AND device_id = ?`,
        [address.name, address.deviceId]
      );

      if (!row) return null;
      return JSON.parse(row.session_data);
    } catch (error) {
      throw new Error(`Failed to load session: ${error}`);
    }
  }

  async removeSession(address: SignalAddress): Promise<void> {
    try {
      this.db.runSync(
        `DELETE FROM signal_sessions WHERE identifier = ? AND device_id = ?`,
        [address.name, address.deviceId]
      );
    } catch (error) {
      throw new Error(`Failed to remove session: ${error}`);
    }
  }

  async removeAllSessions(name: string): Promise<void> {
    try {
      this.db.runSync(`DELETE FROM signal_sessions WHERE identifier = ?`, [name]);
    } catch (error) {
      throw new Error(`Failed to remove all sessions: ${error}`);
    }
  }

  // =========================================================================
  // Sender Key Management (Groups)
  // =========================================================================

  async storeSenderKey(senderKeyId: string, key: Record<string, unknown>): Promise<void> {
    try {
      // The numeric key id belongs to the record itself. Prefer the module's
      // `SenderKeyRecord.senderKeyId`, accept libsignal's `keyId`, and fail
      // loudly rather than inventing a non-deterministic id.
      const keyId =
        (key.senderKeyId as number | undefined) ?? (key.keyId as number | undefined);

      if (typeof keyId !== 'number') {
        throw new Error(
          'storeSenderKey: record is missing a numeric senderKeyId'
        );
      }

      this.db.runSync(
        `INSERT OR REPLACE INTO signal_sender_keys (sender_key_id, key_id, key_data, created_at)
         VALUES (?, ?, ?, strftime('%s', 'now'))`,
        [senderKeyId, keyId, JSON.stringify(key)]
      );
    } catch (error) {
      throw new Error(`Failed to store sender key: ${error}`);
    }
  }

  async loadSenderKey(senderKeyId: string): Promise<Record<string, unknown> | null> {
    try {
      const row = this.db.getFirstSync<{ key_data: string }>(
        `SELECT key_data FROM signal_sender_keys WHERE sender_key_id = ? ORDER BY key_id DESC LIMIT 1`,
        [senderKeyId]
      );

      if (!row) return null;
      return JSON.parse(row.key_data);
    } catch (error) {
      throw new Error(`Failed to load sender key: ${error}`);
    }
  }

  async removeSenderKey(senderKeyId: string): Promise<void> {
    try {
      this.db.runSync(`DELETE FROM signal_sender_keys WHERE sender_key_id = ?`, [senderKeyId]);
    } catch (error) {
      throw new Error(`Failed to remove sender key: ${error}`);
    }
  }

  // =========================================================================
  // Identity Key Management
  // =========================================================================

  async isTrustedIdentity(identifier: string, identityKey: string): Promise<boolean> {
    try {
      const row = this.db.getFirstSync<{ identity_key: string }>(
        `SELECT identity_key FROM signal_identity_keys WHERE identifier = ?`,
        [identifier]
      );

      if (!row) {
        // Trust on first use (TOFU): persist the key so that a later change in
        // the peer's identity key is detectable. Returning true without saving
        // would make every future lookup re-trust the caller and silently
        // defeat identity-change (MITM) detection.
        await this.saveIdentity(identifier, identityKey);
        return true;
      }

      return row.identity_key === identityKey;
    } catch (error) {
      throw new Error(`Failed to check trusted identity: ${error}`);
    }
  }

  async saveIdentity(identifier: string, identityKey: string): Promise<void> {
    try {
      this.db.runSync(
        `INSERT OR REPLACE INTO signal_identity_keys (identifier, identity_key, updated_at)
         VALUES (?, ?, strftime('%s', 'now'))`,
        [identifier, identityKey]
      );
    } catch (error) {
      throw new Error(`Failed to save identity: ${error}`);
    }
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  async clearAllData(): Promise<void> {
    try {
      this.db.execSync(`
        DELETE FROM signal_identity_keys;
        DELETE FROM signal_prekeys;
        DELETE FROM signal_sessions;
        DELETE FROM signal_sender_keys;
      `);

      await SecureStore.deleteItemAsync(IDENTITY_KEY_PAIR_KEY);
      await SecureStore.deleteItemAsync(REGISTRATION_ID_KEY);
    } catch (error) {
      throw new Error(`Failed to clear all data: ${error}`);
    }
  }

  close(): void {
    this.db.closeSync();
  }
}