import { randomUUID } from 'node:crypto';

/**
 * PostgreSQL persistence primitives for the Netcha E2EE relay.
 * The caller MUST derive accountId from a verified Netcha access token.
 * Never pass a client-supplied accountId as the authenticated principal.
 */
export class DurableRelayRepository {
  constructor(pool) { this.pool = pool; }

  async registerDevice(accountId, identityType = 'aci') {
    if (!accountId) throw new Error('AUTH_REQUIRED');
    const { rows } = await this.pool.query(
      `SELECT device_id FROM e2ee_devices
       WHERE account_id=$1 AND identity_type=$2 AND enabled=true
       ORDER BY device_id FOR UPDATE`, [accountId, identityType]);
    const used = new Set(rows.map(r => Number(r.device_id)));
    let deviceId = 1;
    while (used.has(deviceId) && deviceId <= 5) deviceId++;
    if (deviceId > 5) throw new Error('DEVICE_LIMIT_REACHED');
    await this.pool.query(
      `INSERT INTO e2ee_devices(account_id,device_id,identity_type)
       VALUES($1,$2,$3)`, [accountId, deviceId, identityType]);
    return deviceId;
  }

  async publishIdentity(accountId, deviceId, identityType, publicKey) {
    const { rowCount } = await this.pool.query(
      `UPDATE e2ee_devices SET identity_public_key=$4::jsonb,updated_at=now()
       WHERE account_id=$1 AND device_id=$2 AND identity_type=$3 AND enabled=true`,
      [accountId, deviceId, identityType, JSON.stringify(publicKey)]);
    if (!rowCount) throw new Error('DEVICE_NOT_OWNED');
  }

