import test from 'node:test';
import assert from 'node:assert/strict';
import { streamingEncrypt, streamingDecrypt } from '@open-e2ee/signal-protocol-sdk/files';

test('streaming media AEAD encrypts bytes, decrypts intact data, and rejects tampering/truncation', async () => {
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const associatedData = new TextEncoder().encode('Netcha synthetic media test');
  const plaintext = Uint8Array.from({ length: 300 }, (_, index) => (index * 17) % 251);

  // A small segment size forces multiple authenticated chunks in this CI fixture.
  const encrypted = await streamingEncrypt(key, plaintext, associatedData, 128);
  assert.equal(encrypted.segmentSize, 128);
  assert.notDeepEqual(encrypted.ciphertext, plaintext);
  assert.equal(
    Buffer.from(encrypted.ciphertext).includes(Buffer.from(plaintext)),
    false,
    'plaintext bytes must not appear as a contiguous sequence in stored ciphertext'
  );

  const recovered = await streamingDecrypt(
    key,
    encrypted.ciphertext,
    associatedData,
    { segmentSize: encrypted.segmentSize }
  );
  assert.deepEqual(recovered, plaintext);

  const tampered = encrypted.ciphertext.slice();
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    streamingDecrypt(key, tampered, associatedData, { segmentSize: encrypted.segmentSize }),
    'modified authenticated media bytes must be rejected'
  );

  const truncated = encrypted.ciphertext.slice(0, -1);
  await assert.rejects(
    streamingDecrypt(key, truncated, associatedData, { segmentSize: encrypted.segmentSize }),
    'truncated media streams must be rejected'
  );
});
