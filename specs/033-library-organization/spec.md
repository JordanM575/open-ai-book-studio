# Feature Specification: Library organization, goals and source-anchored notes

**Feature Branch**: `033-library-organization`

**Status**: Draft / Planned

**Input**: Add author-managed local collections and recent work, saved-word goals, and
source-anchored bookmarks and notes without changing the existing library or manuscript safety
contracts.

## Overview

An author can group books without moving their files, return to recently opened work, set a word
target for a book, and leave a bookmark or note tied to a passage in saved chapter text. These are
small, local-first aids around the existing library and editor. They do not generate prose, judge
writing quality, or create another way to write a chapter.

### Public baseline and proposed change

The public product specs already describe a library listing with each book's title, description,
chapter count, word count and stage; the existing update ordering and search behavior; a shared word
counter; and confirmed, recoverable book and chapter trash (002 FR-003, FR-006, FR-009, FR-016;
001 FR-003, FR-012). Spec 014 owns responsive layouts, navigation and touch behavior. Spec 010 owns
browser storage tiers and the shared library adapter boundary. This feature preserves those contracts:
collections are not a replacement for the library list or search, goals use the existing saved-word
count, and trash and restore continue through the existing path.

The public specs do not yet define user-created collections, a recent-open surface, saved-word goals,
or source-anchored bookmarks and notes. This spec proposes those additions. It does not claim that
they exist in the current build.

## User Scenarios & Testing

### User Story 1 — Organize books without moving them (Priority: P1)

An author creates a named collection, adds books to it, and later removes a book or renames the
collection. The library remains the place where every valid book is listed and searched. Organizing a
book never renames, relocates, rewrites or duplicates its manuscript files.

**Independent Test**: Use a synthetic library with multiple books. Create and rename a collection,
add and remove books, cancel an edit, and compare every book file and identity before and after.

**Acceptance Scenarios**:

1. **Given** a library with no collections, **When** the author opens the organization surface,
   **Then** it explains the empty state and offers to create a collection without hiding any book.
2. **Given** an author creates or renames a collection, **When** the operation is saved,
   **Then** the new name and membership are shown after reopening the library.
3. **Given** an author adds or removes a book from a collection, **When** the change is saved,
   **Then** the collection changes and the book's path, chapter bytes and stable book identity do not.
4. **Given** an author cancels a create, rename, membership change or collection removal,
   **When** the dialog closes, **Then** the last saved collection state remains unchanged.
5. **Given** an author removes a collection, **When** they confirm, **Then** only the collection is
   removed; no book is trashed. Cancel leaves the collection intact.
6. **Given** a book is moved to the existing recoverable trash, **When** the library is listed,
   **Then** it is not offered as an active collection destination. Restoring the same book identity
   restores its valid collection references; a different book with the same title is never substituted.

### User Story 2 — Continue recently opened work (Priority: P1)

An author sees a concise “Continue writing” list in the library and can reopen a recently opened
book. The list is a navigation aid, not an activity report. It contains no manuscript text, draft
snapshots, session comparisons, or writing-quality judgments.

**Independent Test**: Open several synthetic books, close and reopen the application context, and
confirm the list is newest-first, contains each book at most once, and opens only the matching book
identity.

**Acceptance Scenarios**:

1. **Given** an author explicitly opens a book successfully, **When** they return to the library,
   **Then** that book appears first in recent work and any older entry for that same book is replaced.
2. **Given** a book is missing, damaged, in trash, or has an identity mismatch, **When** recent work
   is displayed, **Then** the studio does not open a different book based on a matching title or path;
   it explains that the entry is unavailable and offers to dismiss the pointer.
3. **Given** recording recent work fails, **When** the author opens a valid book, **Then** opening and
   writing remain available, and the studio does not claim that the book was added to recent work.
4. **Given** the author dismisses a recent entry, **When** they confirm, **Then** only that navigation
   pointer is removed; the book and its files remain unchanged.

### User Story 3 — Set a goal against saved words (Priority: P1)

An author sets an optional total-word target for a book and sees the current saved count and the
remaining words, using the same counter as the existing library and editor. When the editor has
unsaved typing, a separately labelled draft estimate may be shown, but it never masquerades as saved
progress.

**Independent Test**: Set a goal for a synthetic book, save a chapter, make an unsaved edit, and
exercise a conflict and a failed write. Check that the goal uses only confirmed saved text and that
the draft is labelled separately.

**Acceptance Scenarios**:

