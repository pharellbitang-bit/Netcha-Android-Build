import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { createTestRelay } from './helpers/test-relay.mjs';

async function until(check, label, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('TIMEOUT_WAITING_FOR_' + label + (last ? ': ' + last.message : ''));
}

test('REAL THREE-PARTY CRYPTO: removed Cara decrypts history but cannot decrypt post-rotation group messages', async t => {
  const relay = createTestRelay();
  const users = ['alice-' + randomUUID(), 'bob-' + randomUUID(), 'cara-' + randomUUID()];
  const clients = await Promise.all(users.map(userId => createSignalProtocolClient({
    identity: { userId },
    adapters: { storage: inMemoryStore(), relay },
  })));
  const [alice, bob, cara] = clients;
  t.after(async () => {
    for (const client of clients) {
      try { client.stopRelaySubscription(); } catch {}
    }
  });

  await Promise.all(clients.map(client => client.syncToServer()));
  // The SDK requires this hook before a relay subscription can process
  // pairwise-encrypted sender-key distribution envelopes.
  bob.registerHook('onMessageDecrypted', async () => {});
  cara.registerHook('onMessageDecrypted', async () => {});
  bob.startRelaySubscription();
  cara.startRelaySubscription();
  const groupId = 'netcha-revocation-' + randomUUID();

  await alice.createGroupSenderKey(groupId);
  await alice.distributeGroupSenderKey(groupId, [users[1], users[2]]);
  await until(async () => await bob.hasGroupSenderKey(groupId) && await cara.hasGroupSenderKey(groupId), 'INITIAL_KEYS_ON_BOB_AND_CARA');

  const beforeRemoval = await alice.encryptGroupMessage(groupId, 'historical-message-before-removal');
  assert.equal(await bob.decryptGroupMessage(groupId, users[0], 1, beforeRemoval), 'historical-message-before-removal');
  assert.equal(await cara.decryptGroupMessage(groupId, users[0], 1, beforeRemoval), 'historical-message-before-removal');

  const caraBefore = await cara.getGroupSenderKeyStats(groupId, users[0], 1);
  assert.ok(caraBefore && Number.isInteger(caraBefore.generation), 'Cara must hold a real sender-key generation before removal');

  const rotation = await alice.handleGroupMembershipChange(groupId, 'member_removed');
  assert.equal(rotation.rotated, true, 'membership removal must rotate the sender key');
  await alice.distributeSenderKeyToUser(groupId, users[1]);

  await until(async () => {
    const stats = await bob.getGroupSenderKeyStats(groupId, users[0], 1);
    return stats && Number.isInteger(stats.generation) && stats.generation > caraBefore.generation;
  }, 'ROTATED_KEY_ON_REMAINING_BOB');

  const afterRemoval = await alice.encryptGroupMessage(groupId, 'confidential-message-after-removal');
  assert.equal(await bob.decryptGroupMessage(groupId, users[0], 1, afterRemoval), 'confidential-message-after-removal');
  await assert.rejects(
    cara.decryptGroupMessage(groupId, users[0], 1, afterRemoval),
    undefined,
    'removed member must not decrypt ciphertext created after sender-key rotation'
  );
  const caraAfter = await cara.getGroupSenderKeyStats(groupId, users[0], 1);
  assert.equal(caraAfter.generation, caraBefore.generation, 'removed member must not receive the rotated sender-key generation');
});
