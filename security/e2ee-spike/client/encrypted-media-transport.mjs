import { prepareEncryptedAttachment, openEncryptedAttachment } from './encrypted-attachments.mjs';

export class NetchaEncryptedObjectClient {
  constructor({baseUrl,getAccessToken}) {
    if(!/^https:\/\//.test(baseUrl)) throw new Error('OBJECT_BROKER_HTTPS_REQUIRED');
    this.baseUrl=baseUrl.replace(/\/$/,'');this.getAccessToken=getAccessToken;
  }
  async api(path,method='GET',body) {
    const token=await this.getAccessToken();
    const response=await fetch(this.baseUrl+path,{method,headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'
    },...(body===undefined?{}:{body:JSON.stringify(body)})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error??'OBJECT_BROKER_HTTP_'+response.status);
    return payload;
  }
  async uploadCiphertext({scope,ciphertext,sha256}) {
    const reservation=await this.api('/v1/e2ee/attachments/upload','POST',{
      scope,ciphertextSize:ciphertext.byteLength,sha256
    });
    const upload=await fetch(reservation.uploadUrl,{method:'PUT',headers:reservation.headers,body:ciphertext});
    if(!upload.ok)throw new Error('ENCRYPTED_OBJECT_UPLOAD_FAILED');
    await this.api('/v1/e2ee/attachments/'+reservation.requestId+'/complete','POST',{});
    return reservation.requestId;
  }
  async downloadCiphertext(requestId) {
    const info=await this.api('/v1/e2ee/attachments/'+requestId+'/download');
    const response=await fetch(info.downloadUrl);
    if(!response.ok)throw new Error('ENCRYPTED_OBJECT_DOWNLOAD_FAILED');
    return new Uint8Array(await response.arrayBuffer());
  }
  async delete(requestId) { await this.api('/v1/e2ee/attachments/'+requestId,'DELETE',{}); }
}

/**
 * Shared media path for private photos/videos/files/voice notes and group
 * attachments. The supplied callback must encrypt the pointer with the
 * conversation's pairwise or group protocol before sending it.
 */
export async function sendNetchaEncryptedMedia({bytes,kind,scope,objectClient,sendEncryptedPointer,segmentSize}) {
  const {pointer,ciphertext}=await prepareEncryptedAttachment({bytes,scope,segmentSize});
  const requestId=await objectClient.uploadCiphertext({
    scope,ciphertext,sha256:pointer.ciphertextSha256
  });
  const payload={type:'netcha-encrypted-attachment',kind,requestId,pointer};
  await sendEncryptedPointer(JSON.stringify(payload));
  return {requestId,kind};
}

/** Call only after the containing Signal message has been successfully decrypted. */
export async function receiveNetchaEncryptedMedia({payload,objectClient,expectedScope}) {
  const parsed=typeof payload==='string'?JSON.parse(payload):payload;
  if(parsed?.type!=='netcha-encrypted-attachment')throw new Error('NOT_A_NETCHA_ATTACHMENT');
  const ciphertext=await objectClient.downloadCiphertext(parsed.requestId);
  const bytes=await openEncryptedAttachment({pointer:parsed.pointer,ciphertext,expectedScope});
  return {kind:parsed.kind,bytes};
}
