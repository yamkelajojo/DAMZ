jest.mock(
  'react-native-mymonero-core',
  () => ({
    __esModule: true,
    default: { generateWallet: jest.fn() },
  }),
  { virtual: true },
);

import bridge from 'react-native-mymonero-core';
import { MoneroWallet } from '../monero/MoneroWallet';

const TEST_ONLY_SYNTHETIC_MNEMONIC = 'synthetic test phrase; not a wallet seed';
const BRIDGE = bridge as unknown as {
  generateWallet: jest.Mock;
};

describe('TC-SEC-MEM-01 — JavaScript wallet façade exposes no seed material', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    BRIDGE.generateWallet.mockResolvedValue({
      address: '4'.padEnd(95, 'a'),
      mnemonic: TEST_ONLY_SYNTHETIC_MNEMONIC,
    });
  });

  it('returns only public wallet metadata after native wallet creation', async () => {
    const result = await MoneroWallet.getInstance().generateWallet();

    expect(Object.keys(result).sort()).toEqual(['address', 'restoreHeight']);
    expect(result).not.toHaveProperty('seed');
    expect(JSON.stringify(result)).not.toContain(TEST_ONLY_SYNTHETIC_MNEMONIC);
  });

  it('keeps the primary-address accessor limited to public metadata', async () => {
    const wallet = MoneroWallet.getInstance();
    await wallet.generateWallet();

    expect(wallet.getPrimaryAddress()).toBe('4'.padEnd(95, 'a'));
    expect(wallet.getPrimaryAddress()).not.toContain(TEST_ONLY_SYNTHETIC_MNEMONIC);
  });
});
