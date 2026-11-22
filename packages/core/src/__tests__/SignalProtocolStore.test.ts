/**
 * Signal Protocol Store Tests — TDD First
 *
 * Tests the TypeScript implementation of SignalProtocolStore interface
 * wrapping expo-sqlite (SQLCipher) + expo-secure-store.
 *
 * Requirements from ADR-0021:
 * - Prekeys (signed + unsigned, one-time)
 * - Sessions (Double Ratchet state per recipient)
 * - Sender Keys (groups)
 * - Identity Keys (local + trusted recipient identities)
 * - Secure storage for long-term identity keys
 * - All methods from libsignal's SignalProtocolStore interface
 */

import { openDatabaseSync } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

// Mock expo modules
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockDb = {
  execSync: jest.fn(),
  runSync: jest.fn(),
  getAllSync: jest.fn(),
  getFirstSync: jest.fn(),
  closeSync: jest.fn(),
};

(openDatabaseSync as jest.Mock).mockReturnValue(mockDb);

/** 32 bytes, hex-encoded — the shape @damz/db's `getDatabaseKey()` produces. */
const TEST_DB_KEY = 'a'.repeat(64);
const CIPHER_VERSION_ROW = { cipher_version: '4.7.0 community' };

describe('SignalProtocolStore', () => {
  let store: SignalProtocolStore;

  beforeEach(() => {
    jest.clearAllMocks();

    // The constructor probes `PRAGMA cipher_version` through `getFirstSync`, so
    // reset the mock (dropping any unconsumed one-shot values) and install a
    // base implementation before constructing. Individual tests keep using
    // `mockReturnValueOnce` for row lookups.
    mockDb.getFirstSync.mockReset();
    mockDb.getFirstSync.mockImplementation((sql: string) =>
      /cipher_version/i.test(sql) ? CIPHER_VERSION_ROW : undefined,
    );
    mockDb.execSync.mockReset();

    // Import after mocks are set up
    const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
    store = new SignalProtocolStore(TEST_DB_KEY);
  });

  describe('Initialization', () => {
    it('should create database tables on init', async () => {
      expect(mockDb.execSync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS signal_identity_keys'));
      expect(mockDb.execSync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS signal_prekeys'));
      expect(mockDb.execSync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS signal_sessions'));
      expect(mockDb.execSync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS signal_sender_keys'));
    });

    it('should generate identity key pair if not exists', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);

      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      const newStore = new SignalProtocolStore(TEST_DB_KEY);

      await newStore.getIdentityKeyPair();

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'signal_identity_key_pair',
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should load existing identity key pair from secure store', async () => {
      const mockKeyPair = { publicKey: 'mock-public', privateKey: 'mock-private' };
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockKeyPair));

      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      const newStore = new SignalProtocolStore(TEST_DB_KEY);

      const keyPair = await newStore.getIdentityKeyPair();

      expect(keyPair).toEqual(mockKeyPair);
    });

    it('never returns the same material for the public and private identity keys', async () => {
      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      const newStore = new SignalProtocolStore(TEST_DB_KEY);

      const keyPair = await newStore.getIdentityKeyPair();

      expect(typeof keyPair.publicKey).toBe('string');
      expect(typeof keyPair.privateKey).toBe('string');
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
      // Regression guard: the public key must never disclose the private key.
      expect(keyPair.publicKey).not.toBe(keyPair.privateKey);
    });

    it('should generate registration ID if not exists', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);

      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      const newStore = new SignalProtocolStore(TEST_DB_KEY);

      const regId = await newStore.getLocalRegistrationId();

      expect(regId).toBeGreaterThanOrEqual(1);
      expect(regId).toBeLessThanOrEqual(16380); // 16-bit
    });
  });

  describe('PreKey Management', () => {
    const mockPreKey = { keyId: 1, keyPair: { pubKey: 'pub', privKey: 'priv' } };

    it('should store prekey', async () => {
      await store.storePreKey(1, mockPreKey);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO signal_prekeys'),
        expect.arrayContaining([1, expect.any(String)])
      );
    });

    it('should load prekey', async () => {
      mockDb.getFirstSync.mockReturnValueOnce({
        key_data: JSON.stringify(mockPreKey),
      });

      const preKey = await store.loadPreKey(1);

      expect(preKey).toEqual(mockPreKey);
    });

    it('should return null for missing prekey', async () => {
      mockDb.getFirstSync.mockReturnValueOnce(null);

      const preKey = await store.loadPreKey(999);

      expect(preKey).toBeNull();
    });

    it('should remove prekey', async () => {
      await store.removePreKey(1);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM signal_prekeys'),
        [1]
      );
    });
  });

  describe('Session Management', () => {
    const mockAddress = { name: 'recipient', deviceId: 1 };
    const mockSession = { sessionData: 'encrypted-session-state' };

    it('should store session', async () => {
      await store.storeSession(mockAddress, mockSession);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO signal_sessions'),
        expect.arrayContaining(['recipient', 1, expect.any(String)])
      );
    });

    it('should load session', async () => {
      mockDb.getFirstSync.mockReturnValueOnce({
        session_data: JSON.stringify(mockSession),
      });

      const session = await store.loadSession(mockAddress);

      expect(session).toEqual(mockSession);
    });

    it('should return null for missing session', async () => {
      mockDb.getFirstSync.mockReturnValueOnce(null);

      const session = await store.loadSession({ name: 'unknown', deviceId: 1 });

      expect(session).toBeNull();
    });

    it('should remove session', async () => {
      await store.removeSession(mockAddress);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM signal_sessions'),
        ['recipient', 1]
      );
    });

    it('should remove all sessions for a recipient', async () => {
      await store.removeAllSessions('recipient');

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM signal_sessions'),
        ['recipient']
      );
    });
  });

  describe('Sender Key Management (Groups)', () => {
    const mockSenderKey = { senderKeyId: 1, key: 'sender-key-data' };

    it('should store sender key', async () => {
      await store.storeSenderKey('group-1', mockSenderKey);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO signal_sender_keys'),
        expect.arrayContaining(['group-1', 1, expect.any(String)])
      );
    });

    it('should load sender key', async () => {
      mockDb.getFirstSync.mockReturnValueOnce({
        key_data: JSON.stringify(mockSenderKey),
      });

      const senderKey = await store.loadSenderKey('group-1');

      expect(senderKey).toEqual(mockSenderKey);
    });

    it('should remove sender key', async () => {
      await store.removeSenderKey('group-1');

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM signal_sender_keys'),
        ['group-1']
      );
    });
  });

  describe('Identity Key Management', () => {
    const mockIdentityKey = 'mock-identity-key';

    it('should trust identity on first encounter', async () => {
      const trusted = await store.isTrustedIdentity('recipient', mockIdentityKey);

      expect(trusted).toBe(true);
      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO signal_identity_keys'),
        expect.arrayContaining(['recipient', mockIdentityKey])
      );
    });

    it('should verify trusted identity matches', async () => {
      mockDb.getFirstSync.mockReturnValueOnce({
        identity_key: mockIdentityKey,
      });

      const trusted = await store.isTrustedIdentity('recipient', mockIdentityKey);

      expect(trusted).toBe(true);
    });

    it('should reject mismatched identity key', async () => {
      mockDb.getFirstSync.mockReturnValueOnce({
        identity_key: 'different-key',
      });

      const trusted = await store.isTrustedIdentity('recipient', mockIdentityKey);

      expect(trusted).toBe(false);
    });

    it('should save identity key', async () => {
      await store.saveIdentity('recipient', mockIdentityKey);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO signal_identity_keys'),
        expect.arrayContaining(['recipient', mockIdentityKey])
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw on database errors', async () => {
      mockDb.runSync.mockImplementationOnce(() => {
        throw new Error('DB locked');
      });

      await expect(store.storePreKey(1, {})).rejects.toThrow('DB locked');
    });

    it('should throw on secure store errors', async () => {
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keychain error'));

      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      const newStore = new SignalProtocolStore(TEST_DB_KEY);

      await expect(newStore.getIdentityKeyPair()).rejects.toThrow('Keychain error');
    });
  });

  describe('Encryption at rest', () => {
    it('applies the SQLCipher key before creating any table', () => {
      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      mockDb.execSync.mockReset();

      new SignalProtocolStore(TEST_DB_KEY);

      const statements = mockDb.execSync.mock.calls.map((call) => call[0] as string);
      const keyIndex = statements.findIndex((sql) => sql.includes('PRAGMA key'));
      const tableIndex = statements.findIndex((sql) => sql.includes('CREATE TABLE'));

      expect(keyIndex).toBeGreaterThanOrEqual(0);
      expect(statements[keyIndex]).toContain(`PRAGMA key = "x'${TEST_DB_KEY}'"`);
      expect(keyIndex).toBeLessThan(tableIndex);
    });

    it('opens the database without the silently-ignored `key` open option', () => {
      expect(openDatabaseSync).toHaveBeenCalledWith('damz_signal.db');
    });

    it('refuses to open when SQLCipher is unavailable', () => {
      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');
      // `PRAGMA cipher_version` returns an empty row: SQLCipher is not compiled in.
      mockDb.getFirstSync.mockImplementationOnce(() => ({}));

      expect(() => new SignalProtocolStore(TEST_DB_KEY)).toThrow(/SQLCipher is not available/);
    });

    it('refuses a malformed database key', () => {
      const { SignalProtocolStore } = require('../signal/SignalProtocolStore');

      expect(() => new SignalProtocolStore('not-a-64-hex-key')).toThrow(/64-character hex/);
    });
  });

  describe('Registration ID entropy', () => {
    it('never derives the registration ID from Math.random', async () => {
      const randomSpy = jest.spyOn(Math, 'random');
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValueOnce(undefined);

      const regId = await store.getLocalRegistrationId();

      expect(randomSpy).not.toHaveBeenCalled();
      expect(Number.isInteger(regId)).toBe(true);
      expect(regId).toBeGreaterThanOrEqual(1);
      expect(regId).toBeLessThanOrEqual(16380);
      randomSpy.mockRestore();
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct types for all methods', () => {
      // TypeScript compilation test - if this compiles, types are correct
      expect(typeof store.getIdentityKeyPair).toBe('function');
      expect(typeof store.getLocalRegistrationId).toBe('function');
      expect(typeof store.storePreKey).toBe('function');
      expect(typeof store.loadPreKey).toBe('function');
      expect(typeof store.removePreKey).toBe('function');
      expect(typeof store.storeSession).toBe('function');
      expect(typeof store.loadSession).toBe('function');
      expect(typeof store.removeSession).toBe('function');
      expect(typeof store.removeAllSessions).toBe('function');
      expect(typeof store.storeSenderKey).toBe('function');
      expect(typeof store.loadSenderKey).toBe('function');
      expect(typeof store.removeSenderKey).toBe('function');
      expect(typeof store.isTrustedIdentity).toBe('function');
      expect(typeof store.saveIdentity).toBe('function');
    });
  });
});

// Type definitions for the store interface (matching libsignal)
interface SignalProtocolStore {
  getIdentityKeyPair(): Promise<{ publicKey: string; privateKey: string }>;
  getLocalRegistrationId(): Promise<number>;
  storePreKey(keyId: number, keyPair: { pubKey: string; privKey: string }): Promise<void>;
  loadPreKey(keyId: number): Promise<{ pubKey: string; privKey: string } | null>;
  removePreKey(keyId: number): Promise<void>;
  storeSession(address: { name: string; deviceId: number }, session: Record<string, unknown>): Promise<void>;
  loadSession(address: { name: string; deviceId: number }): Promise<Record<string, unknown> | null>;
  removeSession(address: { name: string; deviceId: number }): Promise<void>;
  removeAllSessions(name: string): Promise<void>;
  storeSenderKey(senderKeyId: string, key: Record<string, unknown>): Promise<void>;
  loadSenderKey(senderKeyId: string): Promise<Record<string, unknown> | null>;
  removeSenderKey(senderKeyId: string): Promise<void>;
  isTrustedIdentity(identifier: string, identityKey: string): Promise<boolean>;
  saveIdentity(identifier: string, identityKey: string): Promise<void>;
}