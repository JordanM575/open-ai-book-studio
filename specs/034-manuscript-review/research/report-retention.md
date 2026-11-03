# Research: report save, export, retention and deletion (D-171)

**Task:** 034 T003 · **Status:** research recorded, decision not accepted — nothing persists here.
**Evidence:** `packages/core/tests/review/report-persistence-premises.test.ts` (3 pass, synthetic
results); `packages/core/src/review/index.ts` (result contracts);
`apps/desktop/tests/review-report.test.tsx` (volatile run with no manuscript writes, discard on
book switch); `packages/core/src/library/paths.ts` (per-book derived layout). No live provider,
paid service or author manuscript was used. FR-011 and spec §180–182 require this decision
before any persistence task.

## Current shape (observed)

- A `ReviewReportResult` is a plain run-local object: scope, timestamps, source references
  (chapter id/version/hash, no bodies), word counts, coverage, metric definitions and findings
  with evidence spans (offsets + excerpt strings). Nothing in the result writes anywhere; the
  first milestone keeps it in workspace state only — a new run replaces it, a book switch or
  restart discards it, and the integration test records save calls to prove none happen.
- Findings carry the exact saved span plus a verbatim excerpt. Today the milestone ships no
  phrase findings (T001 deferred the scanner), so excerpts in the wild are coverage-level, not
  finding-level — but the type already allows finding excerpts of any length.
- The serialized report contains excerpts but never chapter bodies (premise test). An export
  would therefore leak quotations, not manuscripts — bounded by whatever cap the decision sets.
- The core places no length bound on excerpts: a multi-thousand-character excerpt round-trips
  today (premise test). Any export cap must come from the decision, not the type.
- Freshness is computed, never stored: the result carries no freshness or staleness field, only
  version+hash references for export-time revalidation (premise test). A saved or exported report
  cannot speak for the current source on its own — it must carry its captured-at identity and a
  stale-until-revalidated marking.

## Whether reports may be saved or exported (proposal)

Allow both, narrowly:

- **Copy/export** a human-readable summary (scope, timestamps, counts, coverage, findings with
  excerpts) to the clipboard and to a single Markdown file at an author-chosen destination
  through the existing safe-publication pattern (cancel, alias refusal, replacement consent,
  recheck, staged write — 035 T005). Export carries exactly the displayed spans, capped per
  excerpt (proposal: 500 characters, cut with an ellipsis marker), plus the captured-at
  timestamp and a plain line stating the source may have changed since.
- **Save** a report as JSON beside the book for re-opening in the studio: additive per-book
  derived file under `books/<bookId>/reviews/<runId>.json`, following the existing per-book
  derived layout (conflicts, threads, checkpoints). No library format field is added (T004
  forbids it); no report, excerpt or retention metadata goes to the profile, index, threads,
  usage storage or sync baselines — FR-011's exclusion list extends to saved reports.
- What is NOT allowed: saving into chapter files or `book.json`, syncing saved reports as
  library content, retaining reports in provider/usage/telemetry-adjacent storage, or
  exporting full chapter bodies under the guise of evidence.

## Retention and deletion (proposal)

- Saved reports are derived and disposable: the studio never needs them to open the book.
  Keep at most 20 per book, oldest-first eviction on save, visible count in the report view.
- Deletion is explicit per report (a Delete action removing the file) plus eviction; deleting
  or trashing the book removes its reviews with it (same directory, same fate — no orphan
  index to maintain).
- No retention metadata is stored outside the reviews directory: no registry, no timestamps
  in `book.json`, no usage log. The directory listing is the inventory.
- Saved reports are excluded from the portable archive and from sync content until 016 says
  otherwise (flagged follow-up, not decided here).

## Alternatives considered

- Keep reports volatile-only forever (rejected): authors re-run to compare drafts across days;
  volatility-only makes every comparison manual re-reading. The milestone stays volatile; this
  decision only opens the narrow save/export above.
- Save into threads/ or usage storage (rejected): threads are agent-owned, usage is provider
  metadata — reports belong to neither, and FR-011 already excludes both.
- Unbounded excerpts in export (rejected): the type allows any length today, so the decision
  must set the cap or exports leak arbitrary quotations. 500 characters keeps a finding
  readable while staying a quotation, not a chapter.
- Syncing saved reports (rejected for now): cross-device report identity and conflict
  behavior belong to 016, which has not decided them.

## Recommendation

Allow clipboard/Markdown export with 500-character capped excerpts plus captured-at and
may-have-changed markings, and JSON save under `books/<bookId>/reviews/` with a 20-per-book
cap, explicit delete, book-fate deletion, archive/sync exclusion and no external metadata.
Saved reports revalidate version+hash on open and show stale rather than current when the
source moved.

## What this unblocks when accepted

A persistence/export implementation task (save action, export action, reviews directory
handling, open-with-revalidation, delete/eviction) plus any required format/ADR review if
the outcome changes the public architecture, per the T003 dependency note. No such task may
begin before acceptance.
