# E2EE storage decision for the Capacitor wrapper

Date: 2026-11-04
Scope: diagnostic branch only; no production or application integration.

## Decision

Do not use the SDK in-memory store, and do not ship the browser store as the final key-custody solution for Netcha. The Android build is a Capacitor 7 wrapper, not an Expo or bare React Native application. The SDK's Expo and React Native SQLCipher adapters are therefore not drop-in adapters.

The most viable Capacitor path to investigate is the SDK's supported `keyValueStore({ storage, vault })` adapter backed by a native, encrypted, durable key-value engine exposed through a Capacitor plugin. Its backend must pass the SDK-exported `assertBackendConformance` kit before it can be considered usable. This is a direction for a spike, not an approved implementation.

## Required storage split

- Native storage backend: durable records, transaction/atomic-write support, correct ordering and compare-and-set behavior.
- Native secret vault: Android Keystore and iOS Keychain; stores only the small wrapping key, never the session database.
- SDK key-value adapter: encrypts each stored value using the vault-held key.
- No private key, prekey private half, session, sender key, or plaintext message may be stored in unencrypted localStorage/IndexedDB.
- App reset, account removal, key rotation, device unlink, and crash recovery need explicit lifecycle semantics.

## Non-negotiable conformance/security gates

The backend must prove, with the SDK conformance kit and additional integration tests:

1. Atomic writes across all related records; in particular session + trust decision commits.
2. Atomic sender-key handoff invalidation in the same write as session/device/group deletion.
3. Compare-and-set semantics for receive work and metadata; no lost or resurrected receive records.
4. Stable trust decisions and metadata after close/reopen.
5. Correct session update/archive ordering; archived sessions must never reappear.
6. Atomic linked-device state transitions across crashes.
7. Wrong/missing vault key fails closed; it must never create a fresh identity over an existing unreadable store.
8. Encrypted-at-rest inspection confirms no plaintext protocol state in database, logs, backup, or temporary files.
9. Process kill/restart, app upgrade, device reboot, offline delivery, and concurrent writes tested on physical Android and iOS devices.
10. Backup/restore policy is explicit: encrypted database and vault key must remain recoverable together, or both be excluded. No accidental backup of only one side.

## Runtime-specific checks still required

- Confirm the selected Capacitor SQLite/key-value plugin actually supports SQLCipher on Android and iOS, with compatible native build tooling and maintenance status.
- Confirm Keystore/Keychain plugin semantics, backup behavior, accessibility class, and key invalidation behavior.
- Confirm WebView OPFS support only as a comparison experiment; even encrypted browser storage remains accessible to same-origin JavaScript and is not an XSS defense.
- Do not assume an Expo adapter or React Native Keychain module can be loaded into Capacitor.

## Stop conditions

No implementation or production rollout until the chosen backend passes the full SDK store conformance kit, transaction/race tests, wrong-key tests, physical-device restart tests, and an independent security review. Do not modify production Netcha or existing user data during this work.

## Evidence basis

The SDK 14.0.x adapter reference lists Expo, bare React Native, Node, web SQLite, IndexedDB, and key-value stores; it does not list Capacitor as a shipped runtime adapter. It explicitly supports a custom key-value backend only after `assertBackendConformance`. The store contract includes protocol, Sesame, sender-key, handoff, message-record, and send-log state, and requires atomic trust commits, handoff invalidation, compare-and-set receive work, and stable metadata. The vault interface stores small byte secrets only.
