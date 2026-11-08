# Tasks: Story Bible extensions

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. D-163–D-165 and ADR 0017 are accepted; the first checked-sidecar implementation
may proceed. All implementation tasks remain unchecked until their actual evidence exists.

### W08 first core slice — November 7, 2026

The isolated core slice now supplies `packages/core/src/planning/{schema,checked-sidecar,service}.ts`:
bounded loose schemas for all four planning shapes; worldbuilding create/read/edit/current-no-op;
exact raw baseline plus strict typed draft; host-assigned IDs; owner equality; single-attempt checked
publication; full verified conflict copies; and explicit uncertain outcomes. Detailed planning/goal
schemas were added to FORMAT before the writer. Tests live in `packages/core/tests/planning/`.

This is partial T002/T003/T009/T011 evidence, not completion of the spec or its author-facing tasks.
The parent still must connect the leaf to LibraryService's existing per-book queue and journal-aware
commit boundary, add exports/API/IPC and view-bound draft handling, and schedule integrated adapter
acceptance. T004 archive/restore and timeline/notes/beat mutation remain subsequent slices; their
schemas preserve retained records now. The implementation does not change global writers or expose
a renderer write path. Preserve the unchecked task states until those complete journeys are verified.

## Phase 1 — Resolve public format and save decisions

### Corrected core/editor candidate — November 7, 2026

The combined W08 follow-up refuses lossy numeric tokens before either active or recovery writes,
and preserves supported numeric-looking strings/unknown values. The isolated editor now contains
state/result/close callback exceptions without losing the draft or relabelling checked results;
Keep editing focuses only after the fieldset is enabled. Planning/goal focused checks pass **166
tests**, all workspace and strict new-core-test typechecks pass, and focused lint is clean. The
retained native Chromium reproduction passes **14/14 assertions**, including all four reviewed
failures. Independent review ACCEPTED exact `320defb`, including 16 additional core probes and seven
adjacent native scenarios. Library/API/workspace integration remains; no broad task is completed by
leaf evidence. RF-01/RF-02 in `docs/RETAINED-DELIVERY.md` retain the original Bible/series follow-ons.

- [x] T001 Compare ordinary-file storage alternatives and decide the versioning, backward-compatibility,
  unknown-field and archive behavior for the optional typed planning extension. Separately decide the
  planning revision boundary, source snapshot, stale-draft/conflict representation, adapter
  conformance, identity rules and field limits. Keep the existing shared-port expected-hash commit
  contract. Record accepted outcomes in
  `docs/DECISIONS.md` and an ADR if warranted. Use only synthetic fixture libraries for evidence.
  Accepted November 7 as D-163–D-165 and ADR 0017 after rechecking current D-190 premises:
  independent `planning.json`, exact absent/hash plus revision, no-merge checked saves, complete
  verified conflict copies, explicit bounds/identity. The November 3 research remains historical;
  acceptance unblocks T002–T008 without claiming them implemented.

## Phase 2 — Define and persist the typed records

- [ ] T002 After T001, define schemas for worldbuilding records, timeline events, the optional
  story-notes group and outline beats. Enforce stable kind-specific identities, revisions, uniqueness,
  accepted field limits and reversible archive state. Cover valid, invalid, duplicate, foreign and
  unsupported-future fixtures.
- [ ] T003 After T001, add a dedicated planning snapshot and checked-save path through the shared
  library/storage boundary. Verify book ownership and the accepted source expectation at commit;
  preserve unknown supported fields, unrelated Story Bible fields and other records. Refuse stale,
  unsupported or unavailable writes without an unchecked fallback.
- [ ] T004 Add checked archive/restore operations for worldbuilding records, timeline events and beats.
  Preserve their identities and content, require confirmation before archive, and enforce the retained
  count including archived records. Use synthetic temporary libraries.

## Phase 3 — Expose book-scoped manual editing

- [ ] T005 Add strict read/save/archive/restore API and IPC contracts for the new records. Validate the
  current `bookId`, kind, identity, expected revision/snapshot and payload bounds. Bind responses to
  the initiating book and view; reject late or foreign results.
- [ ] T006 Add the author-facing worldbuilding and timeline editors. Show the current book scope,
  empty states, typed fields, literal timeline labels, author-controlled order, explicit save,
  archive/restore confirmation and saved/failure states. Do not change chapters or existing outline
  fields.
- [ ] T007 Add optional story notes and typed outline beats alongside, not in place of, the existing
  description and free-text outline. Provide explicit author ordering for beats and preserve existing
  fields byte-for-byte when they are not edited.
- [ ] T008 Add dirty-draft, save-in-progress, stale, cancel/close, book-switch and adapter-unavailable
  behavior. Keep the exact draft on error; offer Keep editing or a separately confirmed Discard or
  Reload. Never auto-merge, rebase, reload or retry, and never display success before a checked commit.

## Phase 4 — Synthetic verification and format documentation

- [ ] T009 After T002–T004, add synthetic storage/service tests for create, edit, no-op, stable
  identity/revision, archive/restore, save/reopen, unknown-field preservation, old books, unsupported future data,
  duplicate/foreign identities, stale competing saves, injected read/write/permission failures and
  adapter unavailability. Assert chapter bytes, existing Story Bible fields and other-book bytes are
  unchanged where not targeted.
- [ ] T010 After T005–T008, add renderer and hidden integration coverage using an isolated synthetic
  book for the author-visible journey: create records, save/reopen, reorder beats, archive/restore, cancel a dirty
  form, encounter a stale save and keep the draft. Assert that no provider, training, credential or
  agent-write operation occurs.
- [ ] T011 After T001 and the chosen format implementation, update `docs/FORMAT.md` to match the
  accepted file and compatibility contract, link the accepted public decision/ADR, and update the
  implementation changelog when implementation is delivered. Do not mark this spec complete until
  its implementation and acceptance evidence exist.
