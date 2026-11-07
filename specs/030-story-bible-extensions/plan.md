# Plan: Story Bible extensions

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Shape

Extend the existing public Story Bible rather than creating a parallel book model. Use the shared
`packages/core` schema and `LibraryService` above the existing storage port; keep all writes behind
the host's validated API and `Library`. The renderer edits a book-scoped draft and submits an explicit
save. It never accesses the filesystem. Preserve the current manuscript, chapter and Story Bible
journeys unless a requirement in `spec.md` calls out a specific extension.

The current Story Bible uses D-190's field-aware `books.edit`; `updateBook` also checks its fresh
read at commit but replaces requested whole fields, so omitted nested values may be removed.
Loose parsing and edits that carry unknown values preserve them; `updateBook` is not a nested patch API.
Planning instead uses D-164's dedicated
all-or-stale sidecar contract because FR-006 forbids an implicit merge or retry.

## Accepted decisions — implementation prerequisites

T001 is resolved by D-163–D-165 and [ADR 0017](../../docs/adr/0017-planning-and-organization.md),
accepted November 7. The original alternatives below remain the research record; the ADR supplies
the selected storage, revision, conflict, identity and bounds policy.

| Question | Alternatives/evidence to resolve | Blocks |
| --- | --- | --- |
| Where do optional planning records live, and how are they versioned? | Compare an optional `book.json` extension with a separate versioned ordinary file. Verify old-book reads, unknown-field preservation, archive round-trip, unsupported future data and human readability. | Format/schema/storage tasks |
| What planning revision and conflict representation apply? | Decide entity/collection revision semantics, which author-owned source snapshot is the baseline, and how to retain a stale draft for review. Keep the existing `LibraryPort` expected-SHA commit and common adapter contract; verify them with two synthetic writers and injected failures rather than selecting a weaker fallback. | Storage/API/UI tasks |
| Which bounds and identity rules are canonical? | Confirm the proposed text limits, retained-record caps, identity uniqueness/grammar and revision representation against validation, archive and user-visible error needs. | Schema/UI tasks |

The outcome belongs in the public decision record and, if the choice is hard to reverse, an ADR.
`docs/FORMAT.md` must be updated with the chosen file contract in the implementation that changes it.
No implementation task is complete merely because its policy is accepted.

## Proposed domain behavior

- Worldbuilding records and timeline events are separate typed kinds with stable identities and
  per-record revisions. Timeline `when` is a literal label and ordering is explicit author order.
- A singleton story-notes group holds optional working/idea notes, style notes and synopsis. Typed
  outline beats remain separate from the current free-text outline, with author-controlled order.
- Records are owned by the current book only. The UI displays that scope, and the API validates the
  book and record identity on every request.
- Archive and restore preserve content and identity. The retained-record limit includes archived
  records.
- Opening old books projects absent extension data as empty without migration writes. Supported
  edits preserve unknown supported fields; unsupported future extension data is never dropped.

The on-disk location is optional per-book `planning.json`; exact absent/hash baselines, file/record
revisions and verified complete conflict copies follow ADR 0017.
The existing shared-port checked-commit boundary and cross-target format/conflict requirements remain
in force.

## Checked save and interface contract

After the decisions are accepted, a planning read returns the current book scope, supported records
and the exact revision/snapshot token required by the chosen contract. Save validates the record
kind, identity, bounds, book ownership and expected source before committing through the shared
library boundary. A stale source refuses the write and preserves the draft; the UI presents the
saved and draft values and requires an author choice. No automatic rebase, merge, retry or fallback
to `books.update` is allowed. No-op saves do not rewrite data or advance revisions.

Use the existing dialog, button and token patterns in `packages/app`. Show empty, dirty, saving,
saved, stale, invalid, unavailable and failed states in author language. On cancel/close/book switch,
offer Keep editing or a separately confirmed Discard draft. Disable dismissal while a save is at its
commit boundary; only report “Saved” after a successful result. A late response must remain bound to
the book/view that initiated it.

An adapter that cannot satisfy the accepted contract returns a visible unavailable result. It must
not silently use a weaker write. The feature adds no provider/network activity, training behavior,
agent prompt context or typed agent write tools.

## Likely implementation areas

These are planning targets, not files changed by this spec-authoring task. The accepted storage
decision may change the exact file list.

- Focused planning modules in `packages/core/src/library/`: typed records, bounds, revisions and
  checked sidecar operations; do not broaden the legacy global ID schema.
- `packages/core/src/library/service.ts` and the shared storage port: snapshot/read, checked planning
  save, archive and restore; preserve unrelated and unknown supported data.
- `packages/core/src/ipc.ts`, `apps/desktop/src/main/ipc.ts` and the preload API: strict request
  validation, book scope and result states.
- `packages/app/src/components/StoryBibleDialog.tsx` or a focused planning component: manual lists,
  optional notes/beats, save/cancel/stale states and accessible author-order controls.
- Relevant synthetic tests under the core and desktop test suites; update `docs/FORMAT.md` and the
  public decision/ADR record when their outcomes are accepted.

Do not broaden this work into changing existing book metadata writers, agent tools, provider calls,
training consent, series mutation, or chapter-order code.

## Verification approach

Use temporary synthetic libraries and in-memory or temporary storage adapters. Test exact save and
failure behavior at the storage boundary, then the renderer-visible decisions and a hidden integration
journey using only synthetic books. Include old-format books, unknown fields, unsupported future
extension data, duplicate/foreign identities, two competing snapshots, no-op saves, cancellation,
book/view lifetime changes, archive/restore and adapter-unavailable behavior. Assert that chapter
bytes, existing Story Bible fields, other books, credentials and provider state are untouched. Do not
use real manuscripts, live providers, paid services or devices as fixtures or acceptance evidence.

Visual and keyboard checks use the project's existing synthetic component/smoke setup and design
tokens. No implementation or acceptance is claimed by this planned approach.
