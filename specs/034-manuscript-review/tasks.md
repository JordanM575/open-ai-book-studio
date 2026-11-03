# Tasks: manuscript review

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks remain open unless checked below. Tests and UI journeys use synthetic text in isolated fixtures;
no real manuscript, credential, live provider, paid service or device is in scope.

## Phase 1 — Resolve only the decisions needed for the first milestone

- [x] T001 Review the proposed first metric set and repeated three-token phrase normalization using
  synthetic examples. Record the public outcome before implementing the phrase scanner or its UI
  wording. This decision blocks only the phrase scanner and its related report copy. Decided
  2026-11-03: word count and coverage only for the first report; the phrase signal is deferred, and a
  future signal unifies curly and straight apostrophes. Recorded in spec.md decision 1.
- [x] T002 Confirm the initial host surfaces and verify that each selected surface can provide saved
  chapter text plus version/hash revalidation through its existing storage boundary. This blocks only
  host-specific UI wiring; it does not block pure core contracts and tests. Decided 2026-11-03:
  desktop first through the shared app component; browser and mobile reuse it later after proving the
  same saved version/hash revalidation. Recorded in spec.md decision 2.
- [ ] T003 Record a follow-on decision on whether reports may be saved/exported and what retention,
  excerpt and deletion rules apply. This is not a prerequisite for the volatile first milestone; no
  persistence work is included here.
  Research recorded 2026-11-03 (not accepted): `research/report-retention.md` pins the report
  shape (references and excerpts, never bodies; unbounded excerpts; computed freshness) against
  the volatile baseline; D-171 proposes narrow export with capped excerpts and markings, JSON
  save under `books/<bookId>/reviews/` with a 20-per-book cap, explicit and book-fate deletion,
  and archive/sync exclusion. No persistence task may begin before acceptance.

## Phase 2 — Read a confirmed saved snapshot

- [x] T004 Define the core run request/result and source snapshot contracts: book scope, chapter
  identity/order/title, saved body, version/hash, run status, coverage, metric definitions and
  evidence span. Keep the result run-local and do not add a library format field.
- [x] T005 Add the smallest read-only book snapshot/revalidation operation through the current
  storage port and validated application boundary, only if existing APIs cannot provide it. Tests
  use a synthetic temporary library and assert chapter bytes, hashes, versions, checkpoints and
  other files are unchanged.
- [x] T006 Block a run while any in-scope chapter has unsaved edits. Offer the existing explicit save
  path or cancel; start only after confirmed saves. `EditorHandle.flush()` exposes saved, conflict and
  failed outcomes, and `runAfterReviewSave()` enforces the choice and refuses to run after an
  unconfirmed outcome. The workspace Review manuscript action is wired to live editor state: a dirty
  buffer opens the save gate dialog, the explicit save path flushes the editor and re-reads a fresh
  snapshot, and conflict, failure or cancel never starts the run. Tested successful save, conflict,
  failed save and cancellation with synthetic isolated fixtures.
- [x] T007 Reuse the existing shared word counter for per-chapter and book totals. Test empty text,
  whitespace-only text, punctuation tokens and the `one — two` example against the public count
  contract.

## Phase 3 — Deterministic findings and honest run states

- [ ] T008 Deferred by the recorded T001 outcome (word count and coverage only; no approved phrase
  metric for this milestone). When a future spec approves the signal — unifying curly and straight
  apostrophes — implement it in pure core with deterministic occurrence ordering and exact source
  spans, covering punctuation/case normalization, repeated phrases, overlapping phrases and
  chapter-boundary behavior with synthetic fixtures.
- [x] T009 Produce coverage for every in-scope chapter: included with prose, included but empty, or
  skipped with a safe author-visible reason. Distinguish partial coverage, insufficient evidence,
  source failure and a complete report with no phrase findings.
- [x] T010 Add cancellation and source-staleness checks. Cancellation discards partial output; changed
  source versions/hashes mark the report stale and prevent navigation to old evidence. Test both
  during a run and after report completion.

