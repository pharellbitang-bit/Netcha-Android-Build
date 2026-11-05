const PREFIX = 'netcha.e2ee.outbox.v1:';
const toBase64 = bytes => {
  if (typeof bytes === 'string') return bytes;
  if (!(bytes instanceof Uint8Array)) throw new Error('OUTBOX_CIPHERTEXT_REQUIRED');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = value => {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const retryable = error => {
  const status = Number(error?.status);
  return !Number.isInteger(status) || status === 408 || status === 425 || status === 429 || status >= 500;
};
const errorCode = error => {
  if (typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/i.test(error.code)) return error.code;
  const status = Number(error?.status);
  return Number.isInteger(status) ? 'HTTP_' + status : 'NETWORK_UNAVAILABLE';
};

function serializeEnvelope(source) {
  if (!source || typeof source !== 'object') throw new Error('OUTBOX_ENVELOPE_REQUIRED');
  const clientMessageId = String(source.clientMessageId || globalThis.crypto.randomUUID());
  const envelope = {
    clientMessageId,
    senderUserId: String(source.senderUserId || ''),
    senderDeviceId: Number(source.senderDeviceId),
    targetUserId: String(source.targetUserId || ''),
    targetDeviceId: Number(source.targetDeviceId),
    messageType: String(source.messageType || ''),
    ...(source.contentKind ? { contentKind: String(source.contentKind) } : {}),
    ...(source.deliveryClass ? { deliveryClass: String(source.deliveryClass) } : {}),
    timestamp: Number(source.timestamp || Date.now()),
    ciphertext: toBase64(source.ciphertext),
    ...(source.recipientRegistrationId !== undefined
      ? { recipientRegistrationId: Number(source.recipientRegistrationId) } : {}),
    ...(Array.isArray(source.declaredDeviceIds)
      ? { declaredDeviceIds: source.declaredDeviceIds.map(Number) } : {}),
  };
  if (!envelope.senderUserId || !Number.isInteger(envelope.senderDeviceId) ||
      !envelope.targetUserId || !Number.isInteger(envelope.targetDeviceId) ||
      !envelope.messageType || !envelope.ciphertext) throw new Error('OUTBOX_ENVELOPE_INVALID');
  return { clientMessageId, envelope };
}

function deserializeEnvelope(envelope) {
  return { ...envelope, ciphertext: fromBase64(envelope.ciphertext) };
}

/**
 * Durable ciphertext-only outbox.
 * The storage must be a persistent encrypted key/value backend (Netcha uses
 * its native SQLCipher database). Plaintext is never accepted or persisted.
 */
export class PersistentEncryptedOutbox {
  constructor(storage) {
    for (const method of ['getAllKeys', 'getItem', 'setItem', 'removeItem']) {
      if (typeof storage?.[method] !== 'function') throw new Error('OUTBOX_STORAGE_CONTRACT_REQUIRED');
    }
    this.storage = storage;
    this.flushPromise = null;
  }

  async enqueue(source) {
    const { clientMessageId, envelope } = serializeEnvelope(source);
    const key = PREFIX + encodeURIComponent(clientMessageId);
    const existing = await this.storage.getItem(key);
    if (existing) return key;
    await this.storage.setItem(key, JSON.stringify({
      version: 1, clientMessageId, queuedAt: Date.now(), attempts: 0,
      state: 'pending', envelope
    }));
    return key;
  }

  async recordFailure(key, error) {
    const raw = await this.storage.getItem(key);
    if (!raw) return;
    const record = JSON.parse(raw);
    record.attempts = Number(record.attempts || 0) + 1;
    record.lastErrorCode = errorCode(error);
    record.state = retryable(error) ? 'pending' : 'blocked';
    await this.storage.setItem(key, JSON.stringify(record));
  }

  async send(source, sendNow) {
    const key = await this.enqueue(source);
    const raw = await this.storage.getItem(key);
    const record = JSON.parse(raw);
    try {
      const result = await sendNow(deserializeEnvelope(record.envelope));
      await this.storage.removeItem(key);
      return result;
    } catch (error) {
      await this.recordFailure(key, error);
      if (retryable(error)) {
        error.queuedForRetry = true;
        error.clientMessageId = record.clientMessageId;
      }
      throw error;
    }
  }

  async flush(sendNow) {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      let sent = 0, blocked = 0;
      const keys = (await this.storage.getAllKeys())
        .filter(key => key.startsWith(PREFIX)).sort();
      for (const key of keys) {
        const raw = await this.storage.getItem(key);
        if (!raw) continue;
        const record = JSON.parse(raw);
        if (record.version !== 1 || record.state !== 'pending') {
          if (record.state === 'blocked') blocked++;
          continue;
        }
        try {
          await sendNow(deserializeEnvelope(record.envelope));
          await this.storage.removeItem(key);
          sent++;
        } catch (error) {
          await this.recordFailure(key, error);
          const updated = JSON.parse(await this.storage.getItem(key));
          if (updated.state === 'blocked') blocked++;
          if (retryable(error)) break;
        }
      }
      return { sent, blocked, remaining: (await this.storage.getAllKeys()).filter(key => key.startsWith(PREFIX)).length };
    })();
    try { return await this.flushPromise; }
    finally { this.flushPromise = null; }
  }

  async pendingCount() {
    return (await this.storage.getAllKeys()).filter(key => key.startsWith(PREFIX)).length;
  }
}

/** Wrap an SDK relay without changing its cryptographic envelope contract. */
export function attachPersistentEncryptedOutbox(relay, storage) {
  if (typeof relay?.send !== 'function') throw new Error('OUTBOX_RELAY_SEND_REQUIRED');
  const outbox = new PersistentEncryptedOutbox(storage);
  const sendNow = relay.send.bind(relay);
  relay.send = envelope => outbox.send(envelope, sendNow);
  if (typeof relay.request === 'function') {
    const request = relay.request.bind(relay);
    relay.request = async (path, options) => {
      const result = await request(path, options);
      if (String(path).startsWith('/v1/e2ee/mailbox/pull')) {
        void outbox.flush(sendNow).catch(() => {});
      }
      return result;
    };
  }
  return {
    relay,
    flush: () => outbox.flush(sendNow),
    pendingCount: () => outbox.pendingCount(),
  };
}
