import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { keyValueStore } from '@open-e2ee/signal-protocol-sdk/local/store/key-value';
import { CapacitorNativeSignalSecretVault } from './capacitor-native-vault.mjs';
import { CapacitorSqlCipherKeyValueBackend } from './capacitor-sqlcipher-kv-backend.mjs';
import { NetchaDurableSignalRelay } from './http-relay-adapter.mjs';

/**
 * Android/iOS WebView client composition.
 * Ratchet/session/sender-key state is persisted in a native SQLCipher DB.
 * The DB passphrase and SDK record-encryption key are held in Android Keystore
 * / iOS Keychain. There is intentionally no memory/localStorage fallback.
 */
export async function createNetchaE2EEClient({ identity, relay, relayUrl, getAccessToken, hooks = {} }) {
  if (!identity?.userId || !Number.isInteger(identity.deviceId) || (!relay && (!relayUrl || !getAccessToken)))
    throw new Error('E2EE_IDENTITY_AND_RELAY_REQUIRED');
  const durableRelay = relay ?? new NetchaDurableSignalRelay({
    baseUrl: relayUrl, getAccessToken, userId: identity.userId, deviceId: identity.deviceId
  });
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle)
    throw new Error('SECURE_WEBCRYPTO_UNAVAILABLE');

  const vault = new CapacitorNativeSignalSecretVault();
  const namespace = `netcha.signal.v1:${identity.userId}:${identity.deviceId}`;
  const backend = await CapacitorSqlCipherKeyValueBackend.open({ namespace });
  const storage = await keyValueStore({ storage: backend, vault });
  if (!storage.protection) throw new Error('E2EE_STORAGE_PROTECTION_UNDECLARED');

  return createSignalProtocolClient({
    identity,
    adapters: { storage, relay: durableRelay },
    hooks
  });
}
