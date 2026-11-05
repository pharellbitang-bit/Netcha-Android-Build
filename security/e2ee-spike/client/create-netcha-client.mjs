import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { webSqliteStore } from '@open-e2ee/signal-protocol-sdk/local/store/web-sqlite';
import { CapacitorNativeSignalSecretVault } from './capacitor-native-vault.mjs';

/**
 * Android/iOS WebView client composition.
 * SQLCipher database is stored in OPFS; its random 32-byte wrapping key is
 * stored by the Capacitor SecureStorage native plugin (Android Keystore /
 * iOS Keychain). There is intentionally no IndexedDB/localStorage fallback.
 */
export async function createNetchaE2EEClient({ identity, relay, hooks = {} }) {
  if (!identity?.userId || !relay) throw new Error('E2EE_IDENTITY_AND_RELAY_REQUIRED');
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle)
    throw new Error('SECURE_WEBCRYPTO_UNAVAILABLE');
  const vault = new CapacitorNativeSignalSecretVault();
  const storage = await webSqliteStore({
    name: 'netcha-signal-protocol.db',
    vault,
    encryptionAtRest: true
  });
  // webSqliteStore refuses to open when SQLCipher is unavailable or disabled.
  return createSignalProtocolClient({
    identity,
    adapters: { storage, relay },
    hooks,
    protocol: { requirePostQuantum: true }
  });
}
