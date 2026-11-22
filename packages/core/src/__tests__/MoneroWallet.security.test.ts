import { MoneroWallet } from '../monero/MoneroWallet';

const TEST_ADDRESS = '4'.padEnd(95, 'a');
const SYNTHETIC_MNEMONIC = 'synthetic test phrase; not a wallet seed';

// This factory must be self-contained. `jest.mock` calls are hoisted above the
// imports, so a `const` declared below the imports (e.g. the previously used
// `mockSecureMemory` object) is not yet initialised when the factory runs and
// resolves to `undefined` under the RN/Babel target — which made MoneroWallet
// throw "SecureMemory native module not found" instead of being mocked.
jest.mock('react-native', () => ({
  NativeModules: {
    SecureMemory: {
      generateWallet: jest.fn(),
      restoreWallet: jest.fn(),
      hasWallet: jest.fn(),
      deleteWallet: jest.fn(),
      createSubaddress: jest.fn(),
      createTransaction: jest.fn(),
      estimateFee: jest.fn(),
      decodeAddress: jest.fn(),
      getPrimaryAddress: jest.fn(),
      getRestoreHeight: jest.fn(),
      setRestoreHeight: jest.fn(),
      exportRecoveryPhrase: jest.fn(),
      verifyRecoveryPhrase: jest.fn(),
      getPrivateViewKey: jest.fn(),
      syncWithGateway: jest.fn(),
    },
  },
}));

const mockSecureMemory = jest.requireMock<{
  NativeModules: { SecureMemory: Record<string, jest.Mock> };
}>('react-native').NativeModules.SecureMemory;

