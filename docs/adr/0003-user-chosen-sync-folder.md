# 0003 — Sync through a folder the author already owns

- **Status:** Accepted (2026-10-24)

## Context

Authors write on a laptop and a desktop, or want a backup. A cloud database would solve this, but it
means accounts, a server, ongoing cost, and custody of other people's manuscripts — all things this
product exists to avoid. Meanwhile everyone already has iCloud Drive, Google Drive or Dropbox.

## Decision

The library lives wherever the author points it, including inside a synced folder. The app performs
no OAuth, holds no provider tokens, and makes no network call to sync.

Safety comes from the file protocol:

- Writes are atomic renames (temp file → fsync → rename), so a provider sees old or new, never half.
- Every save carries a base `version` and base content hash. If disk has moved on, the author's text
  is preserved as `conflicts/<name>.conflict-<reason>.<deviceId>.<timestamp>.md` and the UI explains
  what happened; nothing is overwritten silently.
- Provider-generated "conflicted copy" files are detected and offered to the author rather than being
  mistaken for chapters.
- `.studio/device.json` names the machine so conflict copies are attributable.

## Consequences

Positive: no accounts, no server, no custody, works offline, works with any provider including a USB
stick. The worst case is a visible conflict copy, not lost prose.

Negative: real-time multi-device collaboration is impossible; providers occasionally create conflict
files of their own (we surface them); latency depends on the provider; the app cannot know a file is
"still syncing" so it must rely on hashes. iOS/Android access is limited to reading the files in the
provider's app until a companion exists.

Rejected alternatives: hosted sync service (custody, cost, complexity); Git as the transport
(excellent diffs, terrible for non-technical authors and merge conflicts in front matter); CRDTs
(eventually consistent, but they require a persistent operation log — i.e. a database — and make
plain files unreadable).
