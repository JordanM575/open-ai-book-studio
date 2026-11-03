# Plan: library organization, goals and source-anchored notes

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Status

Draft / Planned. No implementation is claimed. The persistence and identity decisions in the spec
must be resolved before dependent storage or navigation work begins; independent interaction
design and synthetic contract tests may proceed without them.

## Summary

Add four small author-facing capabilities around the existing library: named collections, a recent
book resume list, one saved-word target per book, and passage bookmarks with optional notes. Keep
ordinary book/chapter files and the current checked save/trash paths authoritative. Use the shared
core/storage boundary for cross-target rules and the existing library and workspace surfaces for UI.
Do not add a new writer, index, account, service, report history or mobile shell.

## Architecture approach

### Shared domain rules

- Place pure record validation, progress derivation and safe anchor resolution in the existing
  shared core/library boundary. Do not put filesystem or host-profile access in renderer code.
- Route persistent writes through the existing storage/library service and its checked atomic
  commit contract, with base version/hash validation where supported. Do not create a second chapter
  writer or treat `library.json` as authoritative.
- Keep collections, goals and annotations in ordinary library files, not as database-only or
  host-profile-only author data. The accepted decision may treat recent-work pointers as disposable
  local preferences.
- Reuse current book and chapter identities. Resolve the identity for collections and annotation
  records through OD-033-02/OD-033-03 before serializing or navigating from them.
- Define the actual file paths, schema versions, limits, conflict handling and archive behavior only
  after OD-033-01 is accepted. If a public format change is selected, update `docs/FORMAT.md` and
  record the public decision/ADR before implementation depends on it.

### Feature behavior

- **Collections** reference books; they never rename, relocate or rewrite a book. The membership
  model and collection identity wait on OD-033-02. Collection removal affects references only.
- **Recent work** records only a successful, explicit open. Keep one current pointer per book and
  sort by last-open time. It is a resume aid, not an event/report store. Failure to update this
  nonessential data does not block the book.
- **Word goals** keep one optional total-word target per book. Derive progress from the existing
  saved-text counter. If the editor has a dirty draft, keep its estimate separate and label it as
  unsaved. If a complete saved count cannot be verified, show that state rather than a false total.
- **Bookmarks and notes** refer to a saved source passage and remain separate from chapter prose.
  Verify the source before navigation. A failed verification produces a visible stale state; do not
  guess, auto-relocate or rewrite the chapter. Explicit re-anchoring changes only the annotation
  record and waits on OD-033-03.

### User interface ownership

- Extend the library view owned by spec 002 with collections, recent work and a compact saved-word
  goal indicator. Keep the existing all-books listing, search, counts, update ordering and trash
  entry points intact.
- Extend the existing workspace/book controls with goal progress and a bookmark/note list. Reuse
  the current dialog, focus, save-state and error patterns; do not add a separate editor or
  onboarding flow.
- Spec 002 remains the owner of onboarding. Spec 014 remains the owner of responsive layout,
  navigation, touch targets, safe areas and mobile accessibility. This plan adds integration checks
  at their existing entry points and viewports, not duplicate designs or shells.
- Expose only validated operations through the established shared API and host boundary. The main
  process remains the desktop writer; browser and mobile targets use their existing adapters.

## Storage and safety constraints

OD-033-01 is a blocking decision for persistent metadata. Its outcome must state the storage scope
for each data type, whether it is author-owned or disposable, the version/checking rules and whether
it travels through the portable archive or a user-chosen synced folder. Regardless of outcome:

- Author-created collections, goals and notes must not become an opaque database-only or
  host-profile-only source of truth.
- Every persistent record must be validated and versioned; unknown future versions and corrupt
  records must not be silently overwritten with defaults.
- A failed write must leave the previous complete record intact. The interface reports whether an
  action committed, conflicted or failed; cancel has no side effect.
- Recent-work failure is non-blocking but must not be described as a successful update.
- No annotation operation edits chapter text. No goal or collection action bypasses existing trash,
  save, version or hash checks.

## Cross-spec boundaries

- **002** owns the library listing/search/count/trash contract, editor save state and first-run
  journey. This spec adds adjacent controls only.
- **010** owns the shared storage port and browser folder/origin storage behavior. This spec consumes
  those capabilities and does not create a browser-specific source of truth.
- **014** owns responsive layouts, the mobile shell and touch/accessibility criteria. This spec
  validates its added controls within those surfaces.
- **D-002 / D-009 / D-112** and `docs/FORMAT.md` are the public file-format, shared-storage and
  portable-archive boundaries. Any new format or archive inclusion rule must go through the public
  decision process; this plan does not presume archive or cross-device behavior for the new records.

## Verification plan

- Use an in-memory library port and temporary synthetic libraries with deliberately named test
  books and chapters. Assert manuscript bytes and stable identities before and after every metadata
  operation.
- Inject failed atomic writes, stale base hashes, concurrent metadata changes, missing/corrupt
  files and unsupported future schemas. Verify that the prior record and all manuscript files remain
  intact and that the UI offers a safe retry or recovery action.
- Test goals with clean saved text, dirty editor drafts, pending writes, save failure, conflicts and
  incomplete chapter reads. Assert that only verified saved text contributes to saved progress.
- Test anchors with unchanged text, edited/moved/repeated text, missing chapters, renames/reorders,
  Unicode and line-ending cases. Assert that stale records never select a guessed passage.
- Add shared UI journeys with synthetic data. Check the library and workspace at spec 014's
  393 × 852, 744 × 1133 and 1440 × 900 reference viewports, plus keyboard/focus and 44 × 44 touch
  target behavior where applicable. These are layout checks, not device acceptance claims.
- Do not use real author profiles or manuscripts, live providers, paid services or devices.

## Risks

| Risk | Mitigation |
| --- | --- |
| A new record file is damaged or written by a newer app | Version and validate before write; refuse unsafe replacement; preserve the previous bytes and show a recovery action. |
| Concurrent changes overwrite collection, goal or annotation data | Resolve the checked-write contract first; compare the accepted base version/hash and surface a conflict rather than using last-writer-wins. |
| A passage moved or repeated and an anchor silently selects another occurrence | Require source verification and make stale state explicit; do not auto-relocate; use synthetic ambiguity tests. |
| Draft words appear as saved goal progress | Keep the shared saved count authoritative and label draft estimates separately; cover pending/conflict/failure states. |
| New controls crowd mobile navigation or hide existing library actions | Reuse spec 014 patterns and verify its reference viewports; do not add a parallel mobile shell. |
| Local metadata is unexpectedly included in an archive or synced folder | Do not implement persistence until OD-033-01 settles per-type scope and the public format/archive consequences. |

## Out of scope

- Revising spec 002's library, search, word-count or trash semantics.
- Cross-run local reports, saved count histories, trends, comparisons or retention controls.
- Any hosted sync/service, account, generated writing, agent action or direct chapter replacement.
- New onboarding, mobile platform, storage adapter or responsive design ownership.
