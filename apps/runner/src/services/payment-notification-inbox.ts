import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import {
  DIDManager,
  receiveNextPaymentNotification,
  RelayClient,
  TorManager,
  type DIDKeyPair,
  type PaymentConfirmedNotification,
} from '@damz/core';
import { getRunnerPaymentNotificationReplayStore } from '@damz/db';

const RUNNER_IDENTITY_KEY = 'damz.runner.payment.identity.v1';
const TOR_DATA_DIRECTORY = 'damz-tor';
const POLL_INTERVAL_MS = 15_000;
const RETRY_INTERVAL_MS = 30_000;

export type PaymentInboxStatus = 'not-configured' | 'starting' | 'ready' | 'error';

export interface PaymentInboxState {
  status: PaymentInboxStatus;
  runnerDid?: string;
  runnerOnionHash?: string;
}

export interface PaymentInboxHandlers {
  onStateChange(state: PaymentInboxState): void;
  onNotification(notification: PaymentConfirmedNotification): void;
}

export interface PaymentInboxController {
  retry(): void;
  stop(): void;
}

/**
 * Starts foreground Tor inbox polling for the Runner app. Notifications are
 * end-to-end encrypted, and each accepted event is durably deduplicated before
 * it reaches the UI. iOS may suspend polling while this app is in the
 * background; the relay inbox is checked again when the app becomes active.
 */
export function startPaymentNotificationInbox(
  handlers: PaymentInboxHandlers,
): PaymentInboxController {
  const relayUrl = process.env.EXPO_PUBLIC_DAMZ_RELAY_ONION_URL?.trim();
  const gatewayDid = process.env.EXPO_PUBLIC_DAMZ_GATEWAY_DID?.trim();
  const tor = TorManager.getInstance();

  let disposed = false;
  let connecting = false;
  let connectRequested = false;
  let polling = false;
  let runnerIdentity: DIDKeyPair | null = null;
  let relay: RelayClient | null = null;
  let recipientOnionHash: string | null = null;
  let replayStore: Awaited<ReturnType<typeof getRunnerPaymentNotificationReplayStore>> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const schedulePoll = (delay = POLL_INTERVAL_MS) => {
    if (
      disposed ||
      pollTimer ||
      AppState.currentState !== 'active' ||
      !relay ||
      !runnerIdentity ||
      !recipientOnionHash ||
      !replayStore
    ) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void pollOnce();
    }, delay);
  };

  const pollOnce = async () => {
    if (
      disposed ||
      polling ||
      AppState.currentState !== 'active' ||
      !relay ||
      !runnerIdentity ||
      !recipientOnionHash ||
      !replayStore ||
      !gatewayDid
    ) {
      return;
    }

    polling = true;
    const activeIdentity = runnerIdentity;
    const activeRelay = relay;
    const activeRecipientHash = recipientOnionHash;
    const activeReplayStore = replayStore;
    try {
      const notification = await receiveNextPaymentNotification({
        relay: activeRelay,
        recipientOnionHash: activeRecipientHash,
        gatewayDid,
        runnerDid: activeIdentity.did,
        runnerEd25519PrivateKeyMultibase: activeIdentity.privateKeyMultibase,
        replayStore: activeReplayStore,
      });
      if (disposed) return;
      // The receiver has already persisted a new event before returning. If
      // iOS backgrounded the app during the request, the next foreground
      // connection restores it from the database instead of updating a
      // suspended screen here.
      if (AppState.currentState !== 'active') return;
      handlers.onStateChange({
        status: 'ready',
        runnerDid: activeIdentity.did,
        runnerOnionHash: activeRecipientHash,
      });
      if (notification) handlers.onNotification(notification);
      schedulePoll();
    } catch {
      // Do not forward transport or crypto error details to logs/UI. They may
      // contain relay or identity information; retry with a bounded cadence.
      if (!disposed && AppState.currentState === 'active') {
        handlers.onStateChange({
          status: 'error',
          runnerDid: activeIdentity.did,
          runnerOnionHash: activeRecipientHash,
        });
        schedulePoll(RETRY_INTERVAL_MS);
      }
    } finally {
      polling = false;
    }
  };

  const connect = async () => {
    if (disposed || !relayUrl || !gatewayDid) return;
    if (connecting) {
      // Preserve a foreground/retry request that arrives while a previous
      // connection attempt is unwinding after an app-state transition.
      connectRequested = true;
      return;
    }
    if (AppState.currentState !== 'active') return;

    connecting = true;
    connectRequested = false;
    handlers.onStateChange({ status: 'starting' });
    try {
      const relayClient = new RelayClient(relayUrl, tor);
      await DIDManager.getInstance().resolveDID(gatewayDid);
      const identity = await loadOrCreateRunnerIdentity();
      const openedReplayStore = await getRunnerPaymentNotificationReplayStore();
      const latestNotification = await openedReplayStore.getLatest();
      if (latestNotification) handlers.onNotification(latestNotification);

      if (disposed) return;
      if (AppState.currentState !== 'active') return;

      const directoryUri = FileSystem.documentDirectory;
      if (!directoryUri) throw new Error('Runner document directory is unavailable.');
      const torDirectoryUri = `${directoryUri}${TOR_DATA_DIRECTORY}`;
      const torDirectoryInfo = await FileSystem.getInfoAsync(torDirectoryUri);
      if (!torDirectoryInfo.exists) {
        await FileSystem.makeDirectoryAsync(torDirectoryUri, { intermediates: true });
      }
      const dataDir = fileUriToNativePath(torDirectoryUri);
      const { onionAddress } = await tor.start({ dataDir, socksPort: 9050 });
      if (!onionAddress) throw new Error('Tor did not return a Runner onion address.');
      const onionHash = await recipientHashFromOnionAddress(onionAddress);

      if (disposed) {
        await tor.stop();
        return;
      }
      if (AppState.currentState !== 'active') return;
      runnerIdentity = identity;
      recipientOnionHash = onionHash;
      replayStore = openedReplayStore;
      relay = relayClient;
      handlers.onStateChange({
        status: 'ready',
        runnerDid: identity.did,
        runnerOnionHash: onionHash,
      });
      void pollOnce();
    } catch {
      if (!disposed) {
        handlers.onStateChange({ status: 'error' });
      }
    } finally {
      connecting = false;
      if (connectRequested && !disposed && AppState.currentState === 'active') {
        connectRequested = false;
        void connect();
      }
    }
  };

  if (!relayUrl || !gatewayDid) {
    handlers.onStateChange({ status: 'not-configured' });
    return { retry: () => undefined, stop: () => undefined };
  }

  const appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      if (runnerIdentity && relay && recipientOnionHash) {
        void pollOnce();
      } else {
        // connect() records this request if an earlier attempt is still
        // unwinding; otherwise it starts immediately.
        void connect();
      }
    } else {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = undefined;
      // Drop the controller's key reference while inactive. An already-running
      // receive call retains its local reference until that request settles;
      // any accepted event is persisted before the call returns. The identity
      // is reloaded from device-only secure storage on foreground resume.
      runnerIdentity = null;
    }
  });

  void connect();

  return {
    retry: () => {
      void connect();
    },
    stop: () => {
      disposed = true;
      clearTimers();
      appStateSubscription.remove();
      runnerIdentity = null;
      relay = null;
      recipientOnionHash = null;
      replayStore = null;
      void tor.stop();
    },
  };
}

