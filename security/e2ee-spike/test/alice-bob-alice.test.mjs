import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';

class IsolatedMemoryRelay {
  devices = new Map([['alice',[{deviceId:1,registered:true,linked:false,enabled:true}]],['bob',[{deviceId:1,registered:true,linked:false,enabled:true}]]]);
  identities = new Map(); inventories = new Map(); listeners = new Map(); envelopes = []; nextId=0;
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
  async send(e){const copy=structuredClone(e);console.log('RELAY_SEND',e.targetUserId,e.targetDeviceId,e.messageType,'listeners',Array.from(this.listeners.keys()));this.envelopes.push(copy);const id='test-envelope-'+(++this.nextId),stamp=Date.now(),delivered={...copy,id,serverTimestamp:stamp},cb=this.listeners.get(this.key(e.targetUserId,e.targetDeviceId));if(cb)queueMicrotask(async()=>{console.log('RELAY_DISPATCH',id);try{await cb(delivered);console.log('RELAY_DISPATCH_DONE',id)}catch(err){this.deliveryError=err;console.log('RELAY_DISPATCH_ERROR',String(err))}});return {messageId:id,serverTimestamp:stamp,deviceSetChecked:true}}
  subscribe(u,d,cb){const k=this.key(u,d);console.log('RELAY_SUBSCRIBE',k);this.listeners.set(k,async env=>{console.log('RELAY_CALLBACK',k,env.id,env.messageType);return await cb(env)});return ()=>this.listeners.delete(k)}
  subscribeRelayConnectionState(){return ()=>{}}
  async markDelivered(){}
}

test('real SDK first-contact PQXDH and Double Ratchet exchange Alice -> Bob -> Alice', async t=>{
  const relay=new IsolatedMemoryRelay();let resolveBob,resolveAlice;
  const bobReceived=new Promise(r=>resolveBob=r),aliceReceived=new Promise(r=>resolveAlice=r);
  const alice=await createSignalProtocolClient({identity:{userId:'alice',deviceId:1,enablePniKeys:false},adapters:{storage:inMemoryStore(),relay},hooks:{onMessageDecrypted:async e=>{console.log('BOB_DECRYPTED',e);if(e.content==='Netcha E2EE Alice vers Bob')resolveBob(e.content)},onDeliveryError:e=>console.log('BOB_DELIVERY_ERROR',e),onRetryTerminal:e=>console.log('BOB_RETRY_TERMINAL',e)}});
  const bob=await createSignalProtocolClient({identity:{userId:'bob',deviceId:1,enablePniKeys:false},adapters:{storage:inMemoryStore(),relay},hooks:{onMessageDecrypted:async e=>{console.log('ALICE_DECRYPTED',e);if(e.content==='Netcha E2EE Bob vers Alice')resolveAlice(e.content)},onDeliveryError:e=>console.log('ALICE_DELIVERY_ERROR',e),onRetryTerminal:e=>console.log('ALICE_RETRY_TERMINAL',e)}});
  t.after(async()=>{await alice.stop();await bob.stop()});
  await alice.startRelaySubscription();await bob.startRelaySubscription();
  assert.ok(await alice.send('bob','Netcha E2EE Alice vers Bob'));
  assert.equal(await Promise.race([bobReceived,new Promise((_,rej)=>setTimeout(()=>rej(Error('Bob did not decrypt first-contact message; envelopes='+relay.envelopes.length+'; deliveryError='+String(relay.deliveryError))),20000))]),'Netcha E2EE Alice vers Bob');
  assert.ok(await bob.send('alice','Netcha E2EE Bob vers Alice'));
  assert.equal(await Promise.race([aliceReceived,new Promise((_,rej)=>setTimeout(()=>rej(Error('Alice did not decrypt reply')),20000))]),'Netcha E2EE Bob vers Alice');
  assert.ok(relay.envelopes.length>=2);
  for(const e of relay.envelopes){const c=typeof e.ciphertext==='string'?e.ciphertext:Buffer.from(e.ciphertext).toString('base64');assert.ok(!c.includes('Netcha E2EE Alice vers Bob'));assert.ok(!c.includes('Netcha E2EE Bob vers Alice'))}
});
