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

A bounded, test-only in-memory relay adapter and GitHub Actions workflow were added on the diagnostics branch. The pinned SDK installed successfully and both independent clients initialized. The first assertion attempt was miswired: Bob's client did decrypt Alice's first-contact message, but the test associated the two clients' receive hooks with the opposite promises. The resulting timeout was a test-harness assertion defect, not evidence of a cryptographic receive failure. After correcting the hook-to-client mapping, the complete bidirectional exchange passed.

Runs:
- Initial relay attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41849756336
- Corrected prekey fetch signature: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41849881948
- Envelope-ID delivery attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41850070478
- Instrumented receive attempt: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41850647027

The adapter is a narrow test harness, not a complete conforming relay. It must not be used for production or cited as evidence that Netcha E2EE works. Next diagnosis must inspect the SDK's `handleRelayMessage` / receive-queue path and required envelope wire semantics, then rerun until both decrypt hooks assert the exact payload in both directions. The local memory store also reports no encryption-at-rest protection; this is acceptable only for disposable synthetic CI fixtures and is not evidence of secure persistent storage.


## Successful bidirectional exchange (2026-11-04)

GitHub Actions run **41851358871** completed successfully on commit `9bf885c9d7dce5e7aa8a212626dc6398103d3131`.

Verified in the isolated CI process using SDK `@open-e2ee/signal-protocol-sdk@14.0.0` and two separate client stores:

1. Alice sent the first-contact message to Bob. Bob's real SDK `onMessageDecrypted` hook received the exact expected plaintext.
2. Bob replied using the established session. Alice's real SDK `onMessageDecrypted` hook received the exact expected reply.
3. The relay recorded the envelopes, and assertions confirmed that neither test plaintext string appeared in the encoded ciphertext.
4. CI completed with **2 tests passed, 0 failed**.

Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41851358871

Scope and limits:
- This validates the SDK's pairwise first-contact and reply cryptographic path through a disposable in-memory test relay.
- It does not validate a production relay, persistent/encrypted local storage, browser/Android/iOS integration, group sender keys, media encryption, device linking/revocation, offline recovery, or independent security audit.
- The SDK emitted its explicit warning that the test's in-memory store has no encryption at rest and content recovery is disabled. It is acceptable only for synthetic CI test data.
- No Netcha production backend, production database, user conversations, or Railway deployment was changed.
- This passing test is **not** approval to enable E2EE in production.

## Replay and relay-payload verification (2026-11-04)

The pairwise test was extended to replay the exact same delivered envelope, retaining its server-assigned envelope ID. The SDK logged `replay-detected` for the already processed ratchet counter, and the test confirmed Bob's plaintext callback remained at exactly one invocation. The test also asserts that the first leg is `prekey_bundle`, the reply is `ciphertext`, the serialized relay envelopes contain neither test plaintext, and the recipient acknowledged the initial envelope.

GitHub Actions run **41851864865** passed: **2 tests passed, 0 failed**.
Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41851864865
Test commit: `c41e78bd1dbf41155db9481f890652af2ce14704`.

This adds evidence for duplicate-delivery/replay handling in the SDK client path and ciphertext-only pairwise envelopes. It does not prove server-side durable idempotency, atomicity under concurrent database transactions, tamper rejection, persistent storage, or production security.

## Concurrent prekey reservation verification (2026-11-04)

The isolated relay test now also performs two simultaneous prekey-bundle fetches for Bob after the real pairwise exchange. Both calls returned published bundles and the test asserted distinct EC and KEM one-time prekey IDs, exercising the adapter's no-double-allocation behavior under concurrent calls.

GitHub Actions run **41852034241** passed: **2 tests passed, 0 failed**.
Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41852034241
Test commit: `516ab1e7f73332946b8ba372dd7b025b9f974861`.

This is an in-process concurrency check of the disposable JavaScript adapter only. It is not proof of transactional atomicity in a multi-process database or production relay. Persistent-store, corruption/tamper, out-of-order delivery, offline restart, media, group, and multi-device tests remain open.

## Malformed ciphertext rejection (2026-11-04)

The isolated pairwise test now mutates an outgoing synthetic ciphertext in the relay and observes the SDK's `onDecryptionError` callback. The SDK reports `INVALID_CIPHERTEXT`; the test confirms that Bob's decrypted-message callback is not invoked a second time and that the mutated relay envelope contains no test plaintext.

GitHub Actions run **41853290693** passed: **2 tests passed, 0 failed**.
Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41853290693
Test commit: `e9a18d846a05853ff08d7c700bcbc6969a2a6585`.

Important limitation: the SDK diagnostic for this mutation is `Malformed message` / invalid base64, so this verifies rejection at the ciphertext parsing boundary. It does **not yet** prove that a syntactically valid ciphertext with a modified authenticated byte is rejected by the cryptographic MAC/authentication check. That stronger test remains open. The earlier attempt that corrupted the first base64 character timed out waiting on the wrong hook; the test was corrected to observe `onDecryptionError`. No production service or user data was involved.

The SDK's storage source was also inspected: it provides a React Native SQLCipher store backed by a platform keychain vault, an Expo SQLCipher/SecureStore path, and a browser IndexedDB store whose documented security caveat includes same-origin/XSS exposure. Netcha's current Capacitor app loads the remote web app, so none of these adapters is automatically a secure native store for the current app. A Capacitor-compatible encrypted persistence/key-custody design and real-device verification are still required; the in-memory fixture remains unsuitable for production.


