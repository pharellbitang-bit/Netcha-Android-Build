import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { DurableRelayRepository } from '../relay/durable-relay-repository.mjs';

const url = process.env.E2EE_TEST_DATABASE_URL;
test('durable relay persists mailboxes, atomically consumes prekeys and rotates group epoch on removal',
  { skip: !url }, async t => {
  let pool = new pg.Pool({ connectionString:url, max:8 });
  const schema = await readFile(new URL('../relay/001_durable_relay.sql', import.meta.url),'utf8');
  await pool.query(schema);
  const repo = new DurableRelayRepository(pool);
  const suffix = crypto.randomUUID();
  const alice = 'alice-'+suffix, bob = 'bob-'+suffix, cara = 'cara-'+suffix;
  const [aliceDevice,bobDevice,caraDevice] = await Promise.all([
    repo.registerDevice(alice),repo.registerDevice(bob),repo.registerDevice(cara)
  ]);
  t.after(async()=>{await pool.query('DELETE FROM e2ee_devices WHERE account_id = ANY($1)',[[alice,bob,cara]]);await pool.query('DELETE FROM e2ee_groups WHERE group_id=$1',['g-'+suffix]);await pool.end()});

  const publicKey=Buffer.alloc(32).toString('base64');
  await repo.provisionIdentityKey({userId:bob,deviceId:bobDevice,registrationId:77,
    identity:{version:1,x25519PublicKey:publicKey,ed25519PublicKey:publicKey}});
  await repo.uploadPrekeys(bob,bobDevice,'aci',[
    {type:'ecSignedPreKey',keyId:1,publicKey:publicKey,signature:'c2lnbmF0dXJl'},
    {type:'kemLastResortPreKey',keyId:2,publicKey:publicKey,signature:'c2lnbmF0dXJl'},
    {type:'ecPreKey',keyId:3,publicKey:publicKey},
    {type:'ecPreKey',keyId:4,publicKey:publicKey},
    {type:'kemOneTimePreKey',keyId:5,publicKey:publicKey,signature:'c2lnbmF0dXJl'},
    {type:'kemOneTimePreKey',keyId:6,publicKey:publicKey,signature:'c2lnbmF0dXJl'}
  ]);
  const [bundleA,bundleB] = await Promise.all([
    repo.fetchPrekeyBundle(bob,bobDevice),repo.fetchPrekeyBundle(bob,bobDevice)
  ]);
  assert.notEqual(bundleA.ecPreKey?.keyId,bundleB.ecPreKey?.keyId);
  assert.notEqual(bundleA.kemOneTimePreKey?.keyId,bundleB.kemOneTimePreKey?.keyId);
  assert.equal(bundleA.registrationId,77);
  assert.equal(bundleA.identity.version,1);

  const envelope = {id:'client-'+suffix,senderUserId:alice,targetUserId:bob,targetDeviceId:bobDevice,
    messageType:'ciphertext',ciphertext:'opaque-ciphertext-fixture'};
  await repo.enqueueEnvelope(alice,aliceDevice,envelope);
  const pending = await repo.pendingEnvelopes(bob,bobDevice);
  assert.equal(pending.length,1);
  assert.equal(pending[0].ciphertext,'opaque-ciphertext-fixture');
  await pool.end();
  pool = new pg.Pool({connectionString:url});
  const durable = new DurableRelayRepository(pool);
  const afterRestart = await durable.pendingEnvelopes(bob,bobDevice);
  assert.equal(afterRestart.length,1,'unacknowledged mailbox envelope survives relay process restart');
  await durable.acknowledge(bob,bobDevice,afterRestart[0].id);
  assert.equal((await durable.pendingEnvelopes(bob,bobDevice)).length,0);

  const groupId='g-'+suffix;
  await pool.query(
    `INSERT INTO e2ee_groups(group_id,encrypted_state,created_by) VALUES($1,$2::jsonb,$3)`,
    [groupId,JSON.stringify({ciphertext:'opaque-state'}),alice]);
  await pool.query(
    `INSERT INTO e2ee_group_members(group_id,account_id,role,active,joined_version)
     VALUES($1,$2,'owner',true,1),($1,$3,'member',true,1),($1,$4,'member',true,1)`,
    [groupId,alice,bob,cara]);
  const change=await durable.commitGroupChange(groupId,alice,0,{ciphertext:'state-v2'},
    {ciphertext:'member-removed'},[{action:'remove',accountId:cara}]);
  assert.equal(change.version,1);
  assert.equal(change.senderKeyEpoch,2);
  assert.equal(change.mustRotateSenderKey,true);
  const membership=await pool.query(
    'SELECT active,removed_version FROM e2ee_group_members WHERE group_id=$1 AND account_id=$2',
    [groupId,cara]);
  assert.equal(membership.rows[0].active,false);
  assert.equal(Number(membership.rows[0].removed_version),1);
  const persisted=await pool.query('SELECT sender_key_epoch FROM e2ee_groups WHERE group_id=$1',[groupId]);
  assert.equal(Number(persisted.rows[0].sender_key_epoch),2);
  await assert.rejects(
    durable.enqueueGroupEnvelope(cara,caraDevice,{groupId,stateVersion:1,senderKeyEpoch:2,
      targetUserId:bob,targetDeviceId:bobDevice,id:'removed-member-'+suffix,ciphertext:'ciphertext'}),
    /GROUP_DEVICE_NOT_AUTHORIZED/
  );
  await assert.rejects(
    durable.enqueueGroupEnvelope(alice,aliceDevice,{groupId,stateVersion:1,senderKeyEpoch:1,
      targetUserId:bob,targetDeviceId:bobDevice,id:'stale-epoch-'+suffix,ciphertext:'ciphertext'}),
    /STALE_GROUP_EPOCH/
  );
  await durable.enqueueGroupEnvelope(alice,aliceDevice,{groupId,stateVersion:1,senderKeyEpoch:2,
    targetUserId:bob,targetDeviceId:bobDevice,id:'valid-group-'+suffix,ciphertext:'group-ciphertext'});
  const groupEnvelope=await pool.query('SELECT ciphertext FROM e2ee_group_envelopes WHERE group_id=$1',[groupId]);
  assert.equal(groupEnvelope.rows[0].ciphertext,'group-ciphertext');
});
