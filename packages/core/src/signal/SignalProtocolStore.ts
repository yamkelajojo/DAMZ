/**
 * SignalProtocolStore — TypeScript implementation over expo-sqlite (SQLCipher)
 *
 * Implements the libsignal SignalProtocolStore interface for React Native.
 * Uses expo-sqlite with SQLCipher for encrypted storage and expo-secure-store
 * for long-term identity keys.
 */

import { openDatabaseSync } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

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
    this.db = openDatabaseSync('damz_signal.db', {
      cipherKey: dbKey,
    });
    this.initTables();
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

  private async generateIdentityKeyPair(): Promise<IdentityKeyPair> {
    // Generate 32-byte seed for Ed25519
    const seed = await Crypto.getRandomBytesAsync(32);

    // In production, use a proper Ed25519 implementation
    // For now, we use the seed as both public/private (libsignal expects specific format)
    // This would be replaced with actual @noble/ed25519 or similar
    const publicKey = Buffer.from(seed).toString('base64');
    const privateKey = Buffer.from(seed).toString('base64'); // Simplified

    return { publicKey, privateKey };
  }

  async getLocalRegistrationId(): Promise<number> {
    try {
      const stored = await SecureStore.getItemAsync(REGISTRATION_ID_KEY, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      if (stored) {
        return parseInt(stored, 10);
      }

      // Generate random 16-bit registration ID (1-16380 per Signal spec)
      const regId = Math.floor(Math.random() * 16380) + 1;
      await SecureStore.setItemAsync(REGISTRATION_ID_KEY, regId.toString(), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      return regId;
    } catch (error) {
      throw new Error(`Failed to get registration ID: ${error}`);
    }
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
      // Generate a key ID if not provided in the key object
      const keyId = (key.keyId as number) ?? Math.floor(Math.random() * 1000000);

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
        // First encounter - trust on first use (TOFU)
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