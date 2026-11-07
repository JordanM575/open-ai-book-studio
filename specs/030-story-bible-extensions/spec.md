# Feature Specification: Story Bible extensions

**Feature Branch**: `030-story-bible-extensions`  
**Status**: Draft (Planned)  
**Number**: 030  
**Depends on**: [002 — AI Book Studio v1](../002-studio-v1/spec.md) for the existing Story Bible; [010 — Browser target](../010-web-target/spec.md) and ADR 0009 for the shared library/storage architecture.

## Why

The public Story Bible already lets an author return to the book's idea, free-text outline, story arc,
characters and saved memories. It does not yet offer typed, individually identifiable records for
worldbuilding or timeline entries, nor optional story notes and outline beats.

This extension adds those manual planning materials without replacing the existing fields, changing
chapter order, or creating a series-wide planning surface. Every new record belongs to the book the
author has open and is saved through a checked write. D-163–D-165 and
[ADR 0017](../../docs/adr/0017-planning-and-organization.md) accepted its storage, revision and bounds
contracts on November 7. Implementation and acceptance remain outstanding.

## Current public behavior and proposed behavior

### Present today

- Spec 002 and `docs/FORMAT.md` describe book-level idea/description, free-text outline, story arc,
  cast and memories in the book's `book.json`.
- The public Story Bible editor can change those fields. The existing agent's `read_story_bible`
  tool reads the fields it currently supports.
- Chapter saves carry a base version and hash. D-190 now gives the Story Bible field-level checked
  merges; planning deliberately uses the separate all-or-stale policy below rather than that merge policy.
- No typed worldbuilding list, timeline list, story-notes group or outline-beat list is part of the
  public format today.

### Proposed by this spec

- Add author-entered worldbuilding and timeline records, optional story notes, and optional typed
  outline beats, each with stable identity and a revision.
- Save only after an explicit author action, using an agreed checked-save contract. A stale or failed
  save must preserve both the on-disk value and the author's exact draft, explain the state, and offer
  an explicit next step.
- Keep all these records scoped to one book. The screen names the current book; a save cannot change
  another book or a series.
- Leave the existing description, free-text outline, story arc, cast and memories intact and
  separate. This spec does not redefine their current UI or save path.

## User stories and acceptance scenarios

### Story 1 — Keep world details and story time in the book (P1)

An author adds a place, custom or other world detail, and records events in the story's timeline.
They can edit these typed records later without searching through a prose note or changing chapter
files.

**Acceptance scenarios**

1. **Given** a book with no worldbuilding records, **when** the author opens the extension, **then** an
   empty state explains how to add one and makes no file change merely by opening the view.
2. **Given** a worldbuilding record, **when** the author saves its name, category, description or
   notes, **then** it retains its identity, advances its revision for a real change, and appears with
   the saved values after the book is reopened.
3. **Given** a timeline event, **when** the author enters a `when` label such as “the winter after the
   siege”, **then** the label is kept literally and the author controls the event's order; the studio
   does not parse it as a calendar date or reorder it automatically.
4. **Given** one book is open, **when** the author edits or archives a record, **then** the interface
   identifies the current book as its scope and no other book changes.

### Story 2 — Add optional notes and beats without replacing the outline (P1)

An author keeps optional working notes, style notes and a synopsis beside the existing Story Bible,
and may break out typed outline beats when useful. Their existing free-text outline remains available
and is not silently migrated, replaced or synchronized with the beat list.

**Acceptance scenarios**

1. **Given** a book with no story notes or beats, **when** the author opens the view, **then** both
   sections are optional and the author can save the existing Story Bible without creating either.
2. **Given** the author changes a story-notes field, **when** the author saves, **then** that notes
   record retains its identity and its revision changes only if saved content changed.
3. **Given** the author adds or reorders beats, **when** the author saves, **then** beat order is
   author-controlled planning order, independent of chapter order; no chapter is created, edited or
   moved.
4. **Given** a book already has a free-text outline, **when** the author edits beats, **then** the
   free-text outline remains unchanged.

### Story 3 — Save planning changes without losing either side (P1)

An author makes a draft, explicitly saves it, and can tell whether the checked save succeeded. If the
source changed or the write fails, neither the newer saved data nor the author's draft disappears.

**Acceptance scenarios**

1. **Given** a dirty form, **when** the author chooses Cancel or Close, **then** the app asks whether
   to keep editing or discard the draft; keeping it leaves the exact draft in the form, while
   confirmed discard makes no planning write.
2. **Given** a save is in progress, **when** the author waits for its result, **then** the controls
   show that state, prevent a second write, and do not claim success before the checked commit
   returns. If the window closes before the result arrives, reopening reads the actual saved source;
   the app does not replay the draft or claim that the pending save was canceled.
3. **Given** another writer changed the saved planning source since this form was read, **when** the
   author saves, **then** the newer source remains intact, the current draft remains available, and
   the UI shows both versions with explicit reload/discard or keep-editing choices. It never silently
   merges, reloads, rebases or retries the draft.
4. **Given** validation, permission, storage or write failure, **when** the save is refused, **then**
   the form retains the exact draft, reports that it was not saved and offers a safe next action.
5. **Given** a book is switched or the view is closed while a read or save is pending, **when** a late
   result arrives, **then** it cannot be shown as the saved state of another book or a closed view.

## Requirements

These requirements add to, and do not repeat, spec 002's existing Story Bible requirements.

- **FR-001**: The author MUST be able to create, edit, and review typed worldbuilding records with a
  name, category, description and notes, and typed timeline events with a title, literal `when`
  label, description and notes.
