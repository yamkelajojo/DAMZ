/**
 * TorManager — Wrapper for react-native-nitro-tor
 *
 * Manages Tor daemon lifecycle, hidden services, and HTTP over Tor.
 *
 * TLS policy
 * ----------
 * Certificate validation follows the library default (`trust_invalid_certs:
 * false`) so clearnet origins are authenticated as usual. It is relaxed *only*
 * for `.onion` hosts: their certificates are frequently self-signed, while the
 * onion address itself already authenticates the service (the address is
 * derived from the service's public key) and Tor provides end-to-end encryption
 * to it. Disabling validation for a **clearnet** origin would let any Tor exit
 * node impersonate that origin, so callers must opt in explicitly.
 */

import { RnTor } from 'react-native-nitro-tor';

/** `react-native-nitro-tor` cannot create a hidden service without a target. */
const DEFAULT_HIDDEN_SERVICE_PORT = 8080;

/** v3 `.onion` addresses are 56 base32 chars; legacy v2 were 16. */
const ONION_HOST_PATTERN = /^([a-z2-7]{16}|[a-z2-7]{56})\.onion$/i;

export interface TorConfig {
  /** App-private directory where Tor keeps its state. */
  dataDir: string;
  /** Local SOCKS port that Tor listens on (e.g. 9050). */
  socksPort: number;
  /**
   * Local port that the hidden service forwards to. When omitted the hidden
   * service targets {@link DEFAULT_HIDDEN_SERVICE_PORT}; `react-native-nitro-tor`
   * exposes no way to run a daemon without creating one.
   */
  hiddenServicePort?: number;
  /**
   * Circuit-rotation detection via the control port (ADR-0022) is **not
   * supported** by `react-native-nitro-tor@0.6.1` — it exposes no control-port
   * API. Supplying this throws instead of silently doing nothing.
   */
  controlPort?: number;
  /**
   * **Not supported** by `react-native-nitro-tor@0.6.1` — the library manages
   * the hidden-service directory itself. Supplying this throws instead of
   * silently doing nothing.
   */
  hiddenServiceDir?: string;
}

/** Per-request options for {@link TorManager.httpGet}/{@link TorManager.httpPost}/{@link TorManager.httpPut}. */
export interface TorRequestOptions {
  /**
   * Trust invalid TLS certificates. Defaults to `true` for `.onion` hosts and
   * `false` everywhere else. Only set this for a clearnet origin when it is
   * genuinely unavoidable — it disables authentication of the origin.
   */
  trustInvalidCerts?: boolean;
}

export function isOnionUrl(url: string): boolean {
  try {
    return ONION_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export class TorManager {
  private static instance: TorManager;
  private isRunning = false;
  private config: TorConfig | null = null;
  private onionAddress: string | null = null;

  private constructor() {}

  static getInstance(): TorManager {
    if (!TorManager.instance) {
      TorManager.instance = new TorManager();
    }
    return TorManager.instance;
  }

  async start(config: TorConfig): Promise<{ onionAddress?: string }> {
    // Fail loud: these options are accepted by the type but cannot be honoured
    // by react-native-nitro-tor, so silently ignoring them would mislead the
    // caller (e.g. into believing circuit-rotation detection works).
    if (config.controlPort !== undefined) {
      throw new Error(
        'TorManager: `controlPort` is not supported by react-native-nitro-tor — ' +
          'there is no control-port API. Remove it from the config (ADR-0022 circuit ' +
          'rotation detection is not implemented).',
      );
    }
    if (config.hiddenServiceDir !== undefined) {
      throw new Error(
        'TorManager: `hiddenServiceDir` is not supported by react-native-nitro-tor — ' +
          'the library manages the hidden-service directory itself.',
      );
    }

    if (this.isRunning) {
      return { onionAddress: this.onionAddress ?? undefined };
    }

    this.config = config;

    const result = await RnTor.startTorIfNotRunning({
      data_dir: config.dataDir,
      socks_port: config.socksPort,
      target_port: config.hiddenServicePort ?? DEFAULT_HIDDEN_SERVICE_PORT,
      timeout_ms: 60000,
    });

    if (result.is_success) {
      if (!result.onion_address) {
        throw new Error('Tor started but reported no onion address for the hidden service');
      }
      this.isRunning = true;
      this.onionAddress = result.onion_address;
      return { onionAddress: this.onionAddress };
    }

    throw new Error(`Failed to start Tor: ${result.error_message}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    await RnTor.shutdownService();
    this.isRunning = false;
    this.onionAddress = null;
  }

  async httpGet(
    url: string,
    headers: string = '',
    timeoutMs: number = 20000,
    options: TorRequestOptions = {},
  ): Promise<{ statusCode: number; body: string }> {
    const result = await RnTor.httpGet({
      url,
      headers,
      timeout_ms: timeoutMs,
      trust_invalid_certs: options.trustInvalidCerts ?? isOnionUrl(url),
    });
    if (result.error) {
      throw new Error(result.error);
    }
    return { statusCode: result.status_code, body: result.body };
  }

  async httpPost(
    url: string,
    body: string,
    headers: string = '',
    timeoutMs: number = 20000,
    options: TorRequestOptions = {},
  ): Promise<{ statusCode: number; body: string }> {
    const result = await RnTor.httpPost({
      url,
      body,
      headers,
      timeout_ms: timeoutMs,
      trust_invalid_certs: options.trustInvalidCerts ?? isOnionUrl(url),
    });
    if (result.error) {
      throw new Error(result.error);
    }
    return { statusCode: result.status_code, body: result.body };
  }

  async httpPut(
    url: string,
    body: string,
    headers: string = '',
    timeoutMs: number = 20000,
    options: TorRequestOptions = {},
  ): Promise<{ statusCode: number; body: string }> {
    const result = await RnTor.httpPut({
      url,
      body,
      headers,
      timeout_ms: timeoutMs,
      trust_invalid_certs: options.trustInvalidCerts ?? isOnionUrl(url),
    });
    if (result.error) {
      throw new Error(result.error);
    }
    return { statusCode: result.status_code, body: result.body };
  }

  getOnionAddress(): string | null {
    return this.onionAddress;
  }

  isTorRunning(): boolean {
    return this.isRunning;
  }
}