async function loadOrCreateRunnerIdentity(): Promise<DIDKeyPair> {
  const stored = await SecureStore.getItemAsync(RUNNER_IDENTITY_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (stored) {
    let identity: Partial<DIDKeyPair>;
    try {
      identity = JSON.parse(stored) as Partial<DIDKeyPair>;
    } catch {
      throw new Error('Stored Runner identity is malformed.');
    }
    if (
      typeof identity.did !== 'string' ||
      !identity.did.startsWith('did:key:z') ||
      typeof identity.publicKeyMultibase !== 'string' ||
      typeof identity.privateKeyMultibase !== 'string' ||
      !identity.privateKeyMultibase.startsWith('z')
    ) {
      throw new Error('Stored Runner identity is incomplete.');
    }
    return identity as DIDKeyPair;
  }

  const identity = await DIDManager.getInstance().generateDID();
  await SecureStore.setItemAsync(RUNNER_IDENTITY_KEY, JSON.stringify(identity), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return identity;
}

function fileUriToNativePath(uri: string): string {
  if (!uri.startsWith('file://')) throw new Error('Tor data directory is not a file URI.');
  return decodeURIComponent(new URL(uri).pathname);
}

async function recipientHashFromOnionAddress(onionAddress: string): Promise<string> {
  const host = onionAddress.toLowerCase().replace(/\.onion$/, '');
  const encoded = decodeBase32(host);
  if (encoded.length !== 35 || encoded[34] !== 3) {
    throw new Error('Tor returned an invalid v3 onion address.');
  }

  // The relay addresses inboxes by SHA-256 of the Tor v3 public key bytes.
  const publicKey = encoded.subarray(0, 32);
  const publicKeyBuffer = new ArrayBuffer(publicKey.byteLength);
  new Uint8Array(publicKeyBuffer).set(publicKey);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', publicKeyBuffer),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase32(value: string): Uint8Array {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Tor returned an invalid onion hostname.');
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits !== 0) throw new Error('Tor returned an invalid onion hostname.');
  return Uint8Array.from(output);
}