## Phase 4 — Author-facing report

- [x] T011 Add the explicit Review manuscript entry and report view for the host surfaces selected
  by T002. Show run time/scope, studio word counts, metric definitions, coverage and findings. Do not
  add chat, a quality score, model calls or write actions. Shipped on desktop first (header and mobile
  menu) through the shared app component the other hosts reuse; the report shows run scope/time,
  studio counts, coverage, the word-count definition and an honest empty-findings state. No chat,
  score, model call or write action is in the path. Covered by renderer and workspace integration
  tests plus a smoke start/results check.
- [x] T012 Add exact evidence navigation from a finding to the unchanged saved chapter span. Recheck
  the version/hash before navigation; if stale, explain why and offer a new run instead of selecting
  a different passage. The findings list navigates through `revalidateReviewEvidence` against a fresh
  snapshot, selects the exact span in the editor, and disables navigation while stale. Tested with
  synthetic findings; live findings arrive with the T008 scanner.
- [x] T013 Keep the report volatile: a new run replaces it; changing books and closing/restarting the
  app discards it. Verify no report, excerpt or retention metadata is written to library, profile,
  index, thread or usage storage. The report lives in workspace state only, is replaced on a new run
  and cleared on book change; the run path calls read-only `books.open`, and the integration test
  runs with no writer mock, so a manuscript write would fail the test instead of slipping through.
- [x] T014 Add visible run progress only where it reflects real work, a cancel control, and clear
  stopped, partial, stale, insufficient-evidence and failure copy with the next safe action. The run
  shows a reading state with Cancel run, and stopped, failed, partial, stale and insufficient-evidence
  states each name the next safe action. Covered by renderer tests.

## Phase 5 — Verification

- [x] T015 Add pure-core, storage-boundary and renderer tests for the acceptance scenarios, using
  synthetic isolated fixtures only. Assert no provider/network calls and no manuscript writes.
  Covered: save-gate choice/save/conflict/failure/cancel, word-count parity including the `one — two`
  example, coverage, stale blocking, insufficient evidence, disposable replacement, and an integration
  run with no writer mock (a manuscript write would fail the test). The repeatable-phrase scenario
  stays with the deferred T008 scanner. No provider or network call exists on the run path.
- [ ] T016 Add a synthetic-fixture smoke journey for start, results, evidence navigation, stale
  state, cancel and insufficient evidence on each selected host surface. Covered on desktop (29/29
  smoke): start, results, save-gate cancel (Keep writing), stale with Run again, an empty book
  reporting insufficient evidence instead of no findings, and cancelling a slow run mid-analysis
  so partial counts are discarded. Still open: evidence navigation (needs live findings from the
  deferred scanner). The analysis counts in whitespace-aligned slices and yields between 256KB
  budgets, so Cancel stays clickable on long books while small books analyze with no added
  latency; the smoke review checks wait for report content, not the dialog shell
  (`EditorHandle.getStatus()` also keeps a fast review click on the save choice).
- [x] T017 Review keyboard and screen-reader access for definitions, coverage, findings, status and
  cancellation; use the existing design tokens and honor reduced motion/transparency. Sections use
  labelled headings, actions are named native buttons, status and stale updates use live regions, the
  dialog traps focus via the shared dialog primitive, and no new motion was added. Covered by a
  renderer role/label test; no manual screen-reader pass was performed.

## Dependency notes

- T001 is recorded (word count and coverage only); T008 and any phrase-metric copy stay deferred.
- T002 is recorded (desktop first); browser and mobile reuse the shared component after proving the
  same saved version/hash revalidation, and T016 journeys for those surfaces wait on that.
- T003 does not block this milestone. Any later persistence/export task needs that decision first,
  plus format/ADR review if its outcome changes the public architecture.
- No model-backed task is included. A separate spec must settle provider disclosure, cost/unknown
  price, consent, data-use terms and no-write behavior before any such task is planned.
