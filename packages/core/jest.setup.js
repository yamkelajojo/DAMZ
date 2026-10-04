// Jest setup for @damz/core
import 'jest-expo';

// Mock react-native-nitro-tor
jest.mock('react-native-nitro-tor', () => ({
  RnTor: {
    startTorIfNotRunning: jest.fn().mockResolvedValue({ is_success: true, onion_address: 'test.onion' }),
    httpGet: jest.fn().mockResolvedValue({ status_code: 200, body: '{}' }),
    httpPost: jest.fn().mockResolvedValue({ status_code: 200, body: '{}' }),
  },
}));

// Mock react-native-mymonero-core
jest.mock('react-native-mymonero-core', () => ({
  __esModule: true,
  default: {
    generateWallet: jest.fn().mockResolvedValue({ address: '4test...', mnemonic: 'test seed' }),
    seedAndKeysFromMnemonic: jest.fn().mockResolvedValue({ address: '4test...' }),
    newIntegratedAddress: jest.fn().mockResolvedValue({ integratedAddress: '8test...' }),
    createTransaction: jest.fn().mockResolvedValue({ signedTxHex: '0x...', txid: 'txid...', fee: '1000000000' }),
    decodeAddress: jest.fn().mockResolvedValue({ isValid: true, isSubaddress: true, networkType: 'MAINNET' }),
    estimateTxFee: jest.fn().mockResolvedValue({ fee: '1000000000' }),
  },
}));

// Mock @ipfs-meshkit/meshkit
jest.mock('@ipfs-meshkit/meshkit', () => ({
  createS3Client: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue('QmTest...'),
    download: jest.fn().mockResolvedValue(new Uint8Array()),
    delete: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock @ajna-inc/poe-proofs
jest.mock('@ajna-inc/poe-proofs', () => ({
  generateLocationProofPOE: jest.fn().mockResolvedValue({ isValid: true, confidenceScore: 95 }),
  verifyLocationProofPOE: jest.fn().mockResolvedValue(true),
}));

// Mock @realreel/photo-attest
jest.mock('@realreel/photo-attest', () => ({
  PhotoAttest: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    captureAndSign: jest.fn().mockResolvedValue({
      uri: 'file://test.jpg',
      c2paManifest: '{}',
      attestationToken: 'token',
      signature: 'sig',
      metadata: { timestamp: Date.now(), deviceInfo: 'test' },
    }),
    verifyAttestation: jest.fn().mockResolvedValue({ valid: true, details: 'ok' }),
    isAvailable: jest.fn().mockResolvedValue({ available: true }),
  })),
}));

// Mock @did-tools/key
jest.mock('@did-tools/key', () => ({
  DidKey: {
    generate: jest.fn().mockResolvedValue({
      did: 'did:key:z6MkTest...',
      privateKey: new Uint8Array(32),
      publicKey: new Uint8Array(32),
    }),
    fromDid: jest.fn().mockImplementation((did) => ({
      publicKey: () => 'z6MkTest...',
      sign: jest.fn().mockResolvedValue(new Uint8Array(64)),
      verify: jest.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32)),
}));

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getAllSync: jest.fn().mockReturnValue([]),
    getFirstSync: jest.fn().mockReturnValue(null),
    closeSync: jest.fn(),
  })),
}));

// Global test utilities
global.fetch = jest.fn();

console.log('Jest setup complete');