describe('TC-SEC-MEM-01 — JavaScript wallet façade exposes no seed material', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSecureMemory.generateWallet.mockResolvedValue({
      address: TEST_ADDRESS,
      restoreHeight: 0,
    });

    mockSecureMemory.hasWallet.mockResolvedValue(true);
    mockSecureMemory.getPrimaryAddress.mockResolvedValue(TEST_ADDRESS);
    mockSecureMemory.getRestoreHeight.mockResolvedValue(0);
  });

  it('returns only public wallet metadata after native wallet creation', async () => {
    const result = await MoneroWallet.getInstance().generateWallet();

    expect(Object.keys(result).sort()).toEqual(['address', 'restoreHeight']);
    expect(result).not.toHaveProperty('seed');
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_MNEMONIC);
    expect(result.address).toBe(TEST_ADDRESS);
    expect(result.restoreHeight).toBe(0);
  });

  it('keeps the primary-address accessor limited to public metadata', async () => {
    const wallet = MoneroWallet.getInstance();
    await wallet.generateWallet();

    expect(await wallet.getPrimaryAddress()).toBe(TEST_ADDRESS);
    expect((await wallet.getPrimaryAddress())).not.toContain(SYNTHETIC_MNEMONIC);
  });

  it('restoreWallet returns only public metadata', async () => {
    const mockEntry = 123 as any; // NativeMnemonicEntry opaque handle
    mockSecureMemory.restoreWallet.mockResolvedValue({
      address: TEST_ADDRESS,
      restoreHeight: 12345,
    });

    const result = await MoneroWallet.getInstance().restoreWallet(mockEntry, 12345);

    expect(Object.keys(result).sort()).toEqual(['address', 'restoreHeight']);
    expect(result).not.toHaveProperty('seed');
    expect(result.address).toBe(TEST_ADDRESS);
    expect(result.restoreHeight).toBe(12345);
  });

  it('createSubaddress returns subaddress info without secrets', async () => {
    mockSecureMemory.createSubaddress.mockResolvedValue({
      address: '8'.padEnd(95, 'b'),
      index: 1,
      label: 'test',
    });

    const result = await MoneroWallet.getInstance().createSubaddress(1, 'test');

    expect(Object.keys(result).sort()).toEqual(['address', 'index', 'label']);
    expect(result).not.toHaveProperty('seed');
    expect(result).not.toHaveProperty('spendKey');
    expect(result).not.toHaveProperty('viewKey');
  });

  it('createTransaction returns only tx metadata without secrets', async () => {
    mockSecureMemory.createTransaction.mockResolvedValue({
      txHex: '02'.repeat(100),
      txid: 'a'.repeat(64),
      fee: '1000000000',
    });

    const result = await MoneroWallet.getInstance().createTransaction(
      '4'.padEnd(95, 'c'),
      '100000000000',
      1,
      0
    );

    expect(Object.keys(result).sort()).toEqual(['fee', 'txHex', 'txid']);
    expect(result).not.toHaveProperty('seed');
    expect(result).not.toHaveProperty('spendKey');
    expect(result).not.toHaveProperty('keyImages');
  });

  it('getPrivateViewKey returns opaque handle, not key material', async () => {
    const mockPinEntry = 456 as any; // NativePinEntry opaque handle
    mockSecureMemory.getPrivateViewKey.mockResolvedValue({
      viewKeyHandle: 789 as any, // NativeViewKeyHandle opaque handle
    });

    const result = await MoneroWallet.getInstance().getPrivateViewKey(mockPinEntry);

    expect(result).toHaveProperty('viewKeyHandle');
    expect(typeof result.viewKeyHandle).toBe('number');
    expect(result).not.toHaveProperty('viewKey');
    expect(result).not.toHaveProperty('privateViewKey');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('syncWithGateway accepts opaque handle, not raw key', async () => {
    const mockViewKeyHandle = 789 as any;
    mockSecureMemory.syncWithGateway.mockResolvedValue({
      newHeight: 100,
      transactions: [],
    });

    const result = await MoneroWallet.getInstance().syncWithGateway(
      'gateway.onion',
      mockViewKeyHandle,
      50
    );

    expect(result).toHaveProperty('newHeight');
    expect(result).toHaveProperty('transactions');
    expect(result).not.toHaveProperty('viewKey');
  });

  it('never hands recovery-phrase material to a JavaScript callback', async () => {
    mockSecureMemory.exportRecoveryPhrase.mockResolvedValue(undefined);
    mockSecureMemory.verifyRecoveryPhrase.mockResolvedValue(true);

    const wallet = MoneroWallet.getInstance();

    await wallet.exportRecoveryPhrase('Authenticate to view phrase');
    const exportArgs = mockSecureMemory.exportRecoveryPhrase.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Only the prompt crosses to native. No display callback exists through
    // which the mnemonic could reach JavaScript (ADR-0028).
    expect(Object.keys(exportArgs).sort()).toEqual(['biometricPrompt']);
    expect(Object.values(exportArgs).some((value) => typeof value === 'function')).toBe(false);

    await expect(wallet.verifyRecoveryPhrase('Authenticate to verify phrase')).resolves.toBe(true);
    const verifyArgs = mockSecureMemory.verifyRecoveryPhrase.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(verifyArgs).sort()).toEqual(['biometricPrompt']);
    expect(Object.values(verifyArgs).some((value) => typeof value === 'function')).toBe(false);
  });

  it('allows core imports without SecureMemory and fails closed only on wallet use', async () => {
    let walletOperation: Promise<boolean> | null = null;
    jest.isolateModules(() => {
      const nativeModules = require('react-native').NativeModules as Record<string, unknown>;
      const installedModule = nativeModules.SecureMemory;
      nativeModules.SecureMemory = undefined;
      try {
        expect(() => require('../index')).not.toThrow();
        const { MoneroWallet: WalletWithoutNative } = require('../monero/MoneroWallet');
        walletOperation = WalletWithoutNative.getInstance().hasWallet();
      } finally {
        nativeModules.SecureMemory = installedModule;
      }
    });
    if (!walletOperation) throw new Error('wallet operation was not created');
    await expect(walletOperation).rejects.toThrow(/SecureMemory native module is unavailable/);
  });
});