1. **Given** a book has no goal, **When** the author sets a positive whole-book word target and
   saves it, **Then** the goal and current saved count are visible in the library and workspace.
2. **Given** the saved manuscript is below, at, or above the target, **When** progress is shown,
   **Then** the interface shows saved words against the target and remaining words (zero once met),
   without a score or quality claim.
3. **Given** the editor has unsaved changes, **When** the author views progress, **Then** saved
   progress remains tied to the last confirmed saved text and any estimate from the draft is labelled
   “Draft” or “Not saved”.
4. **Given** a save is pending, failed, or in conflict, **When** counts are refreshed, **Then** the
   studio does not count the draft as saved; if it cannot verify a complete saved count, it labels
   progress unavailable or incomplete rather than reporting a false total.
5. **Given** saving or clearing a goal fails, **When** the error is shown, **Then** the last valid
   goal remains intact and the author can retry. Cancel leaves the existing goal unchanged.

### User Story 4 — Keep bookmarks and notes attached to their source (Priority: P1)

An author bookmarks a passage in saved chapter text and optionally adds an author note or label.
They can inspect, edit, open, re-anchor or remove the record. The record is separate from the
manuscript. If its source changes, the studio says so and never jumps to unrelated prose.

**Independent Test**: Create a bookmark and note against a synthetic saved passage, reopen it, then
edit, move, duplicate and remove the source passage. Confirm that only a verified anchor opens and
that stale notes remain visible until the author changes or removes them.

**Acceptance Scenarios**:

1. **Given** the author selects text in a saved chapter, **When** they save a bookmark or note,
   **Then** it appears in an inspectable list with its chapter and saved-source excerpt; chapter
   prose and chapter version are unchanged by the annotation write.
2. **Given** the selected chapter has unsaved text, a pending save, or an unresolved conflict,
   **When** the author tries to create or re-anchor a passage record, **Then** the studio explains
   that a saved source is required and does not create an anchor to the draft.
3. **Given** the saved source still verifies, **When** the author opens a bookmark, **Then** the
   correct chapter and passage are selected.
4. **Given** the saved source no longer verifies, the chapter is missing, or its identity changed,
   **When** the author opens the record, **Then** the note remains visible as stale, the studio
   shows its saved excerpt, and no approximate or unrelated passage is selected.
5. **Given** an anchor is stale, **When** the author selects a passage in the current saved chapter
   and explicitly confirms re-anchoring, **Then** only the annotation's source reference changes;
   its note text is preserved. Cancel leaves the old stale anchor unchanged.
6. **Given** the author removes a bookmark or note, **When** they confirm, **Then** only the
   annotation record is removed. Cancel preserves it; neither action changes chapter text.

## Requirements

### Preserve the public library contract

- **FR-001**: The studio MUST retain the library listing, existing search scope and behavior,
  chapter and word counts, update ordering, and recoverable trash behavior defined by specs 001 and
  002. Collections MUST NOT replace or silently filter the canonical library listing or search.
- **FR-002**: Organizing, annotating, setting a goal, opening recent work, or dismissing a recent
  pointer MUST NOT move or directly replace a chapter, alter manuscript prose, or bypass the existing
  checked save and trash paths.

### Collections and recent work

- **FR-003**: The author MUST be able to create, rename and remove named local collections and add or
  remove books from them. Collection actions MUST refer to stable book identity, not title or path.
- **FR-004**: Removing a collection MUST NOT delete, move, rename or trash its books. Adding a book
  already present MUST be idempotent. Cancelling any collection action MUST leave the last saved
  state intact.
- **FR-005**: Trashing and restoring books MUST continue to use spec 002's recoverable trash flow.
  An unavailable, trashed or mismatched book MUST NOT be substituted by another book with the same
  name. A restored book may reclaim references only when its stable identity matches.
- **FR-006**: The library MUST offer a recent-work list ordered by the author's successful,
  explicit book opens, with at most one current entry per stable book identity. Merely listing,
  indexing, onboarding, or reading a book for another operation MUST NOT count as an author opening it.
- **FR-007**: The recent-work list MUST contain navigation references only, not chapter prose,
  editor drafts, per-session word reports, quality scores or inferred writing activity. Dismissing
  an entry MUST remove only that reference.
- **FR-008**: Failure to read or write nonessential recent-work data MUST NOT block opening or saving
  a book. The studio MUST not report a failed recent-work update as successful.

### Saved-word goals

- **FR-009**: The author MUST be able to set, change and clear an optional positive whole-book word
  target. This spec defines a total manuscript target, not a daily, weekly or session quota.
