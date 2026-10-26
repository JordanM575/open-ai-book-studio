# AI Book Studio — Constitution

Principles that every spec, plan and pull request is measured against. If a change conflicts with one
of these, the change is wrong or the constitution needs an explicit amendment.

## 1. The author's files are the product

The manuscript exists as ordinary files in a folder the author chose. No feature may make the app the
only way to read or recover a book. Any cache, index or database is derived and may be deleted at any
time without losing a word.

## 2. One writer, checked

Only the main process writes to the library. Every write is atomic, carries a version and a content
hash, and refuses to overwrite a file that changed underneath it. Text that cannot be saved is
preserved as a conflict copy and explained to the author. Nothing is deleted permanently; deletions
go to `.studio/trash`.

## 3. Local-first, no custody

No account, no server of ours, no telemetry, no background network traffic. AI features run only
when the author asks, through the author's own key, stored in the OS keychain. Sync happens through
the folder the author already uses; the app never holds provider credentials.

## 4. Spec before code

Behaviour changes start as a spec in `specs/`, are planned in `plan.md`, and are executed from
`tasks.md`. Architecture decisions are recorded as ADRs in `docs/adr/`. The file format is specified
in `docs/FORMAT.md` and changes to it update that document in the same commit.

## 5. Honest interface

The UI states what is true: save state, conflicts, errors, and what the app does and does not send.
Errors say what happened and what to do next. No silent data loss, no fake success, no progress that
is not progress. Copy follows `docs/DESIGN.md`: sentence case, no exclamation marks, no emoji,
middle dots for status.

## 6. Designed, not assembled

Visual work uses the vendored tokens from the design kit and the structural classes in `base.css`.
The manuscript is the only solid surface; floating layers are glass. One primary action per view.
Light, dark, reduced transparency and keyboard-only must all be checked before a UI task is done.

## 7. Tests at the boundaries

Every file-writing path has a test against a temporary library: round-trip, idempotence, conflict,
failure. The built app is exercised by a hidden-window smoke run. Type checking passes for both
TypeScript projects before commit, and `CHANGELOG.md` is updated in the same commit as the change.

## Amendment

Amendments require a short ADR stating the principle being changed and why, plus updates to this file
and `AGENTS.md` in one commit.
