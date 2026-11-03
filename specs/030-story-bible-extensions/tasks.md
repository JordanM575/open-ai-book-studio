# Tasks: Story Bible extensions

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. Every implementation task remains blocked until the decisions it depends on are
accepted in the public decision process. A blocked decision blocks only its dependent tasks.

## Phase 1 — Resolve public format and save decisions

- [ ] T001 Compare ordinary-file storage alternatives and decide the versioning, backward-compatibility,
  unknown-field and archive behavior for the optional typed planning extension. Separately decide the
  planning revision boundary, source snapshot, stale-draft/conflict representation, adapter
  conformance, identity rules and field limits. Keep the existing shared-port expected-hash commit
  contract. Record accepted outcomes in
  `docs/DECISIONS.md` and an ADR if warranted. **T002–T008 are blocked until the relevant decisions
  are accepted.** Use only synthetic fixture libraries for evidence.
  Research recorded 2026-11-03 (not accepted): `research/storage-alternatives.md` compares the
  `book.json` extension against a separate versioned `planning.json` with synthetic evidence;
  D-163 proposes the separate file, D-164/D-165 stay Open. T002–T008 remain blocked.

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
