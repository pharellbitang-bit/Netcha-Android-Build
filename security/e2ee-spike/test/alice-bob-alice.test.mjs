import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';

class IsolatedMemoryRelay {
  devices = new Map([['alice',[{deviceId:1,registered:true,linked:false,enabled:true}]],['bob',[{deviceId:1,registered:true,linked:false,enabled:true}]]]);
  identities = new Map(); inventories = new Map(); listeners = new Map(); envelopes = []; deliveredEnvelopes = []; acknowledged = new Set(); nextId=0; tamperNext=false;
  relayConnectionState={state:'connected',since:Date.now()};
  key(u,d,t='aci'){return u+':'+d+':'+t}
  inventory(u,d,t='aci'){const k=this.key(u,d,t);if(!this.inventories.has(k))this.inventories.set(k,{ecSignedPreKey:null,kemLastResortPreKey:null,ecPreKey:[],kemOneTimePreKey:[]});return this.inventories.get(k)}
  async registerDevice(u,info={}){const id=info.deviceId??1,a=this.devices.get(u)??[];if(!a.some(x=>x.deviceId===id))a.push({deviceId:id,registered:true,linked:id!==1,enabled:true});this.devices.set(u,a);return id}
  async getDevices(u){return structuredClone(this.devices.get(u)??[])}
  async getActiveDevices(u){return (this.devices.get(u)??[]).filter(x=>x.enabled&&x.registered).map(x=>({userId:u,deviceId:x.deviceId}))}
  async removeDevice(u,id){this.devices.set(u,(this.devices.get(u)??[]).filter(x=>x.deviceId!==id))}
  async provisionIdentityKey(r){const k=this.key(r.userId,r.deviceId,r.identityType),old=this.identities.get(k);if(old&&JSON.stringify(old)!==JSON.stringify(r.identity))throw Error('identity tuple mismatch');this.identities.set(k,r.identity)}
  async getIdentityKey(u,t='aci'){for(const [k,v] of this.identities)if(k.startsWith(u+':')&&k.endsWith(':'+t))return v;return null}
  async rotateIdentityKey(){throw Error('rotation unsupported in isolated test')}
  meta(x){return {keyId:x.keyId,publicKey:x.publicKey,createdAt:Date.now(),expiresAt:Date.now()+86400000}}
  async getPreKeyInventory(u,d,t='aci'){const x=this.inventory(u,d,t);return {ecSignedPreKey:x.ecSignedPreKey?this.meta(x.ecSignedPreKey):null,kemLastResortPreKey:x.kemLastResortPreKey?this.meta(x.kemLastResortPreKey):null,ecOneTimePreKeyCount:x.ecPreKey.length,kemOneTimePreKeyCount:x.kemOneTimePreKey.length}}
  async getPreKeyCount(u,d,k,t='aci'){const x=this.inventory(u,d,t);return k==='ec'?x.ecPreKey.length:x.kemOneTimePreKey.length}
  async uploadPreKeys(u,d,ps,t='aci'){const x=this.inventory(u,d,t);for(const p of ps){if(p.type==='ecSignedPreKey')x.ecSignedPreKey=p;else if(p.type==='kemLastResortPreKey')x.kemLastResortPreKey=p;else if(p.type==='ecPreKey'){if(!x.ecPreKey.some(k=>k.keyId===p.keyId))x.ecPreKey.push(p)}else if(p.type==='kemOneTimePreKey'){if(!x.kemOneTimePreKey.some(k=>k.keyId===p.keyId))x.kemOneTimePreKey.push(p)}}}
  async fetchPreKeyBundle(u,d,_fetcherUserId,t='aci'){const x=this.inventory(u,d,t),identity=this.identities.get(this.key(u,d,t));if(!identity||!x.ecSignedPreKey||!x.kemLastResortPreKey)return null;const ec=x.ecPreKey.shift()??null,kem=x.kemOneTimePreKey.shift()??null;return {registrationId:1,deviceId:d,identity,ecSignedPreKey:x.ecSignedPreKey,...(ec?{ecOneTimePreKey:ec}:{}),...(kem?{kemOneTimePreKey:kem}:{kemLastResortPreKey:x.kemLastResortPreKey})}}
  async getEcSignedPreKeyMetadata(u,d,t='aci'){const x=this.inventory(u,d,t);return x.ecSignedPreKey?this.meta(x.ecSignedPreKey):null}
  async getKemLastResortPreKeyMetadata(u,d,t='aci'){const x=this.inventory(u,d,t);return x.kemLastResortPreKey?this.meta(x.kemLastResortPreKey):null}
  async clearStaleKemPreKeys(u,d,t='aci'){const x=this.inventory(u,d,t),n=x.kemOneTimePreKey.length;x.kemOneTimePreKey=[];return {cleared:n}}
  async send(e){const copy=structuredClone(e);if(this.tamperNext){this.tamperNext=false;assert.equal(copy.messageType,'ciphertext','tamper case must target an established-session SignalMessage');assert.equal(typeof copy.ciphertext,'string','SDK relay ciphertext must use its documented base64 wire field');const wireBytes=Buffer.from(copy.ciphertext,'base64');assert.ok(wireBytes.length>9,'SignalMessage must contain version, protobuf body, and 8-byte MAC');wireBytes[wireBytes.length-1]^=1;copy.ciphertext=wireBytes.toString('base64')}this.envelopes.push(copy);const id='test-envelope-'+(++this.nextId),stamp=Date.now(),delivered={...copy,id,serverTimestamp:stamp};this.deliveredEnvelopes.push(delivered);const cb=this.listeners.get(this.key(e.targetUserId,e.targetDeviceId));if(cb)queueMicrotask(async()=>{try{await cb(delivered);}catch(err){this.deliveryError=err;}});return {messageId:id,serverTimestamp:stamp,deviceSetChecked:true}}
  async redeliver(index){const envelope=this.deliveredEnvelopes[index];if(!envelope)throw Error('unknown test envelope');const cb=this.listeners.get(this.key(envelope.targetUserId,envelope.targetDeviceId));if(!cb)throw Error('recipient is not subscribed');await cb(structuredClone(envelope))}
  subscribe(u,d,cb){const k=this.key(u,d);this.listeners.set(k,async env=>{return await cb(env)});return ()=>this.listeners.delete(k)}
  subscribeRelayConnectionState(){return ()=>{}}
  async markDelivered(id){this.acknowledged.add(id)}
}

