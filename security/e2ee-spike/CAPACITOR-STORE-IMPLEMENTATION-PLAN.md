# Capacitor 7 native storage spike — implementation plan

Date: 2026-11-04
Branch: `diagnostics/github-runner-allocation`
Status: candidate dependencies pinned for compile-only validation; no E2EE storage adapter or message encryption is active.

## Selected candidate pair (exact versions)

1. `@capacitor-community/sqlite@7.0.3`
   - Exact package metadata declares peer `@capacitor/core >=7.0.0`.
   - Native Android/iOS database encryption is provided through SQLCipher.
   - API exposes database transactions; this is the candidate durable storage substrate for the SDK custom `keyValueStore` adapter.
   - SQLCipher's community distribution carries export/compliance obligations and a user-accessible copyright/license notice requirement. Do not ship until the legal notice and applicable export review are completed.

2. `@aparajita/capacitor-secure-storage@7.1.6`
   - Exact package metadata identifies it as Capacitor 7+ and its native dependencies target Capacitor 7.4.x.
   - Android stores values encrypted using an AES-GCM key generated/protected by Android Keystore; iOS uses Keychain.
   - Its API supports `whenUnlockedThisDeviceOnly` on iOS and disabling iCloud synchronization.
   - Candidate for the SDK's small secret vault only, not for the entire Signal session database.

These versions are pinned only in the isolated Android wrapper branch. They are not approved for Netcha production.

## Key separation

Keep three responsibilities distinct:

- SQLCipher database encryption passphrase: managed through the SQLite plugin's native secure-secret mechanism (Android implementation uses EncryptedSharedPreferences with a Keystore-backed master key). This protects the database file.
- SDK key-value-store encryption secret: a separate random secret stored through `SecureStorage`; the SDK custom vault adapter exposes only get/set/delete of this secret.
- Signal identity/session/prekey/sender-key records: persisted by the custom SDK storage adapter into the SQLCipher database, never into localStorage, Preferences, or plaintext files.

Do not reuse one key for the SQLCipher database and the SDK store encryption. Never derive either key from a password, account phone number, device identifier, or hard-coded constant.

## Current isolated changes

- Root `package.json` pins the two candidate plugin versions.
- `capacitor.config.json` enables SQLCipher for Android and iOS and registers the SecureStorage plugin.
- `.github/workflows/storage-native-compile.yml` generates an Android project on GitHub Actions, syncs native plugins, checks native registration, and compiles a debug APK. It does not publish or deploy that APK.
- No SDK adapter code, database schema, account keys, user data, production API route, or Railway setting has been changed.

## SDK transaction API compatibility finding

The pinned SDK 14.0.0 key-value contract has asynchronous storage methods, but its convenience helper `createTransactionalKeyValueBackend` expects a synchronous `KeyValueTransaction` handle inside an engine transaction callback. The Capacitor SQLite plugin 7.0.3 exposes asynchronous bridge methods (`beginTransaction`, `query`, `run`, `commitTransaction`, `rollbackTransaction`); it does not expose the synchronous `executeSync` connection used by the SDK's op-sqlite example.

Therefore, do **not** pass Capacitor SQLite through the SDK's `createTransactionalKeyValueBackend` by pretending its API is synchronous. The viable experiment is a purpose-built `KeyValueStorage` implementation that uses the plugin's asynchronous transaction API directly and implements the SDK's complete `atomicWrite` operation semantics. It must:

- serialize all operations through one exclusive connection/queue;
- start one native SQL transaction for every `atomicWrite`;
- evaluate all `check` compare-and-swap guards against pre-batch state before writes;
- apply `set`, `remove`, `pruneSkippedSenderKeys`, `removeSessionsForUser`, and `removeSenderKeyHandoffs` in order, with later operations seeing earlier writes;
- rollback the entire transaction on any failed check, SQL error, plugin error, or process interruption;
- resolve only after the native commit completes;
- implement `getItem`, `setItem`, `removeItem`, `getAllKeys`, and `removeMany` consistently with that same queue;
- pass `assertBackendConformance` with `reopen` support, then run added race, interruption, wrong-key, and physical-device restart tests.

This custom backend duplicates part of the SDK's batch semantics, so it must be pinned to SDK 14.0.0 and re-reviewed whenever the SDK changes. It is not implemented yet.

The vault can be a small wrapper over the Capacitor SecureStorage plugin's string `getItem`/`setItem`/`removeItem` methods, encoding the SDK's `Uint8Array` secret as a strictly validated hex or base64 string. Configure iOS device-only Keychain access and no iCloud synchronization; verify Android Keystore-backed encryption and backup behavior on-device. The SQLite plugin's own database passphrase and the SDK's separate 32-byte value-encryption key must remain distinct.

## Compile gate versus security gate

The new workflow can establish only that the pinned native plugins resolve, register, and compile together with the current Capacitor 7 wrapper. A successful APK build is not proof that:
- SQLCipher is actually opened with a non-empty random passphrase;
- the passphrase survives process death and remains inaccessible to ordinary app storage;
- the SDK custom `keyValueStore` adapter correctly implements all SDK semantics;
- transactions and compare-and-set operations are truly atomic under concurrent callers;
- the SDK vault's failure modes are fail-closed;
- backup/restore, uninstall/reinstall, OS upgrade, or key invalidation behave safely;
- the iOS implementation compiles or behaves correctly.

## Next required implementation and tests

1. Inspect the exact SDK 14.0.0 `keyValueStore`, `SignalProtocolLocalStore`, and `SignalProtocolLocalSecretVault` contracts and write a narrow adapter around SQLite + SecureStorage.
2. Implement explicit DB initialization: obtain or create a cryptographically random database passphrase in native secure storage, open only an encrypted DB, and refuse to create a new identity if an existing DB cannot be opened.
3. Implement the SDK vault separately, with a versioned key name and no web/plaintext fallback. Treat missing/corrupt vault material as a hard error.
4. Run the SDK's `assertBackendConformance` suite and additional transaction/race/crash tests. Verify that concurrent writes do not lose or resurrect ratchet records.
5. Add Android instrumentation tests on a physical device: write protocol state, force-stop, reopen, decrypt a queued test message, then repeat after reboot. Inspect database/WAL/journal/logs for plaintext.
6. Build and test iOS on macOS/Xcode before claiming cross-platform support.
7. Decide backup policy explicitly. Do not restore a database without its corresponding keys. Prefer device-only vault keys and exclude database/WAL files from backup unless a separately reviewed recovery protocol exists.
8. Do not enable E2EE in production before external review, real-device testing, and the complete relay/media/group/multi-device gates.

## Fail-closed cases

- SQLCipher open/authentication failure: stop; do not create a replacement DB.
- SDK vault key missing, invalidated, or unreadable: stop; do not regenerate over existing encrypted state.
- DB file exists but key record is absent: quarantine diagnostic state and require reviewed recovery; never silently reset.
- Platform is web/browser: refuse E2EE storage initialization; no localStorage or IndexedDB fallback.
- App backup restores ciphertext but not its native key: stop and explain recovery is unavailable; never create a fresh identity silently.

## References checked

- SQLite 7.0.3 package metadata: https://github.com/capacitor-community/sqlite/blob/v7.0.3/package.json
- SQLite 7.0.3 SQLCipher guide: https://github.com/capacitor-community/sqlite/blob/v7.0.3/docs/DatabaseEncryption.md
- Secure Storage 7.1.6 package metadata: https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/package.json
- Secure Storage 7.1.6 API: https://github.com/aparajita/capacitor-secure-storage/blob/v7.1.6/src/definitions.ts

