import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { SignalProtocolLocalSecretVault } from '@open-e2ee/signal-protocol-sdk/local/vault';

/**
 * Capacitor Android Keystore / iOS Keychain vault.
 * Stores only small random wrapping keys, never ratchet/session records.
 * Missing secrets are returned as null; callers must fail closed if the
 * encrypted database already exists.
 */
const PREFIX = 'netcha.e2ee.v1.';
const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

export class CapacitorNativeSignalSecretVault implements SignalProtocolLocalSecretVault {
  async getSecret(name: string): Promise<Uint8Array | null> {
    if (!name || name.includes('..')) throw new Error('INVALID_SECRET_NAME');
    const value = await SecureStorage.getItem(PREFIX + name);
    if (value === null) return null;
    try {
      const decoded = fromBase64(value);
      if (decoded.byteLength !== 32) throw new Error('INVALID_SECRET_LENGTH');
      return decoded;
    } catch {
      throw new Error('SECRET_VAULT_CORRUPTED');
    }
  }

  async setSecret(name: string, value: Uint8Array): Promise<void> {
    if (!name || name.includes('..') || value.byteLength !== 32)
      throw new Error('INVALID_SECRET');
    await SecureStorage.setItem(PREFIX + name, toBase64(value));
  }

  async deleteSecret(name: string): Promise<void> {
    if (!name || name.includes('..')) throw new Error('INVALID_SECRET_NAME');
    await SecureStorage.removeItem(PREFIX + name);
  }
}
