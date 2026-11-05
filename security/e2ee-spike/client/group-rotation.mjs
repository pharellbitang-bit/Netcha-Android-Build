/**
 * Group removal barrier for the Netcha lab.
 *
 * The durable relay first advances the membership revision and sender-key
 * epoch. It rejects all sends from the previous epoch immediately. The sender
 * then rotates its local Signal sender key and distributes the new key only
 * to the remaining members over their established pairwise sessions.
 */
export async function removeGroupMemberWithRotation({
  signal, relayApi, groupId, actorAccountId, removedAccountId,
  expectedVersion, encryptedGroupState, encryptedChange, remainingMemberIds
}) {
  const committed = await relayApi.commitMembershipChange({
    groupId, actorAccountId, removedAccountId, expectedVersion,
    encryptedGroupState, encryptedChange
  });
  if (!committed.mustRotateSenderKey || !Number.isInteger(committed.senderKeyEpoch))
    throw new Error('GROUP_ROTATION_BARRIER_MISSING');

  const rotation = await signal.handleGroupMembershipChange(groupId, 'member_removed');
  if (!rotation.rotated || !rotation.distributionMessage)
    throw new Error('GROUP_SENDER_KEY_ROTATION_FAILED');

  // Every distribution travels over pairwise encrypted sessions. The removed
  // member is deliberately absent from this allow-list.
  for (const memberId of remainingMemberIds) {
    if (memberId === removedAccountId) throw new Error('REMOVED_MEMBER_IN_ROTATION_TARGETS');
    await signal.distributeSenderKeyToUser(groupId, memberId);
  }
  return { ...committed, rotated: true, distributionMessage: rotation.distributionMessage };
}
