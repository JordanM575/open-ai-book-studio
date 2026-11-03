# Research: whether D-115 gates user-driven local install and upgrade (D-172)

**Task:** 009 T023 · **Status:** research recorded, decision not accepted — nothing is installed here.
**Evidence:** `apps/desktop/tests/profile-stability-premises.test.ts` (4 pass, mocked Electron
profile root, synthetic settings); `apps/desktop/src/main/settings.ts`
(`settingsFilePath`, version-free `studio.json`); `packages/core/src/schema.ts` (no app version
in `book.json`); `packages/core/src/library/service.ts` (`assertSchemaVersion` refuses newer
schemas before any write); 030 premises (opening an old book rewrites nothing). No live
provider, paid service, real download, quarantine event or device was used. Gatekeeper
behavior below is a documentation survey with that limitation stated, not a tested fact.

## What local install and compatible upgrade involve (observed)

- Installing is placing an application bundle (unpacked `package:dir` output, or an unsigned
  `.app`/`.dmg` from `bun run dist`). The app's only first-run write is the profile file.
- The profile is one file, `studio.json`, directly under Electron's per-app `userData`
  directory, which carries the app name but no version. Two compatible builds share it;
  install/upgrade never relocates it, settings writes stay inside that root, the file carries
  no app version, and an older reader tolerates unknown future keys (premise tests).
- The library lives wherever the author put it. Opening an old book rewrites nothing, a newer
  schema is refused before any write, and `book.json` carries no app version — there is
  nothing version-stamped to migrate on a compatible (same-schema) upgrade.
- Compatible upgrade therefore changes exactly one thing: the application bundle. Profile
  and library continuity are structural, not procedural.

## What D-115 owns regardless (not revisited)

Signing identity, notarisation and stapling, the update feed and manifest, and automatic
updates. None of those is needed to place a bundle by hand and open it. The D-115 trigger —
"a public download page, or the first external tester on macOS" — already contemplates
testers running the app before acceptance.

## Gatekeeper and the unsigned download (doc survey, untested locally)

Public Apple behavior: an unsigned app fetched from the internet is quarantined, and the
first launch requires an explicit override (Control-click → Open, or Privacy & Security
approval). That is friction and disclosure, not a technical block — and testing the actual
quarantine dialog would need a real download plus the native GUI, which is out of bounds
for synthetic checks. The decision must therefore require the override to be disclosed in
the tester instructions, and must never describe the unsigned build as double-click clean.

## Alternatives considered

- D-115 gates everything including manual local install (rejected): nothing in the manual
  path consumes a signature, a ticket, a feed or an updater. Gating it would park tester
  workflows behind a certificate with no technical basis, while the D-115 trigger itself
  expects testers before acceptance.
- Allow local install without conditions (rejected): the Gatekeeper override, the unsigned
  label (T002) and the same-schema boundary are load-bearing. An unconditional yes invites
  schema-mismatched upgrades and silent quarantine confusion.
- Decide the profile location and uninstall behavior here too (rejected as scope creep):
  those are T024/T025/T028 matters. This decision only settles the gating question so that
  work can proceed.

## Recommendation

D-115 does **not** gate user-driven local installation or compatible local upgrade. Allowed
now, by hand only: place an unsigned build, run it, upgrade by replacing the bundle, keep
the shared profile and the author-chosen library untouched. Required every time: the
Gatekeeper-override disclosure, the unsigned label in About and the record, same-schema
only (anything else refuses and guides — T029 owns that journey), no update feed, no
automatic behavior, no credential use, no publication. D-115 keeps signing, notarisation,
update feeds and automatic updates, and its acceptance still removes the override friction.

## What this unblocks when accepted

T027/T030 (local upgrade/install paths) still wait on T024's matrix as well; T028 waits on
T024 (and T025 for the optional cleanup); T029's refusal journey is independent of the
install policy. None of them may publish, download for the author, or use credentials.
