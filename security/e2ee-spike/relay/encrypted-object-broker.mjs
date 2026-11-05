import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3/R2-compatible broker. It only receives ciphertext and SHA-256 metadata.
 * Provider credentials stay on the server; clients receive short-lived URLs.
 */
export class EncryptedObjectBroker {
  constructor({ repository, bucket, endpoint, region='auto', accessKeyId, secretAccessKey, forcePathStyle=true }) {
    if(!repository||!bucket||!endpoint||!accessKeyId||!secretAccessKey) throw new Error('OBJECT_BROKER_CONFIG_REQUIRED');
    this.repository=repository;
    this.bucket=bucket;
    this.s3=new S3Client({region,endpoint,forcePathStyle,credentials:{accessKeyId,secretAccessKey}});
  }

  async assertScopeAccess(accountId,scope) {
    const parts=String(scope).split(':');
    if(parts[0]==='private'&&parts.length===3&&parts[1]!==parts[2])
      return parts.slice(1).includes(accountId);
    if(parts[0]==='group'&&parts.length===2) {
      const {rows}=await this.repository.pool.query(
        `SELECT 1 FROM e2ee_group_members WHERE group_id=$1 AND account_id=$2 AND active=true`,
        [parts[1],accountId]);
      return rows.length>0;
    }
    return false;
  }

  async createUpload(accountId,{scope,ciphertextSize,sha256}) {
    if(!await this.assertScopeAccess(accountId,scope)) throw new Error('ATTACHMENT_SCOPE_FORBIDDEN');
    if(!Number.isSafeInteger(ciphertextSize)||ciphertextSize<1||ciphertextSize>100*1024*1024)
      throw new Error('ATTACHMENT_SIZE_INVALID');
    if(!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('ATTACHMENT_DIGEST_INVALID');
    const requestId=randomUUID(),objectKey='netcha-e2ee/'+requestId;
    const expiresAt=new Date(Date.now()+15*60*1000);
    await this.repository.pool.query(
      `INSERT INTO e2ee_attachments(request_id,object_key,owner_account_id,conversation_scope,
        ciphertext_size,content_sha256,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [requestId,objectKey,accountId,scope,ciphertextSize,sha256,expiresAt]);
    const uploadUrl=await getSignedUrl(this.s3,new PutObjectCommand({
      Bucket:this.bucket,Key:objectKey,ContentType:'application/octet-stream',
      Metadata:{sha256:sha256.toLowerCase()}
    }),{expiresIn:300});
    return {requestId,uploadUrl,expiresIn:300,headers:{'content-type':'application/octet-stream'}};
  }

  async completeUpload(accountId,requestId) {
    const {rows}=await this.repository.pool.query(
      `SELECT * FROM e2ee_attachments WHERE request_id=$1 AND owner_account_id=$2
       AND expires_at>now()`,[requestId,accountId]);
    const row=rows[0]; if(!row) throw new Error('ATTACHMENT_NOT_FOUND');
    if(!await this.assertScopeAccess(accountId,row.conversation_scope)) throw new Error('ATTACHMENT_SCOPE_FORBIDDEN');
    const head=await this.s3.send(new HeadObjectCommand({Bucket:this.bucket,Key:row.object_key}));
    if(Number(head.ContentLength)!==Number(row.ciphertext_size) ||
       String(head.Metadata?.sha256??'').toLowerCase()!==String(row.content_sha256).toLowerCase())
      throw new Error('ATTACHMENT_UPLOAD_INTEGRITY_FAILURE');
    await this.repository.pool.query(
      'UPDATE e2ee_attachments SET completed_at=now() WHERE request_id=$1',[requestId]);
    return {requestId,completed:true};
  }

  async createDownload(accountId,requestId) {
    const {rows}=await this.repository.pool.query(
      `SELECT * FROM e2ee_attachments WHERE request_id=$1 AND completed_at IS NOT NULL
       AND expires_at>now()`,[requestId]);
    const row=rows[0]; if(!row) throw new Error('ATTACHMENT_NOT_FOUND');
    if(!await this.assertScopeAccess(accountId,row.conversation_scope)) throw new Error('ATTACHMENT_SCOPE_FORBIDDEN');
    const downloadUrl=await getSignedUrl(this.s3,new GetObjectCommand({Bucket:this.bucket,Key:row.object_key}),{expiresIn:120});
    return {downloadUrl,expiresIn:120,ciphertextSize:Number(row.ciphertext_size),sha256:row.content_sha256};
  }

  async deleteAttachment(accountId,requestId) {
    const {rows}=await this.repository.pool.query(
      'SELECT object_key FROM e2ee_attachments WHERE request_id=$1 AND owner_account_id=$2',
      [requestId,accountId]);
    if(!rows[0]) throw new Error('ATTACHMENT_NOT_FOUND');
    await this.s3.send(new DeleteObjectCommand({Bucket:this.bucket,Key:rows[0].object_key}));
    await this.repository.pool.query('DELETE FROM e2ee_attachments WHERE request_id=$1',[requestId]);
    return {deleted:true};
  }
}
