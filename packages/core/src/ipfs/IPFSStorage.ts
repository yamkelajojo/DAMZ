/**
 * IPFSStorage — Dual backend: Meshkit S3 (primary) + Helia (opt-in)
 *
 * Client-side AES-256-GCM encryption before upload.
 * Meshkit for v1 simplicity, Helia for v2 decentralization.
 */

import { createS3Client, MeshkitClient, UploadOptions, RetrieveOptions } from '@ipfs-meshkit/meshkit';

/**
 * WebCrypto handle for {@link IPFSStorage.encrypt} / {@link IPFSStorage.decrypt}.
 *
 * Deliberately not falling back to `require('crypto')`: that is a Node builtin a
 * React Native bundle cannot resolve, so the fallback only ever turned a clear
 * capability gap into a confusing module-resolution error on device.
 */
function requireWebCrypto() {
  const available = globalThis.crypto;
  if (!available || !available.subtle) {
    throw new Error(
      'AES-256-GCM requires WebCrypto, but globalThis.crypto.subtle is unavailable. ' +
        'Node 19+ provides it natively; on React Native install a WebCrypto polyfill ' +
        'before using IPFSStorage encryption.',
    );
  }
  return available;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

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
}

/**
 * Configuration for the opt-in Helia backend.
 *
 * Intentionally empty for now: `initializeHelia` is a fail-loud stub until Helia
 * is wired up in v2, so there are no fields to configure yet.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HeliaConfig {
  // Helia config for v2
  // Custom storage adapter for React Native
}

export type StorageBackendType = 'meshkit' | 'helia';

export class IPFSStorage {
  private static instance: IPFSStorage;
  private meshkitClient: MeshkitClient | null = null;
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
      const options: UploadOptions = {};
      const cid = await this.meshkitClient.upload(data, options);
      return cid;
    }

    if (this.currentBackend === 'helia') {
      if (!this.heliaClient) {
        throw new Error('Helia not initialized');
      }
      throw new Error('Helia backend not yet implemented (v2)');
    }

    throw new Error('No backend configured');
  }

  async download(cid: string): Promise<Uint8Array> {
    if (this.currentBackend === 'meshkit') {
      if (!this.meshkitClient) {
        throw new Error('Meshkit not initialized');
      }
      const options: RetrieveOptions = {};
      const data = await this.meshkitClient.retrieve(cid, options);
      return data;
    }

    throw new Error('Helia download not yet implemented (v2)');
  }

  async delete(cid: string): Promise<void> {
    // The meshkit S3 client has no delete operation. Silently succeeding here
    // would let callers believe content was erased while it is still readable,
    // which is a privacy problem for encrypted-but-addressable blobs.
    throw new Error(
      `IPFSStorage.delete(${cid}) is not implemented for the ${this.currentBackend} backend. ` +
        'Delete the object through the S3 provider directly, or use a backend that supports deletion.'
    );
  }

  async pin(cid: string): Promise<void> {
    if (this.currentBackend !== 'meshkit') {
      throw new Error(
        `IPFSStorage.pin is not implemented for the ${this.currentBackend} backend`
      );
    }
    if (!this.meshkitClient) {
      throw new Error('Meshkit not initialized');
    }
    await this.meshkitClient.pin(cid);
  }

  async unpin(cid: string): Promise<void> {
    // No unpin on the meshkit client — see `delete` above.
    throw new Error(
      `IPFSStorage.unpin(${cid}) is not implemented for the ${this.currentBackend} backend.`
    );
  }

  // Encrypt data before upload (AES-256-GCM)
  static async encrypt(data: Uint8Array, key: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }> {
    const crypto = requireWebCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(key),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      cryptoKey,
      toArrayBuffer(data),
    );
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
    const crypto = requireWebCrypto();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(key),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      cryptoKey,
      toArrayBuffer(combined),
    );
    return new Uint8Array(decrypted);
  }
}
