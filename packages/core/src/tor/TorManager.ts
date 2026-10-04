/**
 * TorManager — Wrapper for react-native-nitro-tor
 *
 * Manages Tor daemon lifecycle, hidden services, and HTTP over Tor.
 */

import { RnTor } from 'react-native-nitro-tor';

export interface TorConfig {
  dataDir: string;
  socksPort: number;
  controlPort: number;
  hiddenServiceDir?: string;
  hiddenServicePort?: number;
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
    if (this.isRunning) {
      return { onionAddress: this.onionAddress ?? undefined };
    }

    this.config = config;

    const result = await RnTor.startTorIfNotRunning({
      data_dir: config.dataDir,
      socks_port: config.socksPort,
      control_port: config.controlPort,
      target_port: config.hiddenServicePort ?? 8080,
      timeout_ms: 60000,
    });

    if (result.is_success) {
      this.isRunning = true;
      this.onionAddress = result.onion_address;
      return { onionAddress: this.onionAddress ?? undefined };
    }

    throw new Error(`Failed to start Tor: ${result.error}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // RnTor doesn't have explicit stop, but we can track state
    this.isRunning = false;
    this.onionAddress = null;
  }

  async httpGet(url: string, headers: string = '', timeoutMs: number = 20000): Promise<{ statusCode: number; body: string }> {
    const result = await RnTor.httpGet({ url, headers, timeout_ms: timeoutMs });
    return { statusCode: result.status_code, body: result.body };
  }

  async httpPost(url: string, body: string, headers: string = '', timeoutMs: number = 20000): Promise<{ statusCode: number; body: string }> {
    const result = await RnTor.httpPost({ url, body, headers, timeout_ms: timeoutMs });
    return { statusCode: result.status_code, body: result.body };
  }

  getOnionAddress(): string | null {
    return this.onionAddress;
  }

  isTorRunning(): boolean {
    return this.isRunning;
  }
}