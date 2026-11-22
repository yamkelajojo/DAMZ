// Jest setup for @damz/core
// The jest-expo preset (see jest.config.js) already configures the environment;
// importing jest-expo here as well is unnecessary.

// Mock react-native-nitro-tor
jest.mock('react-native-nitro-tor', () => ({
  RnTor: {
    startTorIfNotRunning: jest.fn().mockResolvedValue({
      is_success: true,
      onion_address: `${'a'.repeat(56)}.onion`,
      control: '',
      error_message: '',
    }),
    shutdownService: jest.fn().mockResolvedValue(true),
    getServiceStatus: jest.fn().mockResolvedValue(1),
    httpGet: jest.fn().mockResolvedValue({ status_code: 200, body: '{}', error: '' }),
    httpPost: jest.fn().mockResolvedValue({ status_code: 200, body: '{}', error: '' }),
    httpPut: jest.fn().mockResolvedValue({ status_code: 200, body: '{}', error: '' }),
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

// Mock react-native-libsignal-client (native crypto). The public and private
// serializations are deliberately distinct so regression tests can assert they
// never collapse into the same value (see the identity-key test in
// SignalProtocolStore.test.ts).
jest.mock('react-native-libsignal-client', () => ({
  IdentityKeyPair: {
    generate: jest.fn(() => ({
      publicKey: { serialized: new Uint8Array(33).fill(0x11) },
      privateKey: { serialized: new Uint8Array(32).fill(0x22) },
    })),
  },
}));

// Mock @ipfs-meshkit/meshkit
jest.mock('@ipfs-meshkit/meshkit', () => ({
  createS3Client: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue('QmTest...'),
    retrieve: jest.fn().mockResolvedValue(new Uint8Array()),
    pin: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock @ajna-inc/poe-proofs
jest.mock('@ajna-inc/poe-proofs', () => ({
  generateLocationProofPOE: jest.fn().mockResolvedValue({
    isValid: true,
    confidenceScore: 95,
    proofJson: '{"proof":"test"}',
    publicInputs: ['1'],
    magneticValid: true,
    altitudeValid: true,
    gpsAccuracyOk: true,
    timestampFresh: true,
    expectedMagnetic: { x: 21, y: -8, z: 44 },
  }),
  verifyLocationProofPOE: jest.fn().mockResolvedValue(true),
}));

// Mock @realreel/photo-attest. The module exposes a DEFAULT export (the code
// imports it as `PhotoAttest`), which the previous mock did not provide.
// @realreel/photo-attest exposes the wrapper as BOTH a named export
// (`PhotoAttest`, the canonical one) and as the default export, so the mock
// mirrors both rather than only the default.
jest.mock('@realreel/photo-attest', () => {
  const PhotoAttest = {
    hasKey: jest.fn().mockResolvedValue(true),
    generateKey: jest.fn().mockResolvedValue(undefined),
    signC2PACapture: jest.fn().mockResolvedValue({
      signedMediaPath: 'file://signed.jpg',
      manifestId: 'urn:c2pa:test-manifest',
    }),
    isHardwareSupported: jest.fn().mockResolvedValue(true),
    generateAndAttestKey: jest.fn().mockResolvedValue({ attestationObject: 'test' }),
    generateCSR: jest.fn().mockResolvedValue('test-csr'),
  };
  return { __esModule: true, PhotoAttest, default: PhotoAttest };
});

// @digitalbazaar/did-method-key and @digitalbazaar/ed25519-verification-key-2020
// are pure-JS and run unmodified under Node, so they are *not* mocked here.
// DIDManager.test.ts exercises the real libraries end to end (generate → resolve
// → sign → verify); mocking them previously hid a broken call sequence.

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

// jsdom does not expose TextEncoder/TextDecoder, but Node does. The crypto
// bindings (@digitalbazaar) and DIDManager.verifyPriceListSignature rely on them.
const { TextEncoder, TextDecoder } = require('node:util');
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

console.log('Jest setup complete');