test('real SDK first-contact PQXDH and Double Ratchet exchange Alice -> Bob -> Alice', async t=>{
  const relay=new IsolatedMemoryRelay();let resolveBob,resolveAlice;let bobDecryptions=0;
  const bobReceived=new Promise(r=>resolveBob=r),aliceReceived=new Promise(r=>resolveAlice=r);let resolveTamperError;const tamperError=new Promise(r=>resolveTamperError=r);
  const alice=await createSignalProtocolClient({identity:{userId:'alice',deviceId:1,enablePniKeys:false},adapters:{storage:inMemoryStore(),relay},hooks:{onMessageDecrypted:async e=>{if(e.content==='Netcha E2EE Bob vers Alice')resolveAlice(e.content)},onDeliveryError:()=>{},onRetryTerminal:()=>{}}});
  const bob=await createSignalProtocolClient({identity:{userId:'bob',deviceId:1,enablePniKeys:false},adapters:{storage:inMemoryStore(),relay},hooks:{onMessageDecrypted:async e=>{if(e.content==='Netcha E2EE Alice vers Bob'){bobDecryptions++;resolveBob(e.content)}},onDeliveryError:()=>{},onDecryptionError:(sessionId,error)=>resolveTamperError({sessionId,errorCode:error.code,errorMessage:error.message}),onRetryTerminal:()=>{}}});
  t.after(async()=>{await alice.stop();await bob.stop()});
  await alice.startRelaySubscription();await bob.startRelaySubscription();
  assert.ok(await alice.send('bob','Netcha E2EE Alice vers Bob'));
  assert.equal(await Promise.race([bobReceived,new Promise((_,rej)=>setTimeout(()=>rej(Error('Bob did not decrypt first-contact message; envelopes='+relay.envelopes.length+'; deliveryError='+String(relay.deliveryError))),20000))]),'Netcha E2EE Alice vers Bob');
  assert.equal(relay.envelopes[0].messageType,'prekey_bundle');
  await relay.redeliver(0);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(bobDecryptions,1,'redelivery of the same relay envelope ID must not decrypt or surface the message twice');
  assert.ok(await bob.send('alice','Netcha E2EE Bob vers Alice'));
  assert.equal(await Promise.race([aliceReceived,new Promise((_,rej)=>setTimeout(()=>rej(Error('Alice did not decrypt reply')),20000))]),'Netcha E2EE Bob vers Alice');
  assert.ok(relay.envelopes.length>=2);
  assert.equal(relay.envelopes[1].messageType,'ciphertext');
  for(const e of relay.envelopes){const serialized=JSON.stringify(e);assert.ok(!serialized.includes('Netcha E2EE Alice vers Bob'));assert.ok(!serialized.includes('Netcha E2EE Bob vers Alice'))}
  assert.ok(relay.acknowledged.has(relay.deliveredEnvelopes[0].id),'Bob must acknowledge the delivered first-contact envelope');

  // Exercise concurrent one-time prekey reservation on the disposable relay.
  const [bundleOne,bundleTwo]=await Promise.all([
    relay.fetchPreKeyBundle('bob',1,'alice'),
    relay.fetchPreKeyBundle('bob',1,'alice'),
  ]);
  assert.ok(bundleOne && bundleTwo,'Bob must have published authentic prekey bundles');
  assert.notEqual(bundleOne.ecOneTimePreKey?.keyId,bundleTwo.ecOneTimePreKey?.keyId,'concurrent fetches must not receive the same EC one-time prekey');
  assert.notEqual(bundleOne.kemOneTimePreKey?.keyId,bundleTwo.kemOneTimePreKey?.keyId,'concurrent fetches must not receive the same KEM one-time prekey');

  // Corrupt a fresh established-session ciphertext in transit. The recipient must reject it and never surface the plaintext.
  relay.tamperNext=true;
  assert.ok(await alice.send('bob','Netcha E2EE message volontairement altéré'));
  const tamperEvent=await Promise.race([tamperError,new Promise((_,rej)=>setTimeout(()=>rej(Error('tampered ciphertext did not reach the SDK decryption-error hook')),20000))]);
  assert.equal(tamperEvent.errorCode,'INVALID_CIPHERTEXT');
  assert.equal(bobDecryptions,1,'tampered ciphertext must not produce another decrypted message');
  assert.ok(!JSON.stringify(relay.envelopes.at(-1)).includes('Netcha E2EE message volontairement altéré'),'tampered plaintext must never appear in the relay envelope');

});