## Authenticated ciphertext tamper rejection (2026-11-04)

The previous malformed-base64 test remains a separate parser-boundary check. A stronger test now alters one byte of the **actual 8-byte MAC** in an established-session SignalMessage while preserving the outer relay encoding and the inner base64 wire format.

The test follows the SDK's documented envelope decoding: the relay payload is decoded to the inner base64 SignalMessage, the raw framed bytes are decoded, and the final MAC byte is flipped. The altered message is then passed through the public `decryptMessage` API of Bob's independent SDK client.

GitHub Actions run **41856078455** passed on commit `2ce239e7555136bcada4af4b8998365c5fee380b`: **2 tests passed, 0 failed**.

The SDK emitted:
- `MAC verification failed`;
- `DECRYPTION_FAILED`;
- `Message authentication failed - MAC mismatch`.

The test also verifies that the tampered plaintext is never delivered to Bob's application callback. This is positive evidence that the SDK's message-authentication check rejects a syntactically valid SignalMessage with a modified MAC. It is still an isolated SDK test using synthetic accounts and in-memory stores, not an audit of Netcha's production integration.

Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41856078455

## Netcha Capacitor storage integration gate

The Android build repository's current `package.json` contains Capacitor 7, Firebase Messaging, and Local Notifications, but no SQLCipher database adapter or native secure-key vault. The SDK's built-in stores do not provide a drop-in Capacitor adapter:

- The SDK's React Native SQLCipher store is for bare React Native/op-sqlite and react-native-keychain. It cannot be installed into this Capacitor application as-is.
- The SDK's browser SQLCipher/OPFS store may be a candidate only if the Android WebView supports OPFS and the required worker/CSP configuration. Its default database key vault is IndexedDB on the same origin; same-origin JavaScript, including injected or XSS code, can read that key. It is therefore not sufficient as the final native key-custody boundary for Netcha.
- The SDK's custom `SignalProtocolLocalStore` and `SignalProtocolLocalSecretVault` contracts permit an application adapter. The Capacitor path needs a native SQLCipher-backed store and a native Android Keystore/iOS Keychain-backed vault, exposed through a Capacitor plugin or a rigorously verified custom key-value backend. It must pass the SDK store conformance kit, transaction tests, wrong-key tests, and real-device process-restart tests.
- The encrypted database must be excluded from cloud/device backup unless the corresponding vault key is safely and intentionally recoverable. Loss of the key must fail closed, never silently create a new identity over the old session.

No storage plugin, native dependency, or production application file has been modified in this diagnostic branch.

## Media, group, and device integration gates

The SDK exposes a two-layer encrypted media workflow: local file encryption, ciphertext-only remote object storage, and a small attachment pointer whose media key and integrity metadata travel inside the E2EE message. The SDK also documents durable prepared-upload records, idempotent retries, and a remote-object-store broker. Netcha still needs an authenticated backend broker and durable client-side upload preparation store; the current test relay does not implement either. The first tests must prove that the object store sees ciphertext only, the key never reaches the backend, retries reuse the same prepared ciphertext/object identity, and a downloaded file fails integrity verification after corruption.

The SDK includes sender-key/group and device-management capabilities, but the current isolated relay fixture implements only a narrow pairwise subset. It cannot validate production groups or multi-device security. Before Netcha integration, implement a separately isolated contract-level relay fixture and test:
- three members can exchange encrypted group messages;
- removal rotates group sender-key state and the removed member cannot decrypt future messages;
- a newly linked device receives only the sessions and keys authorized by the device-linking protocol;
- a revoked device cannot receive new messages after the server-side device set changes;
- each account/device has independent local key material and encrypted persistence.

## Current validation boundary

Passing synthetic tests now cover first-contact pairwise exchange, reply, replay/duplicate suppression, ciphertext-only envelope assertions, concurrent in-memory prekey reservation, malformed ciphertext parsing rejection, and valid-format MAC authentication failure. These tests do **not** validate the production relay, durable database atomicity, native encrypted persistence, offline queue recovery after process death, media integration, group member removal, multi-device revocation, iOS/Android real-device behavior, XSS/CSP hardening, or an independent external security audit.

The branch remains diagnostic-only. Do not merge it into the Netcha application, do not deploy it, and do not enable E2EE for users on the basis of these tests.


## Out-of-order pairwise delivery verification (2026-11-04)

The isolated pairwise test now holds two consecutive Alice-to-Bob established-session envelopes, delivers the later envelope first, then delivers the earlier envelope. Bob's SDK client successfully surfaces both exact plaintexts. This exercises the SDK's skipped-message-key / out-of-order receive path with synthetic users and the disposable in-memory relay.

GitHub Actions run **41856427989** passed on commit `868cb3860bcb9daed862135117176237969c7fd1`: **2 tests passed, 0 failed**.

Run: https://github.com/pharellbitang-bit/Netcha-Android-Build/actions/runs/41856427989

Scope: this verifies delayed and reversed delivery while the clients remain alive. It does not prove offline send queue persistence, process termination/restart recovery, network reconnection semantics, or durable mailbox ordering in a production relay.
