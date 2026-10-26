# Plan: sync and device trust

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md) · **Research:** [research.md](research.md)

## Shape

```
           iCloud Drive / Google Drive folder / local folder
                              │  (provider syncs in the background)
                    ┌─────────▼─────────┐
                    │   LibraryPort     │  existing storage boundary
                    └─────────┬─────────┘
              ┌───────────────┴────────────────┐
              │                                │
     ┌────────▼────────┐              ┌────────▼────────┐
     │  LibraryService │              │   SyncJournal   │
     │  (existing)     │◄────────────►│  .studio/sync/  │
     └────────┬────────┘              └────────┬────────┘
              │                                │
     ┌────────▼────────┐              ┌────────▼────────┐
     │  SaveConflict   │              │  DriftDetector  │
     │  (existing)     │              │  read-only scan │
     └────────┬────────┘              └────────┬────────┘
              └───────────────┬────────────────┘
                      ┌───────▼────────┐
                      │  Drift report  │  review before writing
                      └────────────────┘
```

The journal and detector live in `packages/core/src/sync/`, above `LibraryPort`. They are shared by the
desktop and browser builds. The lock lives in the shell (Electron main / Capacitor iOS), not in core.

## Journal

```jsonc
{
  "schemaVersion": 1,
  "deviceId": "device_…",
  "generation": 42,
  "scannedAt": "2026-10-25T23:00:00.000Z",
  "files": {
    "books/book_…/chapters/0001-one.md": {
      "sha256": "…",          // last observed on disk
      "writtenSha256": "…",   // last written by this device, if different
      "version": 7,
      "size": 1234,
      "observedAt": "…",
      "deleted": false        // tombstone
    }
  }
}
```

- The journal is device-local. It is excluded from the portable archive (`.studio` is already excluded
  except trash) and from the catalog.
- It is written atomically after a successful scan or save, never during the scan itself.
- `writtenSha256` answers "did this device write the current bytes?" If it matches, the change is local.
  If it does not, the change arrived from outside. This avoids guessing from timestamps.
- Deleting a file writes a tombstone (`deleted: true`) instead of removing the entry, so a stale copy on
  another device is reported rather than silently resurrected. Tombstones are pruned after a configurable
  number of scans or days, with the pruning recorded in the journal.

## Drift algorithm

1. Enumerate author-owned files (`books/**`, `library.json` is derived and skipped) and `.studio/trash/**`.
2. Read each file only as far as needed: `stat` first, then a hash when size or mtime differ from the journal.
   Never open a placeholder; detect it first.
3. Classify:
   - `unchanged` — hash equals `sha256`.
   - `remote-changed` — hash differs, and does not equal `writtenSha256`.
   - `local-changed` — hash differs, equals `writtenSha256` (this device wrote since the journal).
   - `both-changed` — the journal has a remote change and the editor reports a dirty buffer for that chapter.
   - `remote-deleted` / `local-deleted` — a tombstone versus the file's presence.
   - `conflict-copy` — a `conflicts/*.md` file not in the journal.
   - `placeholder`, `unreadable`, `schema-newer`.
4. Produce a `DriftReport` with counts, entries, and a `clean` flag. Write nothing.
5. On author action, update the journal and/or open the existing conflict review. The service's save
   conflict path remains the final guard.

The scan runs on library open, on window focus after the configured interval, and from Settings ("Check
for changes"). It never runs on a timer while the author is typing.

## Providers and placeholders

- **iCloud Drive (macOS):** a plain folder under
  `~/Library/Mobile Documents/com~apple~CloudDocs/…`. Files can be evicted; `.icloud` sidecars and
  `NSURLUbiquitousItemDownloadingStatus` identify online-only items. Use `NSFileCoordinator`/`NSFilePresenter`
  for reads and writes where the shell allows it. iOS requires the iCloud Documents entitlement and the Files
  picker.
- **Google Drive:** the desktop app's mounted folder. Online-only placeholders are the main risk; the scan
  reports them and asks the provider to materialize, or tells the author to open the file in Drive first.
  Direct API access is deferred.
- **Local folder:** no placeholders; still benefits from drift detection after sleep/restore or a second
  device writing to a shared disk.

Provider-specific code stays in the shell adapters. Core only sees `LibraryPort` plus a small
`PlaceholderProbe` capability so the detector can ask "is this materialized?".

## App lock

- **macOS desktop:** `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` from a small native helper
  called by Electron's main process. Lock on launch and on resume from sleep; unlock does not re-read the
  library. If `canEvaluatePolicy` is false, the setting explains that the device has no passcode/biometrics.
- **iOS:** LocalAuthentication via a Capacitor plugin. The plugin choice is part of D-121; the app does not
  take a new dependency until that is reviewed.
- **PIN:** a 6+ digit PIN is a fallback. Store a verifier in the keychain (`ThisDeviceOnly`, random salt,
  PBKDF2/Argon2 with calibrated cost) plus an attempt counter. Five failures add a delay; repeated failures
  disable the PIN and fall back to device authentication. No recovery code.
- **Honesty:** the settings copy says the lock is a UI gate, not encryption. The files remain readable by
  Finder, a CLI, and the agent. A future encrypted-vault decision can change that, but it is not v1.
- **Browser:** no Face ID claim. Browser credentials remain origin-scoped under ADR 0011.

## Two-system harness

`apps/desktop/tests/sync/two-system.test.ts` (Bun, no network) creates two temporary libraries and a
`Transport` that copies the library tree between them. The transport can:

- copy normally, with a configurable delay;
- copy only some files, or a file prefix (partial write);
- rename a file while it is in flight;
- hold changes offline and deliver them in a batch;
- inject a conflict copy the way iCloud would;
- skew timestamps independently of hashes;
- mark a file as a placeholder.

A scenario edits, syncs, scans, resolves, and scans again. Assertions are about bytes on disk, the drift
report contents, duplicate conflict copies, and idempotency. The harness is the specification for provider
behavior; the manual two-device pass validates the transport assumptions against iCloud/Google Drive.

## Phases

1. **Journal and detector** (T001–T003): pure core work, no UI, fully unit-tested.
2. **Two-system harness** (T004–T005): catch the semantics before touching the interface.
3. **Drift report UI** (T006–T007): review before writing, settings disclosure.
4. **App lock** (T008–T010): macOS first, then iOS; PIN last.
5. **Real-provider pass and docs** (T011–T012).

## Risks

- iCloud eviction and Google Drive placeholders can look like empty files to a naive reader. Detection must
  precede reading; a zero-byte file is not proof of emptiness.
- Conflict copies may be duplicated by the provider (iCloud adds "conflicted copy" names, Google Drive adds
  its own). The detector must treat a conflict copy as a reportable entry, not a new chapter.
- The journal can be stale, corrupt, or copied to another device by the provider. The `deviceId` check and a
  full-comparison fallback are mandatory.
- Mobile background execution is limited; the iOS pass may only scan when the app is foregrounded.
- A UI lock can be misunderstood as encryption. The copy and docs must be explicit.
