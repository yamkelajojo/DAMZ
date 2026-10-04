/**
 * IPFSStorage — Dual backend: Meshkit S3 (primary) + Helia (opt-in)
 *
 * Client-side AES-256-GCM encryption before upload.
 * Meshkit for v1 simplicity, Helia for v2 decentralization.
 */

import { createS3Client } from '@ipfs-meshkit/meshkit';

export interface StorageBackend {
  upload(data: Uint8Array): Promise<string>; // Returns CID
  download(cid: string): Promise<Uint8Array>;
  delete(cid: string): Promise<void>;
  pin(cid: string): Promise<void>;
  unpin(cid: string): Promise<void>;
}

export interface MeshkitConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string; // MinIO .onion URL
  region?: string;
}

export interface HeliaConfig {
  // Helia config for v2
  // Custom storage adapter for React Native
}

export type StorageBackendType = 'meshkit' | 'helia';

export class IPFSStorage {
  private static instance: IPFSStorage;
  private meshkitClient: any;
  private heliaClient: any;
  private currentBackend: StorageBackendType = 'meshkit';

  private constructor() {}

  static getInstance(): IPFSStorage {
    if (!IPFSStorage.instance) {
      IPFSStorage.instance = new IPFSStorage();
    }
    return IPFSStorage.instance;
  }

  initializeMeshkit(config: MeshkitConfig): void {
    this.meshkitClient = createS3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region ?? 'auto',
    });
    this.currentBackend = 'meshkit';
  }

  async initializeHelia(config: HeliaConfig): Promise<void> {
    // Dynamic import for Helia (heavy)
    // const { createHelia } = await import('helia');
    // const { createLibp2p } = await import('libp2p');
    // this.heliaClient = await createHelia({ ... });
    this.currentBackend = 'helia';
    throw new Error('Helia backend not yet implemented (v2)');
  }

  setBackend(backend: StorageBackendType): void {
    if (backend === 'helia' && !this.heliaClient) {
      throw new Error('Helia not initialized');
    }
    this.currentBackend = backend;
  }

  getBackend(): StorageBackendType {
    return this.currentBackend;
  }

  async upload(data: Uint8Array): Promise<string> {
    if (this.currentBackend === 'meshkit') {
      if (!this.meshkitClient) {
        throw new Error('Meshkit not initialized');
      }
      const cid = await this.meshkitClient.upload(data);
      return cid;
    }

    if (this.currentBackend === 'helia') {
      if (!this.heliaClient) {
        throw new Error('Helia not initialized');
      }
      // const cid = await this.heliaClient.addBytes(data);
      // return cid.toString();
      throw new Error('Helia backend not yet implemented (v2)');
    }

    throw new Error('No backend configured');
  }

  async download(cid: string): Promise<Uint8Array> {
    if (this.currentBackend === 'meshkit') {
      if (!this.meshkitClient) {
        throw new Error('Meshkit not initialized');
      }
      const data = await this.meshkitClient.download(cid);
      return data;
    }

    throw new Error('Helia download not yet implemented (v2)');
  }

  async delete(cid: string): Promise<void> {
    if (this.currentBackend === 'meshkit') {
      if (!this.meshkitClient) {
        throw new Error('Meshkit not initialized');
      }
      await this.meshkitClient.delete(cid);
      return;
    }

    throw new Error('Helia delete not yet implemented (v2)');
  }

  async pin(cid: string): Promise<void> {
    // Meshkit handles pinning via MinIO retention
    // Helia would use IPFS pinning
  }

  async unpin(cid: string): Promise<void> {
    // Meshkit: delete from MinIO
    // Helia: unpin from IPFS
  }

  // Encrypt data before upload (AES-256-GCM)
  static async encrypt(data: Uint8Array, key: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }> {
    const crypto = globalThis.crypto || require('crypto').webcrypto;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
    const tag = new Uint8Array(ciphertext.slice(-16));
    const encrypted = new Uint8Array(ciphertext.slice(0, -16));
    return { ciphertext: encrypted, iv, tag };
  }

  // Decrypt data after download
  static async decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    iv: Uint8Array,
    tag: Uint8Array
  ): Promise<Uint8Array> {
    const crypto = globalThis.crypto || require('crypto').webcrypto;
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, combined);
    return new Uint8Array(decrypted);
  }
}