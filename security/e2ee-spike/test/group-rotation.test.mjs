import test from 'node:test';
import assert from 'node:assert/strict';
import { removeGroupMemberWithRotation } from '../client/group-rotation.mjs';

test('group removal commits a new epoch before rotating and never distributes to the removed member', async () => {
  const events=[];
  const result=await removeGroupMemberWithRotation({
    signal:{
      async handleGroupMembershipChange(groupId,kind){events.push(['rotate',groupId,kind]);return {rotated:true,distributionMessage:{opaque:true}}},
      async distributeSenderKeyToUser(groupId,userId){events.push(['distribute',groupId,userId])}
    },
    relayApi:{async commitMembershipChange(input){events.push(['commit',input.removedAccountId]);return {version:4,senderKeyEpoch:3,mustRotateSenderKey:true}}},
    groupId:'group-lab',actorAccountId:'alice',removedAccountId:'cara',
    expectedVersion:3,encryptedGroupState:{ciphertext:'state'},encryptedChange:{ciphertext:'change'},
    remainingMemberIds:['alice','bob']
  });
  assert.deepEqual(events,[
    ['commit','cara'],['rotate','group-lab','member_removed'],
    ['distribute','group-lab','alice'],['distribute','group-lab','bob']
  ]);
  assert.equal(result.rotated,true);
  assert.equal(events.some(e=>e[2]==='cara'),false);
});

test('group removal fails closed if durable relay does not advance sender-key epoch', async () => {
  await assert.rejects(removeGroupMemberWithRotation({
    signal:{async handleGroupMembershipChange(){throw new Error('must not rotate yet')}},
    relayApi:{async commitMembershipChange(){return {version:2,senderKeyEpoch:1,mustRotateSenderKey:false}}},
    groupId:'g',actorAccountId:'a',removedAccountId:'b',expectedVersion:1,
    encryptedGroupState:{},encryptedChange:{},remainingMemberIds:['a']
  }),/GROUP_ROTATION_BARRIER_MISSING/);
});
