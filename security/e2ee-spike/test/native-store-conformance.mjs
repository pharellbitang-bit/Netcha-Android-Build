import { assertBackendConformance } from '@open-e2ee/signal-protocol-sdk/local/store/key-value';
import { CapacitorSqlCipherKeyValueBackend } from '../client/capacitor-sqlcipher-kv-backend.mjs';

/**
 * Invoke only from the Android/iOS native test harness. Each case gets an
 * isolated SQLCipher namespace; the reopen hook closes and reopens the same
 * namespace to verify process-restart durability.
 */
export async function runNativeSignalStoreConformance() {
  const prefix='netcha.conformance.'+crypto.randomUUID();
  const result=await assertBackendConformance({
    createBackend:()=>CapacitorSqlCipherKeyValueBackend.open({namespace:prefix+'.'+crypto.randomUUID()}),
    reopen:async previous=>{
      const namespace=previous.namespace;
      await previous.close();
      return CapacitorSqlCipherKeyValueBackend.open({namespace});
    }
  });
  return {total:result.total,passed:result.passed.length,skipped:result.skipped,failures:result.failures};
}
