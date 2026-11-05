const bytesToBase64 = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const base64ToBytes = value => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const bytesToHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');

import { streamingEncrypt, streamingDecrypt } from '@open-e2ee/signal-protocol-sdk/files';

/**
 * Encrypt an attachment on-device before any remote upload.
 * The returned pointer (including its key) MUST be sent only inside an
 * already-established pairwise/group encrypted message. Never POST pointer.
 */
export async function prepareEncryptedAttachment({ bytes, scope, segmentSize = 64 * 1024 }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('EMPTY_ATTACHMENT');
  if (!scope || typeof scope !== 'string') throw new Error('ATTACHMENT_SCOPE_REQUIRED');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const attachmentId = crypto.randomUUID();
  const associatedData = new TextEncoder().encode('netcha:e2ee:attachment:v1:' + scope + ':' + attachmentId);
  const encrypted = await streamingEncrypt(key, bytes, associatedData, segmentSize);
  const digest = await crypto.subtle.digest('SHA-256', encrypted.ciphertext);
  const pointer = {
    version: 1,
    attachmentId,
    scope,
    keyBase64: bytesToBase64(key),
    segmentSize: encrypted.segmentSize,
    ciphertextSize: encrypted.ciphertext.byteLength,
    ciphertextSha256: bytesToHex(new Uint8Array(digest))
  };
  return { pointer, ciphertext: encrypted.ciphertext };
}

/** Downloaded ciphertext is authenticated and decrypted only after message decryption. */
export async function openEncryptedAttachment({ pointer, ciphertext, expectedScope }) {
  if (pointer?.version !== 1 || pointer.scope !== expectedScope) throw new Error('ATTACHMENT_SCOPE_MISMATCH');
  if (!(ciphertext instanceof Uint8Array) || ciphertext.byteLength !== pointer.ciphertextSize)
    throw new Error('ATTACHMENT_SIZE_MISMATCH');
  const digest = await crypto.subtle.digest('SHA-256', ciphertext);
  if (bytesToHex(new Uint8Array(digest)) !== pointer.ciphertextSha256)
    throw new Error('ATTACHMENT_INTEGRITY_FAILURE');
  const key = base64ToBytes(pointer.keyBase64);
  if (key.byteLength !== 32) throw new Error('ATTACHMENT_KEY_INVALID');
  const associatedData = new TextEncoder().encode('netcha:e2ee:attachment:v1:' + expectedScope + ':' + pointer.attachmentId);
  return streamingDecrypt(key, ciphertext, associatedData, { segmentSize: pointer.segmentSize });
}
