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

test('REAL FOUR-PARTY CRYPTO: removed Cara retains history but cannot decrypt group messages after sender-key rotation', async t => {
  const relay = createTestRelay();
  const users = ['alice', 'bob', 'cara', 'david'].map(name => name + '-' + randomUUID());
  const clients = await Promise.all(users.map(userId => createSignalProtocolClient({
    identity: { userId },
    adapters: { storage: inMemoryStore(), relay },
  })));
  const [alice, bob, cara, david] = clients;
  const recipients = [bob, cara, david];
  t.after(async () => {
    for (const client of clients) {
      try { client.stopRelaySubscription(); } catch {}
    }
  });

  await Promise.all(clients.map(client => client.syncToServer()));
  // Sender-key distribution is a pairwise-encrypted ordinary message.
  // The application must parse it and install the sender key explicitly.
  for (const client of recipients) {
    client.registerHook('onMessageDecrypted', async event => {
      let parsed;
      try { parsed = JSON.parse(event.content); } catch { return; }
      if (!parsed || typeof parsed !== 'object' || !parsed.senderKeyVersion || !parsed.groupId) return;
      const distribution = {
        senderKeyVersion: parsed.senderKeyVersion,
        senderKeyId: parsed.senderKeyId,
        chainId: parsed.chainId,
        chainIndex: parsed.chainIndex,
        generation: parsed.generation,
        chainKey: parsed.chainKey,
        publicSignatureKey: parsed.publicSignatureKey,
      };
      await client.processGroupSenderKeyDistribution(
        parsed.groupId, event.senderId, event.senderDeviceId, distribution
      );
    });
  }
  for (const client of recipients) client.startRelaySubscription();
  const groupId = 'netcha-revocation-' + randomUUID();

  await alice.createGroupSenderKey(groupId);
  // Sequential fan-out preserves per-recipient session setup and makes a
  // failed pairwise distribution observable instead of hiding it in allSettled.
  for (const memberId of users.slice(1)) {
    try { await alice.distributeSenderKeyToUser(groupId, memberId); }
    catch (error) {
      throw new Error('INITIAL_SENDER_KEY_DISTRIBUTION_FAILED:' + memberId + ':' + error.message +
        ' | relay audit=' + JSON.stringify(relay.audit));
    }
  }
  await until(async () => {
    return await bob.hasGroupSenderKey(groupId) &&
      await cara.hasGroupSenderKey(groupId) &&
      await david.hasGroupSenderKey(groupId);
  }, 'INITIAL_KEYS_ON_ALL_THREE_MEMBERS');

  const beforeRemoval = await alice.encryptGroupMessage(groupId, 'historical-message-before-removal');
  for (const client of recipients) {
    assert.equal(await client.decryptGroupMessage(groupId, users[0], 1, beforeRemoval),
      'historical-message-before-removal');
  }

  const caraBefore = await cara.getGroupSenderKeyStats(groupId, users[0], 1);
  const davidBefore = await david.getGroupSenderKeyStats(groupId, users[0], 1);
  assert.ok(caraBefore && Number.isInteger(caraBefore.generation), 'Cara must hold the old sender-key generation');
  assert.ok(davidBefore && Number.isInteger(davidBefore.generation), 'David must hold the old sender-key generation');

  const rotation = await alice.handleGroupMembershipChange(groupId, 'member_removed');
  assert.equal(rotation.rotated, true, 'membership removal must rotate the sender key');
  await alice.distributeSenderKeyToUser(groupId, users[1]);
  await alice.distributeSenderKeyToUser(groupId, users[3]);

  await until(async () => {
    const bobStats = await bob.getGroupSenderKeyStats(groupId, users[0], 1);
    const davidStats = await david.getGroupSenderKeyStats(groupId, users[0], 1);
    return bobStats?.generation > caraBefore.generation &&
      davidStats?.generation > davidBefore.generation;
  }, 'ROTATED_KEY_ON_REMAINING_BOB_AND_DAVID');

  const afterRemoval = await alice.encryptGroupMessage(groupId, 'confidential-message-after-removal');
  assert.equal(await bob.decryptGroupMessage(groupId, users[0], 1, afterRemoval),
    'confidential-message-after-removal');
  assert.equal(await david.decryptGroupMessage(groupId, users[0], 1, afterRemoval),
    'confidential-message-after-removal');
  await assert.rejects(
    cara.decryptGroupMessage(groupId, users[0], 1, afterRemoval),
    undefined,
    'removed member must not decrypt ciphertext created after sender-key rotation'
  );
  const caraAfter = await cara.getGroupSenderKeyStats(groupId, users[0], 1);
  assert.equal(caraAfter.generation, caraBefore.generation,
    'removed member must not receive the rotated sender-key generation');
});
