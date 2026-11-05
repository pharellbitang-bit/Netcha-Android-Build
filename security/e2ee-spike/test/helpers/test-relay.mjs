import { randomUUID } from 'node:crypto';

/** Process-local test transport only; no production security or persistence. */
export function createTestRelay() {
  const devices = new Map(), identities = new Map(), prekeys = new Map();
  const mailboxes = new Map(), subscribers = new Map(), states = new Map();
  const audit = [];
  const key = (userId, deviceId = 1) => userId + ':' + deviceId;
  const now = () => Date.now();
  function deliver(recipientKey) {
    const callback = subscribers.get(recipientKey);
    if (!callback) return;
    for (const envelope of [...(mailboxes.get(recipientKey) ?? [])]) {
      Promise.resolve().then(() => callback(envelope)).then(() => {
        mailboxes.set(recipientKey, (mailboxes.get(recipientKey) ?? []).filter(item => item.messageId !== envelope.messageId));
      }).catch(error => audit.push({ op:'receive-error', error:error.message }));
    }
  }
  const relay = {
    audit,
    relayConnectionState: { state: 'stopped', since: now() },
    subscribeRelayConnectionState() { return () => {}; },
    async registerDevice(userId, device = {}) {
      audit.push({op:'registerDevice',userId});
      if (!devices.has(userId)) devices.set(userId, new Map());
      const owned = devices.get(userId), id = owned.size ? Math.max(...owned.keys()) + 1 : 1;
      owned.set(id, { deviceId:id, registered:true, linked:false, enabled:true, ...device });
      return id;
    },
    async getDevices(userId) { audit.push({op:'getDevices',userId}); return [...(devices.get(userId)?.values() ?? [])]; },
    async getActiveDevices(userId) { audit.push({op:'getActiveDevices',userId}); return [...(devices.get(userId)?.keys() ?? [])].map(deviceId => ({userId,deviceId})); },
    async removeDevice(userId, deviceId) { devices.get(userId)?.delete(deviceId); },
    async provisionIdentityKey(request) {
      audit.push({op:'provisionIdentityKey',userId:request.userId});
      const prior=identities.get(request.userId);
      if(prior && JSON.stringify(prior)!==JSON.stringify(request.identity)) throw new Error('IDENTITY_TUPLE_MISMATCH');
      identities.set(request.userId,request.identity);
      const device=devices.get(request.userId)?.get(request.deviceId);
      if(device) device.registrationId=request.registrationId;
      states.set(key(request.userId,request.deviceId),{identity:request.identity,registrationId:request.registrationId});
    },
    async rotateIdentityKey() { throw new Error('NOT_USED_IN_TEST'); },
    async getIdentityKey(userId) { return identities.get(userId) ?? null; },
    async uploadPreKeys(userId, deviceId, keys) {
      audit.push({op:'uploadPreKeys',userId,counts:keys.reduce((out,k)=>(out[k.type]=(out[k.type]??0)+1,out),{})});
      const k=key(userId,deviceId); if(!prekeys.has(k))prekeys.set(k,[]); prekeys.get(k).push(...keys);
    },
    async fetchPreKeyBundle(userId, deviceId) {
      audit.push({op:'fetchPreKeyBundle',userId,deviceId});
      const k=key(userId,deviceId), state=states.get(k), all=prekeys.get(k)??[];
      if(!state)return null;
      const signed=[...all].reverse().find(x=>x.type==='ecSignedPreKey');
      const kemLast=[...all].reverse().find(x=>x.type==='kemLastResortPreKey');
      const ec=all.findIndex(x=>x.type==='ecPreKey'), kem=all.findIndex(x=>x.type==='kemOneTimePreKey');
      const bundle={registrationId:state.registrationId,deviceId,identity:state.identity};
      if(signed)bundle.ecSignedPreKey={keyId:signed.keyId,publicKey:signed.publicKey,signature:signed.signature};
      if(kemLast)bundle.kemLastResortPreKey={keyId:kemLast.keyId,publicKey:kemLast.publicKey,signature:kemLast.signature};
      if(ec>=0)bundle.ecOneTimePreKey={keyId:all[ec].keyId,publicKey:all[ec].publicKey};
      if(kem>=0)bundle.kemOneTimePreKey={keyId:all[kem].keyId,publicKey:all[kem].publicKey,signature:all[kem].signature};
      if(ec>=0)all.splice(ec,1);
      if(kem>=0)all.splice(all.findIndex(x=>x.type==='kemOneTimePreKey'),1);
      return bundle;
    },
    async getPreKeyCount(userId,deviceId,type) { return (prekeys.get(key(userId,deviceId))??[]).filter(x=>type==='ec'?x.type==='ecPreKey':x.type==='kemOneTimePreKey').length; },
    async getPreKeyInventory(userId,deviceId) {
      const all=prekeys.get(key(userId,deviceId))??[];
      const metadata=type=>{const found=[...all].reverse().find(x=>x.type===type);return found?{keyId:found.keyId,publicKey:found.publicKey,createdAt:now(),expiresAt:now()+86400000}:null;};
      return {ecSignedPreKey:metadata('ecSignedPreKey'),kemLastResortPreKey:metadata('kemLastResortPreKey'),
        ecOneTimePreKeyCount:all.filter(x=>x.type==='ecPreKey').length,kemOneTimePreKeyCount:all.filter(x=>x.type==='kemOneTimePreKey').length};
    },
    async clearStaleKemPreKeys(userId,deviceId) { const all=prekeys.get(key(userId,deviceId))??[];const before=all.length;prekeys.set(key(userId,deviceId),all.filter(x=>x.type!=='kemOneTimePreKey'));return {cleared:before-prekeys.get(key(userId,deviceId)).length}; },
    async publishPlannedPreKeys(userId,deviceId,plan) { const inv=await this.getPreKeyInventory(userId,deviceId);const uploads=await plan(inv);if(uploads.length)await this.uploadPreKeys(userId,deviceId,uploads); },
    async getEcSignedPreKeyMetadata(userId,deviceId) { return (await this.getPreKeyInventory(userId,deviceId)).ecSignedPreKey; },
    async getKemLastResortPreKeyMetadata(userId,deviceId) { return (await this.getPreKeyInventory(userId,deviceId)).kemLastResortPreKey; },
    async send(envelope) {
      audit.push({op:'send',from:envelope.senderUserId,to:envelope.targetUserId,fromDevice:envelope.senderDeviceId,toDevice:envelope.targetDeviceId,type:envelope.messageType});
      const messageId=envelope.clientMessageId??randomUUID(), recipientKey=key(envelope.targetUserId,envelope.targetDeviceId);
      const stored={...envelope,id:messageId,messageId,serverTimestamp:now()};
      if(!mailboxes.has(recipientKey))mailboxes.set(recipientKey,[]);
      mailboxes.get(recipientKey).push(stored);deliver(recipientKey);
      return {messageId,serverTimestamp:stored.serverTimestamp};
    },
    subscribe(userId,deviceId,onEnvelope) {
      audit.push({op:'subscribe',userId,deviceId});
      const k=key(userId,deviceId);subscribers.set(k,onEnvelope);deliver(k);return ()=>subscribers.delete(k);
    },
    async markDelivered(envelopeId) { for(const [k,q] of mailboxes)mailboxes.set(k,q.filter(item=>item.id!==envelopeId&&item.messageId!==envelopeId)); },
  };
  return relay;
}
