import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';

function identityBytes(identity) {
  if (identity?.version !== 1) throw new Error('UNSUPPORTED_IDENTITY_VERSION');
  const dh = Buffer.from(identity.x25519PublicKey ?? '', 'base64');
  const signing = Buffer.from(identity.ed25519PublicKey ?? '', 'base64');
  if (dh.length !== 32 || signing.length !== 32) throw new Error('INVALID_COMPOSITE_IDENTITY');
  if (dh.toString('base64') !== identity.x25519PublicKey || signing.toString('base64') !== identity.ed25519PublicKey)
    throw new Error('NON_CANONICAL_COMPOSITE_IDENTITY');
  return Buffer.concat([Buffer.from([1,1]),dh,Buffer.from([2]),signing]);
}
function identityCommitment(identity) {
  return createHash('sha256').update('signal-protocol-js composite identity v1').update(identityBytes(identity)).digest();
}

/**
 * PostgreSQL persistence primitives for the Netcha E2EE relay.
 * The caller MUST derive accountId from a verified Netcha access token.
 * Never pass a client-supplied accountId as the authenticated principal.
 */
export class DurableRelayRepository {
  constructor(pool) { this.pool = pool; }

  async registerDevice(accountId, device = {}) {
    if (!accountId) throw new Error('AUTH_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identityType='aci';
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[accountId+':'+identityType]);
      const { rows } = await client.query(
        `SELECT device_id FROM e2ee_devices
         WHERE account_id=$1 AND identity_type=$2 AND enabled=true
         ORDER BY device_id FOR UPDATE`, [accountId, identityType]);
      const used = new Set(rows.map(r => Number(r.device_id)));
      let deviceId = 1;
      while (used.has(deviceId) && deviceId <= 5) deviceId++;
      if (deviceId > 5) throw new Error('DEVICE_LIMIT_REACHED');
      await client.query(
        `INSERT INTO e2ee_devices(account_id,device_id,identity_type)
         VALUES($1,$2,$3)`, [accountId, deviceId, identityType]);
      await client.query('COMMIT');
      return deviceId;
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
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
      const oneTime = [];
      for (const keyType of ['ecPreKey','kemOneTimePreKey']) {
        const claimed = await client.query(
          `WITH picked AS (
             SELECT id FROM e2ee_prekeys WHERE account_id=$1 AND device_id=$2
               AND identity_type=$3 AND key_type=$4 AND consumed_at IS NULL
             ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
           )
           UPDATE e2ee_prekeys p SET consumed_at=now()
           FROM picked WHERE p.id=picked.id
           RETURNING p.key_type,p.key_id,p.public_key,p.signature`,
          [accountId,deviceId,identityType,keyType]);
        oneTime.push(...claimed.rows);
      }
      const result = { registrationId:dev.rows[0].registration_id, deviceId, identity:dev.rows[0].identity_public_key };
      for (const p of fixed.rows) result[p.key_type] = p;
      for (const p of oneTime.rows) result[p.key_type] = p;
      if (!result.ecSignedPreKey || (!result.kemLastResortPreKey && !result.kemOneTimePreKey)) throw new Error('PREKEYS_NOT_READY');
      await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async enqueueEnvelope(authAccountId, senderDeviceId, envelope) {
    if (envelope.senderUserId !== authAccountId || envelope.senderDeviceId !== senderDeviceId) throw new Error('SENDER_MISMATCH');
    const sender = await this.pool.query(
      `SELECT registration_id FROM e2ee_devices WHERE account_id=$1 AND device_id=$2 AND enabled=true`,
      [authAccountId,senderDeviceId]);
    if(!sender.rowCount) throw new Error('SENDER_DEVICE_NOT_AUTHORIZED');
    const target = await this.pool.query(
      `SELECT device_id,registration_id FROM e2ee_devices
       WHERE account_id=$1 AND device_id=$2 AND identity_type='aci' AND enabled=true`,
      [envelope.targetUserId,envelope.targetDeviceId]);
    if(!target.rowCount) throw new Error('TARGET_DEVICE_NOT_AUTHORIZED');
    if(envelope.recipientRegistrationId!==undefined &&
       Number(target.rows[0].registration_id)!==Number(envelope.recipientRegistrationId))
      throw new Error('STALE_DEVICE');
    if(Array.isArray(envelope.declaredDeviceIds)) {
      const active=await this.pool.query(
        `SELECT device_id FROM e2ee_devices WHERE account_id=$1 AND identity_type='aci' AND enabled=true ORDER BY device_id`,
        [envelope.targetUserId]);
      const expected=active.rows.map(r=>Number(r.device_id)).sort((a,b)=>a-b);
      const declared=[...envelope.declaredDeviceIds].map(Number).sort((a,b)=>a-b);
      if(expected.length!==declared.length||expected.some((id,i)=>id!==declared[i]))
        throw new Error('DEVICE_SET_MISMATCH');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO e2ee_mailbox(client_message_id,sender_account_id,sender_device_id,
        target_account_id,target_device_id,identity_type,message_type,content_kind,delivery_class,timestamp_ms,ciphertext,operation_epoch_ms)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       WHERE EXISTS (SELECT 1 FROM e2ee_devices WHERE account_id=$2 AND device_id=$3
         AND identity_type=$6 AND enabled=true)
       AND EXISTS (SELECT 1 FROM e2ee_devices WHERE account_id=$4 AND device_id=$5
         AND identity_type=$6 AND enabled=true)
       ON CONFLICT(target_account_id,target_device_id,client_message_id)
       DO UPDATE SET client_message_id=EXCLUDED.client_message_id
       RETURNING id,client_message_id,created_at`,
      [envelope.clientMessageId ?? randomUUID(),authAccountId,senderDeviceId,envelope.targetUserId,
       envelope.targetDeviceId,'aci',envelope.messageType,envelope.contentKind ?? 'message',
       envelope.deliveryClass ?? 'user-visible',envelope.timestamp,envelope.ciphertext,envelope.operationEpochMilliseconds ?? null]);
    if (!rows[0]) throw new Error('DEVICE_NOT_AUTHORIZED');
    return rows[0];
  }

  async pendingEnvelopes(accountId, deviceId, limit = 100) {
    const { rows } = await this.pool.query(
      `SELECT id,client_message_id AS "clientMessageId",sender_account_id AS "senderUserId",
       sender_device_id AS "senderDeviceId",target_account_id AS "targetUserId",
       target_device_id AS "targetDeviceId",identity_type AS "identityType",
       message_type AS "messageType",content_kind AS "contentKind",delivery_class AS "deliveryClass",
       timestamp_ms AS timestamp,ciphertext,operation_epoch_ms AS "operationEpochMilliseconds",
       (extract(epoch from created_at)*1000)::bigint AS "serverTimestamp"
       FROM e2ee_mailbox WHERE target_account_id=$1 AND target_device_id=$2
       AND delivered_at IS NULL ORDER BY created_at LIMIT $3`,
      [accountId,deviceId,Math.min(Math.max(limit,1),250)]);
    return rows.map(row=>({...row,timestamp:Number(row.timestamp),serverTimestamp:Number(row.serverTimestamp),
      ...(row.operationEpochMilliseconds!==null?{operationEpochMilliseconds:Number(row.operationEpochMilliseconds)}:{})}));
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

  async getDevices(accountId) {
    const {rows}=await this.pool.query(
      `SELECT device_id,enabled,registration_id,encrypted_device_name,device_type,created_at
       FROM e2ee_devices WHERE account_id=$1 AND enabled=true ORDER BY device_id`,[accountId]);
    return rows.map(r=>({deviceId:r.device_id,registered:r.registration_id>0,linked:r.device_id!==1,
      enabled:r.enabled,...(r.encrypted_device_name?{encryptedDeviceName:r.encrypted_device_name}:{}),
      ...(r.device_type?{deviceType:r.device_type}:{}),createdAt:new Date(r.created_at).getTime()}));
  }

  async getActiveDevices(accountId) {
    const {rows}=await this.pool.query(
      `SELECT account_id AS "userId",device_id AS "deviceId" FROM e2ee_devices
       WHERE account_id=$1 AND enabled=true AND registration_id>0 ORDER BY device_id`,[accountId]);
    return rows;
  }

  async provisionIdentityKey(request) {
    const identity=request.identity;
    identityBytes(identity);
    const identityType=request.identityType ?? 'aci';
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const device=await client.query(
        `SELECT 1 FROM e2ee_devices WHERE account_id=$1 AND device_id=$2 AND identity_type=$3 AND enabled=true FOR UPDATE`,
        [request.userId,request.deviceId,identityType]);
      if(!device.rowCount) throw new Error('DEVICE_NOT_OWNED');
      const existing=await client.query(
        `SELECT identity_public_key FROM e2ee_account_identities
         WHERE account_id=$1 AND identity_type=$2 FOR UPDATE`,[request.userId,identityType]);
      if(existing.rowCount && !Buffer.from(identityBytes(existing.rows[0].identity_public_key)).equals(identityBytes(identity)))
        throw new Error('IDENTITY_TUPLE_MISMATCH');
      if(!existing.rowCount) await client.query(
        `INSERT INTO e2ee_account_identities(account_id,identity_type,identity_public_key)
         VALUES($1,$2,$3::jsonb)`,[request.userId,identityType,JSON.stringify(identity)]);
      await client.query(
        `UPDATE e2ee_devices SET identity_public_key=$4::jsonb,registration_id=$5,updated_at=now()
         WHERE account_id=$1 AND device_id=$2 AND identity_type=$3`,
        [request.userId,request.deviceId,identityType,JSON.stringify(identity),request.registrationId]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async rotateIdentityKey(request) {
    const identityType=request.identityType ?? 'aci';
    const expected=Buffer.from(request.expectedCurrentCommitment);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing=await client.query(
        `SELECT identity_public_key FROM e2ee_account_identities
         WHERE account_id=$1 AND identity_type=$2 FOR UPDATE`,[request.userId,identityType]);
      if(!existing.rowCount) throw new Error('IDENTITY_NOT_FOUND');
      const current=identityCommitment(existing.rows[0].identity_public_key);
      if(expected.length!==current.length || !timingSafeEqual(expected,current)) throw new Error('IDENTITY_COMMITMENT_MISMATCH');
      identityBytes(request.identity);
      await client.query(
        `UPDATE e2ee_account_identities SET identity_public_key=$3::jsonb,revision=revision+1,updated_at=now()
         WHERE account_id=$1 AND identity_type=$2`,
        [request.userId,identityType,JSON.stringify(request.identity)]);
      await client.query(
        `UPDATE e2ee_devices SET identity_public_key=$4::jsonb,
         registration_id=CASE WHEN device_id=$3 THEN $5 ELSE registration_id END,updated_at=now()
         WHERE account_id=$1 AND identity_type=$2`,
        [request.userId,identityType,request.deviceId,JSON.stringify(request.identity),request.registrationId]);
      await client.query(
        `DELETE FROM e2ee_prekeys WHERE account_id=$1 AND identity_type=$2`,[request.userId,identityType]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async getIdentityKey(accountId,identityType='aci') {
    const {rows}=await this.pool.query(
      `SELECT identity_public_key FROM e2ee_account_identities WHERE account_id=$1 AND identity_type=$2`,
      [accountId,identityType]);
    return rows[0]?.identity_public_key ?? null;
  }

  async getPreKeyCount(accountId,deviceId,type,identityType='aci') {
    const keyType=type==='ec'?'ecPreKey':'kemOneTimePreKey';
    const {rows}=await this.pool.query(
      `SELECT count(*)::int AS count FROM e2ee_prekeys WHERE account_id=$1 AND device_id=$2
       AND identity_type=$3 AND key_type=$4 AND consumed_at IS NULL`,
      [accountId,deviceId,identityType,keyType]);
    return rows[0].count;
  }

  async getPreKeyInventory(accountId,deviceId,identityType='aci') {
    const [ec,kem,counts]=await Promise.all([
      this.getEcSignedPreKeyMetadata(accountId,deviceId,identityType),
      this.getKemLastResortPreKeyMetadata(accountId,deviceId,identityType),
      this.pool.query(`SELECT key_type,count(*)::int AS count FROM e2ee_prekeys
        WHERE account_id=$1 AND device_id=$2 AND identity_type=$3 AND consumed_at IS NULL
        GROUP BY key_type`,[accountId,deviceId,identityType])
    ]);
    const map=new Map(counts.rows.map(r=>[r.key_type,r.count]));
    return {ecSignedPreKey:ec,kemLastResortPreKey:kem,
      ecOneTimePreKeyCount:map.get('ecPreKey')??0,kemOneTimePreKeyCount:map.get('kemOneTimePreKey')??0};
  }

  async getEcSignedPreKeyMetadata(accountId,deviceId,identityType='aci') {
    return this.prekeyMetadata(accountId,deviceId,identityType,'ecSignedPreKey');
  }
  async getKemLastResortPreKeyMetadata(accountId,deviceId,identityType='aci') {
    return this.prekeyMetadata(accountId,deviceId,identityType,'kemLastResortPreKey');
  }
  async prekeyMetadata(accountId,deviceId,identityType,keyType) {
    const {rows}=await this.pool.query(
      `SELECT key_id,public_key,created_at FROM e2ee_prekeys WHERE account_id=$1 AND device_id=$2
       AND identity_type=$3 AND key_type=$4 ORDER BY id DESC LIMIT 1`,
      [accountId,deviceId,identityType,keyType]);
    if(!rows[0]) return null;
    const createdAt=new Date(rows[0].created_at).getTime();
    return {keyId:Number(rows[0].key_id),publicKey:rows[0].public_key,createdAt,expiresAt:createdAt+7*86400000};
  }

  async clearStaleKemPreKeys(accountId,deviceId,identityType='aci') {
    const {rowCount}=await this.pool.query(
      `DELETE FROM e2ee_prekeys WHERE account_id=$1 AND device_id=$2 AND identity_type=$3
       AND key_type='kemOneTimePreKey' AND consumed_at IS NULL`,[accountId,deviceId,identityType]);
    return {cleared:rowCount};
  }

  async publishPlannedPreKeys(accountId,deviceId,plan,identityType='aci') {
    const inventory=await this.getPreKeyInventory(accountId,deviceId,identityType);
    const keys=await plan(inventory);
    if(keys.length) await this.uploadPrekeys(accountId,deviceId,identityType,keys);
  }

  async createGroup(groupId,creatorAccountId,encryptedState,memberAccountIds=[]) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO e2ee_groups(group_id,encrypted_state,created_by)
         VALUES($1,$2::jsonb,$3)`,[groupId,JSON.stringify(encryptedState),creatorAccountId]);
      const members=new Set([creatorAccountId,...memberAccountIds]);
      for(const accountId of members) await client.query(
        `INSERT INTO e2ee_group_members(group_id,account_id,role,active,joined_version)
         VALUES($1,$2,$3,true,0)`,[groupId,accountId,accountId===creatorAccountId?'owner':'member']);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async enqueueGroupEnvelope(authAccountId, senderDeviceId, envelope) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const group = await client.query(
        `SELECT state_version,sender_key_epoch FROM e2ee_groups WHERE group_id=$1 FOR SHARE`,
        [envelope.groupId]);
      if (!group.rowCount) throw new Error('GROUP_NOT_FOUND');
      if (Number(group.rows[0].state_version)!==Number(envelope.stateVersion) ||
          Number(group.rows[0].sender_key_epoch)!==Number(envelope.senderKeyEpoch))
        throw new Error('STALE_GROUP_EPOCH');
      const sender = await client.query(
        `SELECT 1 FROM e2ee_group_members WHERE group_id=$1 AND account_id=$2 AND active=true`,
        [envelope.groupId,authAccountId]);
      const target = await client.query(
        `SELECT 1 FROM e2ee_group_members gm JOIN e2ee_devices d
         ON d.account_id=gm.account_id AND d.enabled=true
         WHERE gm.group_id=$1 AND gm.account_id=$2 AND gm.active=true
         AND d.device_id=$3`,[envelope.groupId,envelope.targetUserId,envelope.targetDeviceId]);
      if (!sender.rowCount || !target.rowCount) throw new Error('GROUP_DEVICE_NOT_AUTHORIZED');
      const { rows } = await client.query(
        `INSERT INTO e2ee_group_envelopes(group_id,state_version,sender_key_epoch,
         sender_account_id,sender_device_id,target_account_id,target_device_id,client_message_id,ciphertext)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(target_account_id,target_device_id,client_message_id)
         DO UPDATE SET client_message_id=EXCLUDED.client_message_id
         RETURNING id,client_message_id,created_at`,
        [envelope.groupId,envelope.stateVersion,envelope.senderKeyEpoch,authAccountId,
         senderDeviceId,envelope.targetUserId,envelope.targetDeviceId,envelope.id,envelope.ciphertext]);
      await client.query('COMMIT');
      return rows[0];
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
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
      const actor = await client.query(
        `SELECT role FROM e2ee_group_members WHERE group_id=$1 AND account_id=$2
         AND active=true FOR UPDATE`,[groupId,actorAccountId]);
      if (!actor.rowCount || !['owner','admin'].includes(actor.rows[0].role))
        throw new Error('GROUP_CHANGE_FORBIDDEN');
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
