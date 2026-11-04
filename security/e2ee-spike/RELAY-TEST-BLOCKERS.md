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


## Additional verification: SDK relay implementation availability

The upstream v14.0.0 source tree contains the relay interface and client-side transport contracts under `remote/relay/`, but no bundled in-memory relay server, mock relay server, or reference server implementation. The relay README explicitly says the published package contains client transports and contracts, not a relay server implementation.

The required first-contact relay operations include:
- `send`, `subscribe`, `markDelivered`, and connection-state observation;
- device registration/listing/removal;
- canonical account identity provisioning, lookup, and compare-and-swap rotation;
- upload, inventory, count, fetch, and atomic one-time EC/KEM prekey consumption;
- group state/change-log and credential methods in the full required interface, even though group capability is not needed for the narrow two-user test.

A deliberately narrow test adapter can implement only the pairwise operations actually invoked by the selected client configuration, but it must be labelled as a test harness with explicit unsupported methods; it must not be described as a fully conforming production relay. The next step is to map the exact method calls made during two-client registration, first-contact, delivery, and reply, then implement and type-check that bounded test adapter against SDK 14.0.0. If the SDK's public composition path prevents that without reaching into private fields, stop and document the blocker rather than bypassing encapsulation.


## First end-to-end relay spike attempt (2026-11-04)

A bounded, test-only in-memory relay adapter and GitHub Actions workflow were added on the diagnostics branch. The pinned SDK installed successfully and both independent clients initialized. The attempted Alice-to-Bob send produced an encrypted `prekey_bundle` envelope and the relay callback for Bob was invoked, but Bob's `onMessageDecrypted` hook did not fire before the test deadline. Therefore the reverse-direction leg was not reached and the Alice → Bob → Alice test is **FAIL / NOT VALIDATED**.

Runs:
- Initial relay attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41849756336
- Corrected prekey fetch signature: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41849881948
- Envelope-ID delivery attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41850070478
- Instrumented receive attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41850647027

The adapter is a narrow test harness, not a complete conforming relay. It must not be used for production or cited as evidence that Netcha E2EE works. Next diagnosis must inspect the SDK's `handleRelayMessage` / receive-queue path and required envelope wire semantics, then rerun until both decrypt hooks assert the exact payload in both directions. The local memory store also reports no encryption-at-rest protection; this is acceptable only for disposable synthetic CI fixtures and is not evidence of secure persistent storage.
