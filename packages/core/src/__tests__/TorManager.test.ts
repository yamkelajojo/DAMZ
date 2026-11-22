/**
 * TC-TOR-01 — TorManager TLS policy and config honesty.
 *
 * `react-native-nitro-tor` defaults `trust_invalid_certs` to `false`. The
 * previous implementation forced it to `true` for every request, disabling
 * certificate validation for clearnet origins as well — any Tor exit node could
 * then impersonate them. These tests lock the corrected policy in place.
 */
import { TorManager, isOnionUrl } from '../tor/TorManager';

const rnTor = jest.requireMock<{
  RnTor: {
    startTorIfNotRunning: jest.Mock;
    shutdownService: jest.Mock;
    httpGet: jest.Mock;
    httpPost: jest.Mock;
    httpPut: jest.Mock;
  };
}>('react-native-nitro-tor').RnTor;

const V3_ONION_HOST = `${'a'.repeat(56)}.onion`;
const V2_ONION_HOST = `${'b'.repeat(16)}.onion`;
const CLEARNET_URL = 'https://api.example.com/prices';

const BASE_CONFIG = { dataDir: '/data/tor', socksPort: 9050 };

describe('TC-TOR-01 — TorManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rnTor.startTorIfNotRunning.mockResolvedValue({
      is_success: true,
      onion_address: `http://${V3_ONION_HOST}`,
      control: '',
      error_message: '',
    });
    rnTor.httpGet.mockResolvedValue({ status_code: 200, body: '{}', error: '' });
    rnTor.httpPost.mockResolvedValue({ status_code: 200, body: '{}', error: '' });
    rnTor.httpPut.mockResolvedValue({ status_code: 200, body: '{}', error: '' });
  });

  afterEach(async () => {
    await TorManager.getInstance().stop();
  });

  describe('TLS certificate validation', () => {
    it('validates certificates for clearnet origins', async () => {
      await TorManager.getInstance().httpGet(CLEARNET_URL);

      expect(rnTor.httpGet).toHaveBeenCalledWith(
        expect.objectContaining({ url: CLEARNET_URL, trust_invalid_certs: false }),
      );
    });

    it('relaxes validation only for .onion hosts, where the address authenticates the service', async () => {
      await TorManager.getInstance().httpGet(`http://${V3_ONION_HOST}/status`);

      expect(rnTor.httpGet).toHaveBeenCalledWith(
        expect.objectContaining({ trust_invalid_certs: true }),
      );
    });

    it('applies the same policy to POST', async () => {
      await TorManager.getInstance().httpPost(CLEARNET_URL, '{}');

      expect(rnTor.httpPost).toHaveBeenCalledWith(
        expect.objectContaining({ trust_invalid_certs: false }),
      );
    });

    it('applies the onion TLS policy to PUT', async () => {
      await TorManager.getInstance().httpPut(`http://${V3_ONION_HOST}/blob`, 'ciphertext');

      expect(rnTor.httpPut).toHaveBeenCalledWith(
        expect.objectContaining({ trust_invalid_certs: true }),
      );
    });

    it('honours an explicit per-request override', async () => {
      const tor = TorManager.getInstance();

      await tor.httpGet(CLEARNET_URL, '', 20000, { trustInvalidCerts: true });
      expect(rnTor.httpGet).toHaveBeenLastCalledWith(
        expect.objectContaining({ trust_invalid_certs: true }),
      );

      await tor.httpGet(`http://${V3_ONION_HOST}/`, '', 20000, { trustInvalidCerts: false });
      expect(rnTor.httpGet).toHaveBeenLastCalledWith(
        expect.objectContaining({ trust_invalid_certs: false }),
      );
    });

    it('classifies onion hosts correctly', () => {
      expect(isOnionUrl(`http://${V3_ONION_HOST}/x`)).toBe(true);
      expect(isOnionUrl(`http://${V2_ONION_HOST}:8080/path`)).toBe(true);
      expect(isOnionUrl(CLEARNET_URL)).toBe(false);
      // Unparseable input fails safe: certificates stay validated.
      expect(isOnionUrl('not a url')).toBe(false);
      expect(isOnionUrl(`${V2_ONION_HOST}:8080/path`)).toBe(false);
      // `.onion`-lookalike domains must not be treated as onion services.
      expect(isOnionUrl('https://example.onion.evil.com/')).toBe(false);
    });
  });

  describe('config honesty', () => {
    it('rejects controlPort instead of silently ignoring it', async () => {
      await expect(
        TorManager.getInstance().start({ ...BASE_CONFIG, controlPort: 9051 }),
      ).rejects.toThrow(/controlPort` is not supported/);
      expect(rnTor.startTorIfNotRunning).not.toHaveBeenCalled();
    });

    it('rejects hiddenServiceDir instead of silently ignoring it', async () => {
      await expect(
        TorManager.getInstance().start({ ...BASE_CONFIG, hiddenServiceDir: '/data/hs' }),
      ).rejects.toThrow(/hiddenServiceDir` is not supported/);
      expect(rnTor.startTorIfNotRunning).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('starts Tor, returning the hidden service onion address', async () => {
      const result = await TorManager.getInstance().start(BASE_CONFIG);

      expect(result.onionAddress).toBe(`http://${V3_ONION_HOST}`);
      expect(TorManager.getInstance().isTorRunning()).toBe(true);
      expect(TorManager.getInstance().getOnionAddress()).toBe(`http://${V3_ONION_HOST}`);
      expect(rnTor.startTorIfNotRunning).toHaveBeenCalledWith(
        expect.objectContaining({ data_dir: '/data/tor', socks_port: 9050 }),
      );
    });

    it('is idempotent while already running', async () => {
      const tor = TorManager.getInstance();
      await tor.start(BASE_CONFIG);
      await tor.start(BASE_CONFIG);

      expect(rnTor.startTorIfNotRunning).toHaveBeenCalledTimes(1);
    });

    it('surfaces the native error message when Tor fails to start', async () => {
      rnTor.startTorIfNotRunning.mockResolvedValueOnce({
        is_success: false,
        onion_address: '',
        control: '',
        error_message: 'binary missing',
      });

      await expect(TorManager.getInstance().start(BASE_CONFIG)).rejects.toThrow(/binary missing/);
      expect(TorManager.getInstance().isTorRunning()).toBe(false);
    });

    it('fails loud when the daemon reports success without an onion address', async () => {
      rnTor.startTorIfNotRunning.mockResolvedValueOnce({
        is_success: true,
        onion_address: '',
        control: '',
        error_message: '',
      });

      await expect(TorManager.getInstance().start(BASE_CONFIG)).rejects.toThrow(
        /no onion address/,
      );
      expect(TorManager.getInstance().isTorRunning()).toBe(false);
    });

    it('propagates transport errors', async () => {
      rnTor.httpGet.mockResolvedValueOnce({ status_code: 0, body: '', error: 'socks refused' });

      await expect(TorManager.getInstance().httpGet(CLEARNET_URL)).rejects.toThrow(
        /socks refused/,
      );
    });

    it('shuts down and clears the onion address', async () => {
      const tor = TorManager.getInstance();
      await tor.start(BASE_CONFIG);
      await tor.stop();

      expect(rnTor.shutdownService).toHaveBeenCalledTimes(1);
      expect(tor.isTorRunning()).toBe(false);
      expect(tor.getOnionAddress()).toBeNull();
    });
  });
});
