import { createServer } from 'node:http';

const json=(res,status,payload)=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
};
async function readBody(req,maxBytes=1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(new Error('BODY_TOO_LARGE'),{status:413});chunks.push(chunk)}
  if(!chunks.length)return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const decodeBytes=value=>typeof value==='string'?new Uint8Array(Buffer.from(value,'base64')):value;

/**
 * Lab HTTP API for DurableRelayRepository.
 * authenticate(req) MUST validate a real Netcha access token and return
 * { accountId, deviceId? }. This module never trusts account IDs in writes.
 * Use HTTPS at the reverse proxy; do not expose the PostgreSQL pool.
 */
export function createNetchaDurableRelayServer({ repository, authenticate, objectBroker = null, logger = () => {} }) {
  if(typeof authenticate!=='function') throw new Error('AUTHENTICATOR_REQUIRED');
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'https://relay.invalid');
      if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{status:'ok',relay:'netcha-e2ee-lab'});
      const principal=await authenticate(req);
      if(!principal?.accountId) return json(res,401,{error:'AUTH_REQUIRED'});
      const accountId=principal.accountId;
      const ownDevice=principal.deviceId;
      const body=['POST','PUT','PATCH'].includes(req.method)?await readBody(req):{};
      let match;

      if(req.method==='POST'&&url.pathname==='/v1/e2ee/devices/register'){
        const deviceId=await repository.registerDevice(accountId,body.device??{});
        return json(res,201,{deviceId});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/devices\/(\d+)\/remove$/))&&req.method==='POST'){
        await repository.removeDevice(accountId,Number(match[1]));return json(res,200,{ok:true});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/devices\/([^/]+)\/active$/))&&req.method==='GET'){
        return json(res,200,{devices:await repository.getActiveDevices(decodeURIComponent(match[1]))});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/devices\/([^/]+)$/))&&req.method==='GET'){
        return json(res,200,{devices:await repository.getDevices(decodeURIComponent(match[1]))});
      }
      if(req.method==='POST'&&url.pathname==='/v1/e2ee/identity/provision'){
        if(ownDevice!==undefined&&Number(body.deviceId)!==Number(ownDevice)) throw Object.assign(new Error('DEVICE_MISMATCH'),{status:403});
        await repository.provisionIdentityKey({...body,userId:accountId});return json(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/v1/e2ee/identity/rotate'){
        if(ownDevice!==undefined&&Number(body.deviceId)!==Number(ownDevice)) throw Object.assign(new Error('DEVICE_MISMATCH'),{status:403});
        await repository.rotateIdentityKey({...body,userId:accountId,expectedCurrentCommitment:decodeBytes(body.expectedCurrentCommitment)});
        return json(res,200,{ok:true});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/identity\/([^/]+)$/))&&req.method==='GET'){
        return json(res,200,{identity:await repository.getIdentityKey(decodeURIComponent(match[1]),url.searchParams.get('identityType')??'aci')});
      }
      if(req.method==='POST'&&url.pathname==='/v1/e2ee/prekeys/upload'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        await repository.uploadPrekeys(accountId,ownDevice,body.identityType??'aci',body.keys??[]);
        return json(res,200,{ok:true});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/prekeys\/([^/]+)\/(\d+)$/))&&req.method==='GET'){
        const bundle=await repository.fetchPrekeyBundle(decodeURIComponent(match[1]),Number(match[2]),url.searchParams.get('identityType')??'aci');
        return json(res,bundle?200:404,{bundle});
      }
      if(req.method==='GET'&&url.pathname==='/v1/e2ee/prekeys/inventory'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        return json(res,200,{inventory:await repository.getPreKeyInventory(accountId,ownDevice,url.searchParams.get('identityType')??'aci')});
      }
      if(req.method==='GET'&&url.pathname==='/v1/e2ee/prekeys/count'){
        const userId=url.searchParams.get('userId')??accountId;
        if(userId!==accountId) throw Object.assign(new Error('ACCOUNT_MISMATCH'),{status:403});
        return json(res,200,{count:await repository.getPreKeyCount(accountId,Number(url.searchParams.get('deviceId')??ownDevice),url.searchParams.get('type'),url.searchParams.get('identityType')??'aci')});
      }
      if(req.method==='GET'&&url.pathname==='/v1/e2ee/prekeys/metadata'){
        return json(res,200,{metadata:await repository.prekeyMetadata(url.searchParams.get('userId'),Number(url.searchParams.get('deviceId')),url.searchParams.get('identityType')??'aci',url.searchParams.get('type'))});
      }
      if(req.method==='POST'&&url.pathname==='/v1/e2ee/prekeys/clear-stale-kem'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        return json(res,200,await repository.clearStaleKemPreKeys(accountId,ownDevice,body.identityType??'aci'));
      }
      if(req.method==='POST'&&url.pathname==='/v1/e2ee/envelopes'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        if(body.senderUserId!==accountId||Number(body.senderDeviceId)!==Number(ownDevice))
          throw Object.assign(new Error('SENDER_MISMATCH'),{status:403});
        const stored=await repository.enqueueEnvelope(accountId,ownDevice,body);
        return json(res,202,{messageId:stored.id,serverTimestamp:new Date(stored.created_at).getTime(),
          ...(Array.isArray(body.declaredDeviceIds)?{deviceSetChecked:true}:{})});
      }
      if(req.method==='GET'&&url.pathname==='/v1/e2ee/mailbox/pull'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        return json(res,200,{envelopes:await repository.pendingEnvelopes(accountId,ownDevice,Number(url.searchParams.get('limit')??100))});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/mailbox\/([^/]+)\/ack$/))&&req.method==='POST'){
        if(!Number.isInteger(ownDevice)) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'),{status:403});
        await repository.acknowledge(accountId,ownDevice,match[1]);return json(res,200,{ok:true});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/groups\/([^/]+)\/create$/))&&req.method==='POST'){
        await repository.createGroup(decodeURIComponent(match[1]),accountId,body.encryptedGroupState,body.memberAccountIds??[]);
        return json(res,201,{ok:true,version:0,senderKeyEpoch:1});
      }
      if((match=url.pathname.match(/^\/v1\/e2ee\/groups\/([^/]+)\/changes$/))&&req.method==='POST'){
        const result=await repository.commitGroupChange(decodeURIComponent(match[1]),accountId,
          body.expectedVersion,body.encryptedGroupState,body.encryptedChange,body.membershipOps??[]);
        return json(res,200,result);
      }

      if(objectBroker&&req.method==='POST'&&url.pathname==='/v1/e2ee/attachments/upload'){
        return json(res,201,await objectBroker.createUpload(accountId,body));
      }
      if(objectBroker&&(match=url.pathname.match(/^\\/v1\\/e2ee\\/attachments\\/([^/]+)\\/complete$/))&&req.method==='POST'){
        return json(res,200,await objectBroker.completeUpload(accountId,match[1]));
      }
      if(objectBroker&&(match=url.pathname.match(/^\\/v1\\/e2ee\\/attachments\\/([^/]+)\\/download$/))&&req.method==='GET'){
        return json(res,200,await objectBroker.createDownload(accountId,match[1]));
      }
      if(objectBroker&&(match=url.pathname.match(/^\\/v1\\/e2ee\\/attachments\\/([^/]+)$/))&&req.method==='DELETE'){
        return json(res,200,await objectBroker.deleteAttachment(accountId,match[1]));
      }
      return json(res,404,{error:'ROUTE_NOT_FOUND'});
    }catch(error){
      const status=error.status??(error.message==='AUTH_REQUIRED'?401:400);
      logger({status,code:error.code??error.message});
      return json(res,status,{error:error.message??'RELAY_ERROR',code:error.code??error.message});
    }
  });
}
