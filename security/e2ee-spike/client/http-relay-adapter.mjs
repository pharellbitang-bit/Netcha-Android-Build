const encodeBytes = value => value instanceof Uint8Array ? btoa(Array.from(value,b=>String.fromCharCode(b)).join('')) : value;
const decodeBytes = value => typeof value==='string' ? Uint8Array.from(atob(value),c=>c.charCodeAt(0)) : value;

export class NetchaDurableSignalRelay {
  constructor({ baseUrl, getAccessToken, userId, deviceId }) {
    if(!/^https:\/\//.test(baseUrl)) throw new Error('RELAY_HTTPS_REQUIRED');
    this.baseUrl=baseUrl.replace(/\/$/,'');
    this.getAccessToken=getAccessToken;
    this.userId=userId;
    this.deviceId=deviceId;
    this.state={state:'stopped',since:Date.now()};
    this.listeners=new Set();
  }
  get relayConnectionState(){return this.state}
  transition(state,reason){
    this.state={state,...(reason?{reason}:{}),since:Date.now()};
    for(const listener of this.listeners) listener(this.state);
  }
  subscribeRelayConnectionState(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener)}
  async request(path,{method='GET',body}={}) {
    const token=await this.getAccessToken();
    if(!token) throw new Error('RELAY_AUTH_REQUIRED');
    const response=await fetch(this.baseUrl+path,{method,headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'
    },...(body===undefined?{}:{body:JSON.stringify(body)})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(payload.error??'RELAY_HTTP_'+response.status),{status:response.status,code:payload.code});
    return payload;
  }
  async send(envelope){
    if(envelope.senderUserId!==this.userId||envelope.senderDeviceId!==this.deviceId) throw new Error('SENDER_MISMATCH');
    return this.request('/v1/e2ee/envelopes',{method:'POST',body:{...envelope,ciphertext:encodeBytes(envelope.ciphertext)}});
  }
  async subscribe(userId,deviceId,onEnvelope,options={}) {
    if(userId!==this.userId||deviceId!==this.deviceId) throw new Error('SUBSCRIPTION_DEVICE_MISMATCH');
    let stopped=false,delay=300;
    this.transition('connecting');
    const poll=async()=>{
      if(stopped)return;
      try{
        const {envelopes=[]}=await this.request('/v1/e2ee/mailbox/pull?limit=100');
        this.transition('connected');
        if(envelopes.length) options.onBatchStart?.();
        for(const envelope of envelopes){
          if(stopped)break;
          try{
            envelope.ciphertext=decodeBytes(envelope.ciphertext);
            await onEnvelope(envelope);
            await this.markDelivered(envelope.id);
          }catch(error){
            // No acknowledgement: the durable mailbox retries this envelope.
          }
        }
        if(envelopes.length) options.onBatchEnd?.();
        delay=300;
      }catch(error){
        this.transition('reconnecting',error.code==='DEVICE_REVOKED'?'device-revoked':'closed');
        delay=Math.min(5000,Math.round(delay*1.7));
      }
      if(!stopped) setTimeout(poll,delay);
    };
    void poll();
    return ()=>{stopped=true;this.transition('stopped')};
  }
  async markDelivered(envelopeId){await this.request('/v1/e2ee/mailbox/'+encodeURIComponent(envelopeId)+'/ack',{method:'POST',body:{}})}
  async getDevices(userId){return (await this.request('/v1/e2ee/devices/'+encodeURIComponent(userId))).devices}
  async registerDevice(userId,device){if(userId!==this.userId)throw new Error('ACCOUNT_MISMATCH');return (await this.request('/v1/e2ee/devices/register',{method:'POST',body:{device}})).deviceId}
  async removeDevice(userId,deviceId){if(userId!==this.userId)throw new Error('ACCOUNT_MISMATCH');await this.request('/v1/e2ee/devices/'+deviceId+'/remove',{method:'POST',body:{}})}
  async provisionIdentityKey(request){if(request.userId!==this.userId||request.deviceId!==this.deviceId)throw new Error('ACCOUNT_MISMATCH');await this.request('/v1/e2ee/identity/provision',{method:'POST',body:request})}
  async rotateIdentityKey(request){if(request.userId!==this.userId||request.deviceId!==this.deviceId)throw new Error('ACCOUNT_MISMATCH');await this.request('/v1/e2ee/identity/rotate',{method:'POST',body:{...request,expectedCurrentCommitment:encodeBytes(request.expectedCurrentCommitment)}})}
  async getIdentityKey(userId,identityType='aci'){return (await this.request('/v1/e2ee/identity/'+encodeURIComponent(userId)+'?identityType='+identityType)).identity}
  async uploadPreKeys(userId,deviceId,keys,identityType='aci'){if(userId!==this.userId||deviceId!==this.deviceId)throw new Error('DEVICE_MISMATCH');await this.request('/v1/e2ee/prekeys/upload',{method:'POST',body:{keys,identityType}})}
  async fetchPreKeyBundle(userId,deviceId,_fetcherUserId,identityType='aci'){const {bundle}=await this.request('/v1/e2ee/prekeys/'+encodeURIComponent(userId)+'/'+deviceId+'?identityType='+identityType);return bundle}
  async getPreKeyCount(userId,deviceId,type,identityType='aci'){return (await this.request('/v1/e2ee/prekeys/count?deviceId='+deviceId+'&type='+type+'&identityType='+identityType)).count}
  async getPreKeyInventory(userId,deviceId,identityType='aci'){if(userId!==this.userId||deviceId!==this.deviceId)throw new Error('DEVICE_MISMATCH');return (await this.request('/v1/e2ee/prekeys/inventory?identityType='+identityType)).inventory}
  async clearStaleKemPreKeys(userId,deviceId,identityType='aci'){if(userId!==this.userId||deviceId!==this.deviceId)throw new Error('DEVICE_MISMATCH');return this.request('/v1/e2ee/prekeys/clear-stale-kem',{method:'POST',body:{identityType}})}
  async publishPlannedPreKeys(userId,deviceId,plan,identityType='aci'){const inventory=await this.getPreKeyInventory(userId,deviceId,identityType);const keys=await plan(inventory);if(keys.length)await this.uploadPreKeys(userId,deviceId,keys,identityType)}
  async getEcSignedPreKeyMetadata(userId,deviceId,identityType='aci'){
    return (await this.request('/v1/e2ee/prekeys/metadata?userId='+encodeURIComponent(userId)+'&deviceId='+deviceId+'&type=ecSignedPreKey&identityType='+identityType)).metadata;
  }
  async getKemLastResortPreKeyMetadata(userId,deviceId,identityType='aci'){
    return (await this.request('/v1/e2ee/prekeys/metadata?userId='+encodeURIComponent(userId)+'&deviceId='+deviceId+'&type=kemLastResortPreKey&identityType='+identityType)).metadata;
  }
  async commitMembershipChange({groupId,actorAccountId,removedAccountId,expectedVersion,encryptedGroupState,encryptedChange}){
    if(actorAccountId!==this.userId) throw new Error('ACCOUNT_MISMATCH');
    return this.request('/v1/e2ee/groups/'+encodeURIComponent(groupId)+'/changes',{method:'POST',
      body:{expectedVersion,encryptedGroupState,encryptedChange,membershipOps:[{action:'remove',accountId:removedAccountId}]}});
  }
  async getActiveDevices(userId){return (await this.request('/v1/e2ee/devices/'+encodeURIComponent(userId)+'/active')).devices}
}
