import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const PREFIX = 'netcha.e2ee.v1.';
const toBase64 = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = value => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

/** Native Android Keystore / iOS Keychain vault for small 32-byte wrapping keys. */
export class CapacitorNativeSignalSecretVault {
  async getSecret(name) {
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
  async setSecret(name, value) {
    if (!name || name.includes('..') || !(value instanceof Uint8Array) || value.byteLength !== 32)
      throw new Error('INVALID_SECRET');
    await SecureStorage.setItem(PREFIX + name, toBase64(value));
  }
  async deleteSecret(name) {
    if (!name || name.includes('..')) throw new Error('INVALID_SECRET_NAME');
    await SecureStorage.removeItem(PREFIX + name);
  }
}
