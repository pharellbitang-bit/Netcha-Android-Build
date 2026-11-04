# E2EE relay test: implementation gate

Date: 2026-11-04
SDK inspected: `@open-e2ee/signal-protocol-sdk@14.0.0`, upstream tag `v14.0.0`.

## Confirmed public contracts

- `SignalProtocolClient.encryptMessage(remoteAddress, plaintext)` encrypts only when a session already exists.
- `SignalProtocolClient.decryptMessage(remoteAddress, ciphertext)` consumes the corresponding ratchet state.
- `SignalProtocolManager.startSession(remoteAddress, prekeyBundle, recipientIdentityType?)` establishes an outbound session from a recipient prekey bundle.
- `SignalProtocolManager.generatePreKeyBundle(userId, deviceId, identityType?)` generates and publishes local prekeys; it is not a standalone bundle-returning API.
- `SignalProtocolRelayServer` is an application-owned transport contract. It includes envelope send/subscribe/acknowledge, device registry, account identity provisioning/rotation, and prekey upload/fetch/consumption. The full interface extends beyond a trivial in-memory queue.
- `DefaultSignalProtocolClient` keeps its manager private. The app-facing client API does not expose the manager or a public method to export a local prekey bundle.
- The SDK's `inMemoryStore()` is a prototype/testing store, not a production persistence/security solution.

## Why no bidirectional test was added yet

A test that simply calls `encryptMessage` on two freshly initialized clients cannot work: neither client has a session. A valid first-contact test needs Bob's authentic public prekey bundle, Alice's session establishment from that bundle, delivery of Alice's initial PreKey ciphertext, Bob's decrypt/session creation, and then the reverse-direction ciphertext/decrypt. The SDK's public manager API uploads a bundle through its relay instead of returning it; the manager is private inside the composed client. Building an incomplete fake relay or fabricating a bundle would test an invented integration rather than the supported SDK contract.

## Safe next implementation

1. Select or implement a complete relay adapter conforming to the SDK's published `SignalProtocolRelayServer` contract, beginning with a deterministic test-only adapter.
2. Register two synthetic users/devices and provision account identity keys.
3. Upload and atomically fetch/consume Bob's prekey bundle through that adapter.
4. Deliver the first encrypted envelope and confirm Bob decrypts the exact plaintext.
5. Send a reply and confirm Alice decrypts it.
6. Add tamper, replay, duplicate, reordered delivery, restart/persistence, prekey exhaustion, and no-plaintext assertions.
7. Only then design the Netcha backend adapter. No production data, routes, or deployments are part of this spike.

## Security note

The SDK maintainer states that the project has not undergone an independent external security audit and is not affiliated with Signal Messenger or wire-compatible with Signal Messenger/libsignal. This prototype must not be represented as independently audited or production-ready.