- **FR-002**: The author MUST be able to keep optional story notes with separate working/idea notes,
  style notes and synopsis fields, and optional typed outline beats with a title, summary, notes and
  explicit order. These additions MUST NOT replace the current description, free-text outline or
  story arc.
- **FR-003**: Every new record MUST have a stable identity and a revision. A saved edit to one record
  MUST NOT change the identity or revision of unrelated records. A no-op save MUST NOT advance a
  revision or rewrite the source.
- **FR-004**: Each record MUST belong to exactly one book. The editor and save request MUST identify
  that book, and MUST refuse a record identity that is missing, duplicated, foreign to that book or
  already bound to a different record kind. Series scope and cross-book mutation are not implied.
- **FR-005**: A save MUST be explicit and checked against the source revision the author read. It MUST
  use the accepted storage decision and the shared library/storage boundary; it MUST NOT use an
  unchecked whole-book update as a fallback.
- **FR-006**: If a checked save is stale, the newer saved data MUST remain untouched and both the
  saved version and the author's draft MUST remain recoverable and visible. The UI MUST provide an
  explicit choice to reload/discard the draft or continue editing. It MUST NOT silently choose a
  side, merge, rebase or retry.
- **FR-007**: Cancel, close, book switch, validation failure, permission denial, unsupported format
  and I/O failure MUST never be presented as a successful save. A dirty draft MUST remain intact
  until the author chooses to keep editing or confirms that it should be discarded. A confirmed
  discard MUST write nothing. While a save is pending, the UI MUST prevent duplicate submission and
  must not claim cancellation if the request may already have committed; reopening MUST read the
  saved source rather than replaying a pending draft.
- **FR-008**: Removing a saved worldbuilding record, timeline event or beat MUST be reversible: the
  author confirms an archive action, the record remains recoverable with its identity, and the
  author can restore it. Archiving MUST NOT physically delete the record or its text.
- **FR-009**: An older book without the extension MUST open with empty optional sections and MUST NOT
  be rewritten just by opening or reading it. Unknown fields outside the extension MUST be retained
  by a supported save. Unknown fields inside a supported extension MUST also survive edits to known
  fields; unsupported future extension data MUST be refused rather than replaced with empty data.
- **FR-010**: Timeline labels and beat order MUST remain author-controlled. The studio MUST NOT infer
  calendar dates, automatically sort timeline events, or write beat order into chapter order or
  chapter metadata.
- **FR-011**: These records MUST be entered and changed manually in this scope. This feature MUST NOT
  generate proposals, call a provider, alter training consent, mutate series data, add typed agent
  write tools, or add these fields to an agent request automatically.
- **FR-012**: The feature MUST use the current shared-core and storage-port architecture. The renderer
  MUST NOT write files directly. An adapter that cannot honor the accepted checked-save contract
  MUST report that the operation is unavailable; it MUST NOT fall back to an unchecked write.

### Accepted bounds

These limits were accepted in D-165; field/count/aggregate limits apply together:

- Up to 200 retained records per kind, including archived records.
- Titles, names, categories and `when` labels: at most 200 UTF-16 code units each.
- Descriptions, notes, story-notes fields, beat summaries: at most 20,000 UTF-16 code units each.
- One optional story-notes singleton; the 200-record limit applies to each list kind.
- Exact serialized sidecar: at most 2,500,000 UTF-8 bytes including unknown fields and formatting.
- Immutable host-generated kind-specific IDs and safe-integer revisions follow ADR 0017.

An over-limit value is rejected before writing. The field remains editable, its limit is identified,
and no partial record is saved.

## Non-goals

- Replacing or migrating existing description, free-text outline, story arc, cast or memories.
- Series membership, shared records, or edits that affect more than the open book.
- Generated text, generated proposals, training, provider calls or new agent context/tool behavior.
- Writing chapter prose, chapter metadata or chapter order from planning records or beats.
- New search, export, import, review, sync or collaboration journeys.
- Changing the checked-save behavior of existing book-level Story Bible fields in this extension.

## Accepted decisions and remaining implementation

The former questions are resolved by D-163–D-165 under delegated authority on November 7:

1. **D-163:** optional independently versioned `planning.json` per book, lazy creation, explicit
   ownership, nested unknown-field preservation, archive/whole-book trash travel and invalid/future refusal.
2. **D-164:** exact absent-or-raw-hash token plus file revision, one checked commit attempt, no
   implicit merge/rebase/retry, complete verified conflict copies and view-bound results. A stale
   same-content request is still stale; only a current semantic no-op writes nothing.
3. **D-165:** bounds above and narrow kind IDs; no automatic deletion/truncation to fit. Publish the
   detailed file schema in FORMAT before its first writer and prove the boundary with synthetic tests.

These decisions unblock implementation; they do not mark the schemas, service, UI or tests complete.

## Success criteria

- A synthetic isolated library can create, edit, archive, restore and reopen each new record kind;
  saved identities remain stable, real edits advance only the relevant revision, and no-op saves
  make no write.
- A synthetic stale-write and injected-failure suite proves the newer source and exact local draft
  both survive, with no false “Saved” state and no automatic merge or retry.
- Opening a legacy-shaped synthetic book adds no files or fields; editing one supported extension
  field preserves unrelated and unknown supported data, all existing Story Bible fields, chapter
  bytes and other-book bytes.
- A fixture with an unsupported future extension is not rewritten or treated as empty.
- Timeline labels and beat order round-trip literally and do not modify chapter order or metadata.
- Feature journeys make no provider call, training-consent change or agent write-tool call.
