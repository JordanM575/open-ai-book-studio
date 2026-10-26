# Sync and device trust

**Status:** Planned (requirements captured 2026-10-25)
**Number:** 016. 015 is left for the web-target branch if it becomes a spec.
**Depends on:** [010](../010-web-target/spec.md) storage ports, [014](../014-mobile/spec.md) Capacitor shell,
[002](../002-studio-v1/spec.md) library format and conflicts.

## Why

Authors already keep novels in folders that their storage provider syncs: iCloud Drive, Google Drive, a
network share, or a plain local folder. The studio must work with that reality without becoming a sync
service. It must also notice when a second device changed the library while this one was closed, and it
must be able to lock itself behind the device's own biometrics or passcode.

The hard part is not copying bytes. It is knowing what changed, preserving both sides when two devices
edited the same chapter, and never claiming "saved" when a provider left a placeholder or a partial file.

## User stories

1. **Two devices, one folder.** I keep the library in iCloud Drive and open it on my Mac and iPad. After
   iCloud syncs, the second device shows me what changed before I write.
2. **Back from offline.** I edited on the laptop on a plane. When I open the desktop again, it detects the
   chapters that changed elsewhere and shows a drift report instead of silently reloading or overwriting.
3. **Local lock.** I can require Face ID, Touch ID, or the device passcode to open the studio. If biometrics
   are unavailable, I can set an optional PIN that is checked against a keychain-protected verifier.
4. **No studio account.** I never create an account, and the studio never uploads prose or credentials.
   The only sync is the one my storage provider already performs.

## Requirements

### Sync model

- **FR-001** The studio MUST NOT introduce a studio account, sync server, proxy, or telemetry. Sync is the
  file-sync service the author already uses for the chosen folder.
- **FR-002** v1 supported locations: a local folder, an iCloud Drive folder (macOS and iOS through Files),
  and a Google Drive folder mounted by the Google Drive desktop app. Direct Google Drive OAuth/API access
  is out of scope for v1; it needs its own decision.
- **FR-003** Each device keeps a sync journal at `.studio/sync/<deviceId>.json`. It records the last
  observed hash and version of every author-owned file, the hash this device last wrote, and a scan
  generation. Journals are device-local and MUST NOT contain credentials, plaintext prose, or host paths.
- **FR-004** On opening a library, and when the window regains focus after a configurable interval, the
  studio MUST scan for drift without writing: files added, changed, deleted, renamed, conflict copies,
  online-only placeholders, unreadable files, and books with a newer schema.
- **FR-005** A file whose current hash differs from the journal is a **remote change** unless it matches the
  hash this device last wrote. If the local editor also has unsaved text, the existing save-conflict path
  remains authoritative and both versions MUST be preserved.
- **FR-006** Online-only or placeholder files MUST be materialized before reading, or reported as "not
  downloaded". The studio MUST NOT treat a placeholder as an empty or truncated chapter.
- **FR-007** The scan MUST be read-only and idempotent. Repeating it MUST NOT create duplicate conflict
  copies or rewrite files.
- **FR-008** Deletions are recorded as tombstones in the journal. A chapter deleted on another device MUST
  be reported; it MUST NOT silently reappear from a stale local copy.
- **FR-009** Atomic writes, hash checks, conflict copies, and the library trash remain the only write
  primitives. Sync MUST NOT add a second save path or a second save-status enum.
- **FR-010** The drift report is author-readable: what changed, when it was last seen, which device changed
  it when known, and what the author can do (review, keep the disk version, keep mine, open both, export).
- **FR-011** A corrupt or missing sync journal MUST degrade to a full comparison against the existing
  files, with a warning, not to a silent overwrite.
- **FR-012** Clock skew MUST NOT decide a conflict. Hashes and versions decide; timestamps are display-only.

> **Suggested sync requirement (non-goal):** automatic merge of prose. v1 preserves both versions and
> asks. Agent-assisted merge is a later, opt-in feature.

### Device lock

- **FR-013** On macOS and iOS, the app MAY require device-owner authentication (Face ID, Touch ID, or the
  device passcode) at launch and on resume. The setting is off by default.
- **FR-014** If biometrics are unavailable or fail repeatedly, the author MAY use an optional PIN. The PIN
  verifier is stored in the OS keychain with `ThisDeviceOnly` protection, a random salt, a slow KDF, and a
  bounded attempt policy. The PIN is never stored in the library, logs, or an export.
- **FR-015** The lock is a **UI gate**, not encryption. Library files remain ordinary Markdown and are
  readable by other apps with filesystem access. The settings copy MUST say this plainly; encryption at
  rest is a separate decision.
- **FR-016** Locking MUST NOT block the agent, CLI, or a background sync. It protects the visible workspace,
  not the files themselves.
- **FR-017** There is no account recovery. Losing the device credentials or the keychain item means the
  author re-enables the lock; the library itself is unaffected.
- **FR-018** Browser credentials remain origin-scoped (ADR 0011). Face ID/PIN is a native-shell feature and
  MUST NOT be presented as protecting a browser library.

### Verification

- **FR-019** A two-system harness MUST emulate two libraries and a transport that can copy, delay, partially
  write, rename, go offline, and deliver iCloud-style conflict copies. It MUST run without network access.
- **FR-020** The harness MUST cover: clean propagation, concurrent edits, offline edits, delete/tombstone,
  placeholder files, interrupted copy, clock skew, corrupt journal, and repeated scans.
- **FR-021** Every drift scenario MUST assert that no author bytes are lost and that a second scan does not
  duplicate conflicts.
- **FR-022** A manual two-device pass (Mac + iPad, iCloud Drive; then Google Drive) records the provider,
  OS versions, placeholders observed, and results in `docs/research/`.

## Non-goals

- Studio-hosted sync, accounts, sharing, presence, or real-time collaboration.
- Automatic prose merging or silent last-writer-wins.
- Encryption at rest or a passphrase vault in v1.
- Google Drive OAuth/API and background sync agents the studio controls.
- Windows and Linux sync support (desktop remains macOS-first; revisit separately).

## Acceptance scenarios

1. **Clean propagation.** Edit chapter A on device 1, let the provider sync, open device 2. The drift report
   lists A as changed, opening it shows the new text, and saving does not create a conflict.
2. **Concurrent edit.** Edit A on both devices while offline, sync. Opening either device reports both
   versions; the chapter on disk is untouched and the local text is available as a conflict copy. No
   silent overwrite.
3. **Deletion.** Delete A on device 1, sync, open device 2. The report lists A as deleted and does not
   resurrect it from the journal.
4. **Placeholder.** Open a library whose chapter is online-only. The studio reports "not downloaded" and
   offers to materialize it; it never shows an empty chapter.
5. **Corrupt journal.** Delete or corrupt the journal, reopen. The studio warns, rebuilds by comparison,
   and writes nothing until the author accepts the report.
6. **Lock.** Enable Face ID, relaunch, cancel the prompt. The workspace stays hidden; the PIN fallback works;
   five wrong PINs introduce a delay; the library files remain readable in Finder.
7. **No account.** With the network monitor open, opening, editing, and syncing produce no request to a
   studio-owned host. Only the storage provider's own sync traffic appears.

## Open decisions

- **D-120** Sync journal format and drift baseline.
- **D-121** App-lock scope: UI gate vs encrypted vault; PIN policy and platform APIs.
- **D-122** Storage-provider support: iCloud Drive/iCloud Documents, Google Drive mounted vs API, placeholders.
- **D-123** Conflict-resolution UX: file-level copies vs chapter review vs assisted merge.

The plan and tasks assume the recommendations in those decisions; none is accepted yet.
