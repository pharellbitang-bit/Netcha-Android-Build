import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentEncryptedOutbox, attachPersistentEncryptedOutbox } from '../client/persistent-encrypted-outbox.mjs';

function memoryStorage(seed = new Map()) {
  return {
    data: seed,
    async getAllKeys() { return [...this.data.keys()]; },
    async getItem(key) { return this.data.get(key) ?? null; },
    async setItem(key, value) { this.data.set(key, value); },
    async removeItem(key) { this.data.delete(key); },
  };
}

const fixture = () => ({
  clientMessageId: 'msg-offline-001',
  senderUserId: 'alice', senderDeviceId: 1,
  targetUserId: 'bob', targetDeviceId: 1,
  messageType: 'ciphertext', contentKind: 'message', deliveryClass: 'user-visible',
  timestamp: 1793860000000,
  ciphertext: new Uint8Array([11, 22, 33, 44, 55, 66]),
});

test('offline ciphertext survives process restart and is delivered once after reconnect', async () => {
  const persistentData = new Map();
  const firstStorage = memoryStorage(persistentData);
  const offlineRelay = { async send() { throw Object.assign(new Error('network down'), { code: 'ECONNRESET' }); } };
  const first = attachPersistentEncryptedOutbox(offlineRelay, firstStorage);
  await assert.rejects(first.relay.send(fixture()), error => error.queuedForRetry === true);
  assert.equal(await first.pendingCount(), 1);

  const stored = [...persistentData.values()].join('\n');
  assert.equal(stored.includes('plaintext'), false);
  assert.equal(stored.includes('Hello Bob'), false);
  assert.ok(stored.includes('CxYhLDdC'), 'only the base64 ciphertext is persisted');

  // A new app process gets a new wrapper and relay, but the encrypted SQLCipher
  // namespace is the same, so the pending envelope is recovered.
  const delivered = [];
  const onlineRelay = { async send(envelope) { delivered.push(envelope); return { messageId: 'server-1' }; } };
  const restarted = attachPersistentEncryptedOutbox(onlineRelay, memoryStorage(persistentData));
  const result = await restarted.flush();
  assert.deepEqual(result, { sent: 1, blocked: 0, remaining: 0 });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].clientMessageId, 'msg-offline-001');
  assert.deepEqual([...delivered[0].ciphertext], [11, 22, 33, 44, 55, 66]);
  assert.equal(await restarted.pendingCount(), 0);
});

test('duplicate queueing with the same client message ID creates one durable envelope', async () => {
  const storage = memoryStorage();
  const outbox = new PersistentEncryptedOutbox(storage);
  await outbox.enqueue(fixture());
  await outbox.enqueue(fixture());
  assert.equal(await outbox.pendingCount(), 1);
});

test('permanent authorization errors block instead of silently discarding ciphertext', async () => {
  const storage = memoryStorage();
  const outbox = new PersistentEncryptedOutbox(storage);
  await assert.rejects(outbox.send(fixture(), async () => {
    throw Object.assign(new Error('device revoked'), { status: 403 });
  }));
  const keys = await storage.getAllKeys();
  const record = JSON.parse(await storage.getItem(keys[0]));
  assert.equal(record.state, 'blocked');
  assert.equal(record.lastErrorCode, 'HTTP_403');
  assert.equal(await outbox.pendingCount(), 1);
  const attempted = [];
  const result = await outbox.flush(async envelope => attempted.push(envelope));
  assert.deepEqual(result, { sent: 0, blocked: 1, remaining: 1 });
  assert.equal(attempted.length, 0);
});

test('retryable failures retain order and stop a flush until the relay is reachable', async () => {
  const storage = memoryStorage();
  const outbox = new PersistentEncryptedOutbox(storage);
  await outbox.enqueue({ ...fixture(), clientMessageId: 'msg-1' });
  await outbox.enqueue({ ...fixture(), clientMessageId: 'msg-2' });
  const first = await outbox.flush(async () => { throw Object.assign(new Error('offline'), { status: 503 }); });
  assert.deepEqual(first, { sent: 0, blocked: 0, remaining: 2 });
  const sent = [];
  const second = await outbox.flush(async envelope => sent.push(envelope.clientMessageId));
  assert.deepEqual(sent, ['msg-1', 'msg-2']);
  assert.deepEqual(second, { sent: 2, blocked: 0, remaining: 0 });
});

test('a successful mailbox poll automatically flushes pending ciphertext after reconnect', async () => {
  const storage = memoryStorage();
  const delivered = [];
  const relay = {
    async send(envelope) { delivered.push(envelope.clientMessageId); return { messageId: 'server-auto' }; },
    async request(path) { return { path, envelopes: [] }; },
  };
  const attached = attachPersistentEncryptedOutbox(relay, storage);
  const outbox = new PersistentEncryptedOutbox(storage);
  await outbox.enqueue({ ...fixture(), clientMessageId: 'msg-auto-flush' });
  await attached.relay.request('/v1/e2ee/mailbox/pull?limit=100');
  for (let i = 0; i < 30 && await attached.pendingCount(); i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(delivered, ['msg-auto-flush']);
  assert.equal(await attached.pendingCount(), 0);
});