  async uploadPrekeys(accountId, deviceId, identityType, keys) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query(
        `SELECT 1 FROM e2ee_devices WHERE account_id=$1 AND device_id=$2
         AND identity_type=$3 AND enabled=true FOR UPDATE`,
        [accountId,deviceId,identityType]);
      if (!owned.rowCount) throw new Error('DEVICE_NOT_OWNED');
      for (const k of keys) {
        await client.query(
          `INSERT INTO e2ee_prekeys(account_id,device_id,identity_type,key_type,key_id,public_key,signature)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [accountId,deviceId,identityType,k.type,k.keyId,k.publicKey,k.signature ?? null]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  // Atomic claim: concurrent callers can never receive the same one-time prekey.
  async fetchPrekeyBundle(accountId, deviceId, identityType = 'aci') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dev = await client.query(
        `SELECT identity_public_key FROM e2ee_devices
         WHERE account_id=$1 AND device_id=$2 AND identity_type=$3 AND enabled=true FOR UPDATE`,
        [accountId,deviceId,identityType]);
      if (!dev.rowCount || !dev.rows[0].identity_public_key) throw new Error('DEVICE_NOT_READY');
      const fixed = await client.query(
        `SELECT key_type,key_id,public_key,signature FROM e2ee_prekeys
         WHERE account_id=$1 AND device_id=$2 AND identity_type=$3
         AND key_type IN ('ecSignedPreKey','kemLastResortPreKey')
         AND consumed_at IS NULL ORDER BY id DESC`,
        [accountId,deviceId,identityType]);
      const oneTime = await client.query(
        `WITH picked AS (
           SELECT id FROM e2ee_prekeys WHERE account_id=$1 AND device_id=$2
             AND identity_type=$3 AND key_type IN ('ecPreKey','kemOneTimePreKey')
             AND consumed_at IS NULL ORDER BY id
             FOR UPDATE SKIP LOCKED LIMIT 2
         )
         UPDATE e2ee_prekeys p SET consumed_at=now()
         FROM picked WHERE p.id=picked.id
         RETURNING p.key_type,p.key_id,p.public_key,p.signature`,
        [accountId,deviceId,identityType]);
      const result = { identity: dev.rows[0].identity_public_key };
      for (const p of fixed.rows) result[p.key_type] = p;
      for (const p of oneTime.rows) result[p.key_type] = p;
      if (!result.ecSignedPreKey || !result.kemLastResortPreKey) throw new Error('PREKEYS_NOT_READY');
      await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async enqueueEnvelope(authAccountId, senderDeviceId, envelope) {
    if (envelope.senderUserId !== authAccountId) throw new Error('SENDER_MISMATCH');
    const { rows } = await this.pool.query(
      `INSERT INTO e2ee_mailbox(client_message_id,sender_account_id,sender_device_id,
        target_account_id,target_device_id,identity_type,message_type,content_kind,ciphertext,operation_epoch_ms)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
       WHERE EXISTS (SELECT 1 FROM e2ee_devices WHERE account_id=$2 AND device_id=$3
         AND identity_type=$6 AND enabled=true)
       AND EXISTS (SELECT 1 FROM e2ee_devices WHERE account_id=$4 AND device_id=$5
         AND identity_type=$6 AND enabled=true)
       ON CONFLICT(target_account_id,target_device_id,client_message_id)
       DO UPDATE SET client_message_id=EXCLUDED.client_message_id
       RETURNING id,client_message_id,created_at`,
      [envelope.id ?? randomUUID(),authAccountId,senderDeviceId,envelope.targetUserId,
       envelope.targetDeviceId,envelope.identityType ?? 'aci',envelope.messageType,
       envelope.contentKind ?? 'message',envelope.ciphertext,envelope.operationEpochMilliseconds ?? null]);
    if (!rows[0]) throw new Error('DEVICE_NOT_AUTHORIZED');
    return rows[0];
  }

  async pendingEnvelopes(accountId, deviceId, limit = 100) {
    const { rows } = await this.pool.query(
      `SELECT id,client_message_id AS "clientMessageId",sender_account_id AS "senderUserId",
       sender_device_id AS "senderDeviceId",target_account_id AS "targetUserId",
       target_device_id AS "targetDeviceId",identity_type AS "identityType",
       message_type AS "messageType",content_kind AS "contentKind",ciphertext,
       operation_epoch_ms AS "operationEpochMilliseconds",created_at AS "serverTimestamp"
       FROM e2ee_mailbox WHERE target_account_id=$1 AND target_device_id=$2
       AND delivered_at IS NULL ORDER BY created_at LIMIT $3`,
      [accountId,deviceId,Math.min(Math.max(limit,1),250)]);
    return rows;
  }

  async acknowledge(accountId, deviceId, envelopeId) {
    const { rowCount } = await this.pool.query(
      `UPDATE e2ee_mailbox SET delivered_at=now()
       WHERE id=$1 AND target_account_id=$2 AND target_device_id=$3 AND delivered_at IS NULL`,
      [envelopeId,accountId,deviceId]);
    if (!rowCount) throw new Error('ENVELOPE_NOT_FOUND_OR_ACKED');
  }

  async removeDevice(accountId, deviceId, identityType='aci') {
    const { rowCount } = await this.pool.query(
      `UPDATE e2ee_devices SET enabled=false,updated_at=now()
       WHERE account_id=$1 AND device_id=$2 AND identity_type=$3 AND enabled=true`,
      [accountId,deviceId,identityType]);
    if (!rowCount) throw new Error('DEVICE_NOT_FOUND');
    await this.pool.query(
      `UPDATE e2ee_mailbox SET delivered_at=now()
       WHERE target_account_id=$1 AND target_device_id=$2 AND identity_type=$3 AND delivered_at IS NULL`,
      [accountId,deviceId,identityType]);
  }

  // Membership state is opaque ciphertext. Removal increments sender_key_epoch
  // in the same transaction; callers must rotate and redistribute before send.
  async commitGroupChange(groupId, actorAccountId, expectedVersion, encryptedState, encryptedChange, membershipOps) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT state_version,sender_key_epoch FROM e2ee_groups WHERE group_id=$1 FOR UPDATE`,[groupId]);
      if (!rows[0] || Number(rows[0].state_version) !== Number(expectedVersion)) throw new Error('GROUP_VERSION_CONFLICT');
      const nextVersion = Number(expectedVersion)+1;
      const removes = membershipOps.filter(x=>x.action==='remove');
      const adds = membershipOps.filter(x=>x.action==='add');
      const nextEpoch = Number(rows[0].sender_key_epoch) + (removes.length ? 1 : 0);
      await client.query(
        `UPDATE e2ee_groups SET state_version=$2,sender_key_epoch=$3,
         encrypted_state=$4::jsonb,updated_at=now() WHERE group_id=$1`,
        [groupId,nextVersion,nextEpoch,JSON.stringify(encryptedState)]);
      for (const op of removes) {
        await client.query(
          `UPDATE e2ee_group_members SET active=false,removed_version=$3
           WHERE group_id=$1 AND account_id=$2 AND active=true`,[groupId,op.accountId,nextVersion]);
      }
      for (const op of adds) {
        await client.query(
          `INSERT INTO e2ee_group_members(group_id,account_id,role,active,joined_version)
           VALUES($1,$2,'member',true,$3)
           ON CONFLICT(group_id,account_id) DO UPDATE SET role='member',active=true,
             joined_version=$3,removed_version=NULL`,[groupId,op.accountId,nextVersion]);
      }
      await client.query(
        `INSERT INTO e2ee_group_changes(group_id,version,actor_account_id,encrypted_change,sender_key_epoch)
         VALUES($1,$2,$3,$4::jsonb,$5)`,
        [groupId,nextVersion,actorAccountId,JSON.stringify(encryptedChange),nextEpoch]);
      await client.query('COMMIT');
      return { version:nextVersion, senderKeyEpoch:nextEpoch, mustRotateSenderKey:removes.length>0 };
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
}
