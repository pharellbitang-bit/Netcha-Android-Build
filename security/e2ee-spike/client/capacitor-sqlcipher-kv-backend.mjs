import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { CapacitorNativeSignalSecretVault } from './capacitor-native-vault.mjs';

const TABLE = 'netcha_e2ee_kv';
const DB = 'netcha_e2ee_signal_v1';
const NS = 'netcha.signal.v1';
const toBase64 = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = value => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

function applyOperations(original, operations) {
  // All CAS checks observe the pre-batch state.
  for (const op of operations) {
    if (op.type === 'check' && (original.get(op.key) ?? null) !== op.expectedValue)
      throw new Error('ATOMIC_CHECK_FAILED:' + op.key);
  }
  const next = new Map(original);
  for (const op of operations) {
    if (op.type === 'set') next.set(op.key, op.value);
    else if (op.type === 'remove') next.delete(op.key);
    else if (op.type === 'removeSessionsForUser') {
      for (const [key,value] of next) {
        if (!key.startsWith(op.keyPrefix)) continue;
        try { if (JSON.parse(value)?.userId === op.userId) next.delete(key); } catch {}
      }
    } else if (op.type === 'pruneSkippedSenderKeys') {
      const keys = [...next.keys()].filter(k=>k.startsWith(op.keyPrefix)).sort((a,b)=>
        Number(a.slice(a.lastIndexOf(':')+1))-Number(b.slice(b.lastIndexOf(':')+1)));
      for (const key of keys.slice(0,Math.max(0,keys.length-op.maxCount))) next.delete(key);
    } else if (op.type === 'removeSenderKeyHandoffs') {
      for (const key of [...next.keys()]) {
        if (!key.startsWith(op.keyPrefix)) continue;
        const parts=key.slice(op.keyPrefix.length).split(':');
        if(parts.length!==5) continue;
        if(op.groupHash!==undefined&&parts[0]!==op.groupHash) continue;
        if(op.accountHash!==undefined&&parts[2]!==op.accountHash) continue;
        if(op.recipientHash!==undefined&&parts[3]!==op.recipientHash) continue;
        next.delete(key);
      }
    }
  }
  return next;
}

/**
 * Native SQLCipher-backed KeyValueStorage. The SDK's KeyValueSignalProtocolStore
 * adds per-record authenticated encryption using the native vault key.
 * This backend also encrypts the SQLite file itself with SQLCipher.
 */
export class CapacitorSqlCipherKeyValueBackend {
  constructor(db, namespace=NS) {
    this.db=db;
    this.namespace=namespace;
    this.queue=Promise.resolve();
  }

  static async open({ database=DB, namespace=NS }={}) {
    const vault=new CapacitorNativeSignalSecretVault();
    const sqlite=new SQLiteConnection(CapacitorSQLite);
    await sqlite.checkConnectionsConsistency();
    const exists=(await sqlite.isDatabase({database})).result;
    let dbPassphrase=await vault.getSecret('sqlcipher-'+database);
    if(!dbPassphrase && exists) throw new Error('LOCAL_STORE_KEY_LOST');
    if(!dbPassphrase) {
      dbPassphrase=crypto.getRandomValues(new Uint8Array(32));
      await vault.setSecret('sqlcipher-'+database,dbPassphrase);
    }
    // Capacitor SQLite keeps its SQLCipher passphrase in the platform secure store.
    await CapacitorSQLite.setEncryptionSecret({passphrase:toBase64(dbPassphrase)});
    const connected=await sqlite.isConnection(database,false);
    if(!connected.result) await sqlite.createConnection(database,true,'secret',1,false);
    const db=await sqlite.retrieveConnection(database,false);
    const opened=await db.isDBOpen();
    if(!opened.result) await db.open();
    await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(namespace,key)
    );`);
    const encrypted=(await CapacitorSQLite.isDatabaseEncrypted({database})).result;
    if(!encrypted) throw new Error('SQLCIPHER_NOT_ACTIVE');
    return new CapacitorSqlCipherKeyValueBackend(db,namespace);
  }

  async serial(work) {
    const next=this.queue.then(work,work);
    this.queue=next.then(()=>undefined,()=>undefined);
    return next;
  }

  async getItem(key) {
    return this.serial(async()=>{
      const result=await this.db.query(`SELECT value FROM ${TABLE} WHERE namespace=? AND key=?`,[this.namespace,key]);
      return result.values?.[0]?.value ?? null;
    });
  }

  async setItem(key,value) {
    return this.atomicWrite([{type:'set',key,value}]);
  }

  async removeItem(key) {
    return this.atomicWrite([{type:'remove',key}]);
  }

  async getAllKeys() {
    return this.serial(async()=>{
      const result=await this.db.query(`SELECT key FROM ${TABLE} WHERE namespace=? ORDER BY key`,[this.namespace]);
      return (result.values ?? []).map(row=>row.key);
    });
  }

  async removeMany(keys) {
    return this.atomicWrite(keys.map(key=>({type:'remove',key})));
  }

  async atomicWrite(operations) {
    return this.serial(async()=>{
      await this.db.beginTransaction();
      try {
        const result=await this.db.query(`SELECT key,value FROM ${TABLE} WHERE namespace=?`,[this.namespace]);
        const original=new Map((result.values ?? []).map(row=>[row.key,row.value]));
        const next=applyOperations(original,operations);
        for(const key of original.keys()) {
          if(!next.has(key)) await this.db.run(`DELETE FROM ${TABLE} WHERE namespace=? AND key=?`,[this.namespace,key],false);
        }
        for(const [key,value] of next) {
          if(original.get(key)!==value) {
            await this.db.run(`INSERT INTO ${TABLE}(namespace,key,value) VALUES(?,?,?)
              ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value`,
              [this.namespace,key,value],false);
          }
        }
        await this.db.commitTransaction();
      } catch(error) {
        await this.db.rollbackTransaction();
        throw error;
      }
    });
  }

  async close() { await this.serial(()=>this.db.close()); }
}