- **FR-010**: Goal progress MUST use the shared word counter and the latest complete, verified saved
  manuscript state. It MUST show saved words and remaining words, with remaining words floored at
  zero; it MUST NOT infer quality or productivity.
- **FR-011**: If unsaved editor text differs from saved text, the interface MUST distinguish the
  saved count from any draft estimate. Pending, failed, conflicting, unreadable or incomplete source
  data MUST NOT be presented as a confirmed saved total.
- **FR-012**: A goal write, edit or clear MUST use the accepted checked-write policy. A failed or
  cancelled operation MUST leave the prior saved goal intact and explain the safe next action.

### Bookmarks and notes

- **FR-013**: The author MUST be able to create, inspect, edit, open, explicitly re-anchor and remove
  a bookmark with an optional label and note, anchored to a passage in a saved chapter. Annotation
  text MUST remain separate from manuscript prose.
- **FR-014**: A bookmark MUST identify its book and chapter by stable identity and retain enough
  source evidence to verify the saved passage before navigation. The exact serialized range is
  unresolved under OD-033-03.
- **FR-015**: A source-version or source-hash mismatch MUST make the bookmark visibly stale, even if
  similar text appears elsewhere. The bookmark MUST retain its saved excerpt and note and MUST NOT
  jump to a guessed or unrelated passage. Re-anchoring MUST be an explicit author action; changing
  the note alone MUST NOT silently repair an anchor.
- **FR-016**: Creating or re-anchoring MUST require a confirmed saved source, not an unsaved draft or
  an unresolved save conflict. A failed annotation write MUST preserve the previous record and the
  chapter file. Removing a record MUST never remove or edit chapter text.

### Storage, privacy and target integration

- **FR-017**: Before implementation, the public decision process MUST settle the authoritative
  storage location, scope, schema/versioning, limits, checked atomic-write behavior and portable
  archive/folder-sync treatment for each data type (OD-033-01). Collections, goals and annotations
  are author-created data and MUST remain represented in ordinary library files, not only in a
  hidden database or host profile. Recent-work pointers MAY be disposable. The library catalog
  MUST remain derived and disposable; it MUST NOT become the only copy of author-created data.
- **FR-018**: New persistent data MUST be validated and versioned. A corrupt, unreadable or
  unsupported-future-version record MUST NOT be silently replaced with an empty default on write.
  The interface MUST preserve the previous complete data and explain how to retry or recover.
- **FR-019**: The feature MUST use the existing local library/storage boundaries and MUST NOT add an
  account, cloud service, remote copy, telemetry, background network call, or provider request.
- **FR-020**: Onboarding remains owned by spec 002. The feature MUST not add a second onboarding
  flow or block the existing create/open/import path; any future mention in onboarding must lead to
  a working surface and start no operation implicitly.
- **FR-021**: Responsive layout, navigation, safe areas and mobile platform behavior remain owned
  by spec 014. Integration MUST use its existing patterns and reference viewports, preserve its
  keyboard and touch accessibility, and add no duplicate mobile shell.

## Edge Cases

- The library is read-only, full, unavailable, or loses permission during a metadata write.
- Two writers add or rename a collection, edit a goal, or change an annotation from the same base.
- A collection or recent pointer names a book that is trashed, missing, damaged, restored, or replaced
  by another book with the same title.
- A goal file is missing, malformed, corrupt, or written by a newer application version.
- An editor has a dirty draft while a chapter save is in flight, fails, or conflicts with an outside
  edit.
- A chapter is reordered, renamed, edited, deleted, restored, or contains duplicate or blank lines
  that resemble the bookmarked text.
- A bookmarked passage is moved, reworded, repeated elsewhere, or removed between opening and
  navigation.
- The annotations file is corrupt or has a newer schema; no operation may silently replace it.
- A browser storage adapter is unavailable or has weaker durability than the desktop adapter.
- A mobile viewport has a software keyboard, safe-area inset, rotation, or constrained dialog height.

## Key Entities

- **Collection**: author-named local grouping and references to book identities; cardinality and
  record identity are open under OD-033-02.
- **Recent entry**: a local navigation pointer to a book identity and its most recent successful
  explicit open; it is not an activity report.
- **Word goal**: one optional total word target for a book; progress is derived from saved manuscript
  text and the shared counter.
- **Bookmark and note**: author-authored label/note plus a reference to a saved passage. Its exact
  source-anchor representation is open under OD-033-03.
