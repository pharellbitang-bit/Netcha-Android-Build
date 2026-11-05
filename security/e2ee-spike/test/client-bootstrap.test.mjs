import test from "node:test";
import assert from "node:assert/strict";
import { createSignalProtocolClient } from "@open-e2ee/signal-protocol-sdk";
import { inMemoryStore } from "@open-e2ee/signal-protocol-sdk/local/store/memory";

test("two independent account/device clients initialize with isolated stores", async () => {
  const aliceStore = inMemoryStore();
  const bobStore = inMemoryStore();
  let alice;
  let bob;

  try {
    alice = await createSignalProtocolClient({
      identity: { userId: "netcha-spike-alice", deviceId: 1 },
      adapters: { storage: aliceStore },
    });
    bob = await createSignalProtocolClient({
      identity: { userId: "netcha-spike-bob", deviceId: 1 },
      adapters: { storage: bobStore },
    });

    assert.equal(alice.userId, "netcha-spike-alice");
    assert.equal(bob.userId, "netcha-spike-bob");
    assert.equal(alice.deviceId, 1);
    assert.equal(bob.deviceId, 1);
    assert.notEqual(aliceStore, bobStore);
    assert.notEqual(alice, bob);
  } finally {
    if (alice) await alice.stop();
    if (bob) await bob.stop();
  }
});