- **Saved source state**: the complete chapter content/version/hash confirmed by the existing library
  save protocol, as distinct from an editor draft.

## Open Decisions

These are local identifiers for unresolved questions in this draft, not accepted public decisions.
Each blocks only the dependent implementation tasks listed here.

### OD-033-01 — Storage, versioning and checked-write policy

- **Question**: For collections, recent entries, goals and annotations, which records are ordinary
  library files and which, if any, are disposable host-profile preferences? What are their scope,
  schema versions and limits? Which records travel in a portable archive or through a folder the
  author already syncs? How are concurrent or failed writes detected and recovered?
- **Needed**: A per-data-type storage matrix that keeps collections, goals and annotations in
  ordinary library files; decides whether recent-work pointers are library-scoped or disposable
  local preferences; follows the shared storage port; refuses unsupported future versions;
  preserves old bytes on failed writes; and states archive and chosen-folder sync behavior.
- **Blocks**: Persistent read/write tasks for all four data types (plan T004–T008). It does not
  block isolated interaction design or synthetic view-model work.

### OD-033-02 — Collection identity and membership

- **Question**: Can a book belong to one or multiple collections? Are collection names unique?
  Which stable collection identity survives rename, and how are references handled on trash/restore?
- **Needed**: A decision covering duplicate names, membership idempotence, collection rename/removal,
  and restore of the same versus a different book identity.
- **Blocks**: Collection persistence and CRUD behavior (plan T005), not goals, recents or
  annotations.

### OD-033-03 — Source-anchor representation and verification

- **Question**: How is a passage encoded against saved chapter text, and what exact evidence is
  sufficient to open it or mark it stale after edits, moves, duplicate text, line-ending changes,
  Unicode text, reorder, rename or restore?
- **Needed**: A documented anchor and verification rule, tested with synthetic changed, moved,
  repeated, missing and unchanged passages. The rule must never retarget an anchor by guess.
- **Blocks**: Annotation persistence, bookmark navigation and explicit re-anchoring (plan T008).
  It does not block editing a note while retaining its existing anchor.

## Success Criteria

- **SC-001**: Collection create, rename, add, remove, cancel and delete preserve every synthetic
  book/chapter path, stable identity and byte; collection removal deletes no book.
- **SC-002**: Recent work is newest-first and deduplicated in 100% of fixture runs; missing or
  mismatched entries never open a different book, and recent-data write failure never blocks a valid
  book open.
- **SC-003**: Goal progress matches the shared counter for confirmed saved text in 100% of fixtures;
  no pending, failed or conflicting draft is labelled saved.
- **SC-004**: A saved unchanged bookmark opens the matching source passage; every edited, missing,
  ambiguous or mismatched source is visibly stale and selects no unrelated text.
- **SC-005**: Injected metadata write failures leave the previous complete metadata and every
  manuscript byte intact; unsupported future schemas are refused before write.
- **SC-006**: Synthetic integration journeys retain the spec 002 listing/search/count/trash behavior
  and meet spec 014's no-overflow, touch-target and keyboard-accessibility criteria at its reference
  viewports.

## Assumptions

- “Local” means no studio account, hosted data or studio-operated sync. Any propagation through a
  user-chosen synced folder depends on OD-033-01 and the existing file-sync model; this spec makes no
  cross-device propagation promise.
- A goal is a total word target for one book, not a daily/session goal. Progress uses the current
  saved manuscript count, not a series of historical reports.
- Recent work is a resume aid based on explicit successful book opens. No per-session reports,
  cross-run report comparisons, saved count history, streaks, or retention controls are in scope.
- Existing book and chapter identities and the save protocol remain authoritative under the public
  format and spec 002. New record identities and source-anchor representation still require the
  decisions above.
- All tests use synthetic fixtures, in-memory adapters or temporary isolated libraries. No test
  requires a real manuscript, author profile, live provider, paid service or device.

## Non-Goals

- Replacing or redesigning spec 002's library listing, existing search, counts or trash/restore flow.
- Moving or reorganizing manuscript files as a side effect of collection actions.
- Daily/session word quotas, productivity scoring, historical word reports, cross-run local-report
  comparison, report retention or trend analysis.
- Cloud sync/service, accounts, sharing, telemetry or provider/network activity.
- Generated writing, agent-created annotations, content evaluation, or any direct/unchecked chapter
  replacement.
- A new onboarding journey, mobile shell, responsive layout system, storage adapter or search index.
- Automatically repairing, relocating or discarding stale bookmarks or notes.
