# Plan: manuscript review

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Scope

This plan covers only the first milestone in [spec.md](spec.md): an explicit deterministic review of
confirmed saved chapter bodies, with shared word counts, the proposed repeated-phrase signal, visible
coverage, exact evidence navigation, and stale/cancel/insufficient-evidence states. It does not add
model calls or report persistence. All report state is disposable and in memory.

## Shape

1. **Read through the existing library boundary.** `LibraryService.readBook()` returns readable
   chapter bodies in reading order, with chapter identity, title/order, version and hash. Its
   `BookDetail` result also carries safe per-file read issues (library-relative file name, recovered
   order and a stable reason code) for chapters it cannot verify. Desktop `books.open` and the browser
   adapter already expose this shared read contract; a later re-read supplies current versions/hashes
   for stale checks. The renderer does not read files directly; the main process remains the only
   desktop filesystem writer.
2. **Block unsaved sources before the snapshot.** The workspace checks whether any chapter in scope
    has an unsaved buffer. The author must choose the normal save path and wait for a successful saved
    result, or cancel. `ManuscriptEditor.flush()` now returns its terminal `SaveStatus` so a caller can
    distinguish a confirmed save from a conflict or failure. The review action still needs to apply
    that result and block on every outcome except `saved`. An unavailable library or unverified source
    also prevents the run from claiming complete coverage.
3. **Analyze a stable snapshot in shared core.** A pure review module consumes the snapshot and
   returns metric definitions, counts, coverage, findings and evidence spans. It reuses the existing
   shared word counter. The repeated-phrase scanner remains gated on the open metric-set decision in
   the spec. It records source-relative spans as it scans; it does not rewrite or canonicalize
   manuscript text.
4. **Keep run state transient.** The result is held only for the active book/run in app memory. It is
   not sent to the library writer, thread store, usage log, index or app settings. Starting another
   run replaces the previous result; switching books and closing/restarting the app clears it.
5. **Revalidate before display and navigation.** Compare snapshot versions/hashes with current saved
   files when rendering the result and before opening an evidence location. If a source changed,
   preserve the old report as stale, explain which chapter changed, and suppress navigation to that
   chapter's old span until a new run completes.
   Core helpers compare saved-source identities and provide evidence only after a current-snapshot
   check. The async work wrapper accepts an `AbortSignal`, resolves immediately as cancelled, and never
   returns a partial value; host UI still has to own and apply these helpers.
6. **Render the report as a separate journey.** A workspace action opens a structured review view,
   not the agent conversation. The report presents the run status, counts, definitions, coverage,
   findings and exact excerpts. Clicking an unchanged excerpt opens the manuscript at the saved
   source span; it never applies edits.

## Public architecture boundaries

- Pure analysis and result contracts belong in `packages/core`, consistent with the shared core and
  storage-port architecture (ADR 0009 / D-009).
- UI belongs in the existing shared app surface; platform-specific storage/read access stays behind
  its adapter. The renderer receives only the validated result and uses existing app navigation to
  open a chapter.
- Any desktop IPC addition follows `AGENTS.md`: typed channel, Zod validation, main-process handler,
  preload exposure, and a read-only service call. Do not expose filesystem access to the renderer.
- Do not change `book.json`, chapter format, `docs/FORMAT.md`, the writing agent, the checkpoint
  store, provider registry, 025 metrics, or 028 health derivations for this milestone.

## Proposed module and surface areas

Exact filenames should follow the repository's current component/service ownership when work starts;
the likely seams are:

- `packages/core/src/review/` — pure input/result types, analyzer, tokenization and evidence spans.
- `packages/core/tests/review/` — deterministic unit tests using synthetic chapter snapshots.
- Existing library/storage-port read services — saved snapshot and current version/hash revalidation;
  add the smallest read-only batch operation only if existing reads cannot provide it.
- `packages/core/src/ipc.ts`, desktop IPC/preload and applicable web adapter surfaces — only the
  validated read-only invocation/revalidation needed by the UI.
- `packages/app/src/views/` and app hooks/components — explicit run, progress/cancel, result,
  definitions, coverage and stale states; navigation to an exact chapter span.
- Existing renderer tests — real visible states with synthetic isolated fixtures.

No new report files, database table, schema field, telemetry event, provider call or background job
is planned.

## Failure and safety behavior

- A failed or conflicted save prevents the analysis from starting; the existing save protocol remains
  responsible for preserving author text.
- A chapter read failure becomes an explicit skipped chapter when other sources can be verified. If
  no source can be verified, return a failure state, not an empty success.
- An empty or whitespace-only book returns insufficient evidence, distinct from a complete run with
  no repeated phrases.
- Cancellation discards partial results. It does not cancel or roll back a separate save the author
  already requested.
- A source hash/version mismatch makes the report stale. Never remap evidence by searching for a
  similar phrase in changed text.
- All fixtures use synthetic text in isolated temporary libraries. Do not use real manuscripts,
  credentials, live providers, paid services or devices as test inputs for this milestone.

## Decisions and sequencing

### Source-read inspection (2026-11-02)

The original `readBook()` result carried saved bodies, versions and hashes but omitted read/parse
failures. T005 adds `chapterReadIssues` to the existing `BookDetail` response and maps those stable
reason codes to safe review copy. `reviewSourceSnapshotFromBookDetail()` combines saved and skipped
sources without storing a second manuscript copy. A synthetic in-memory library test verifies chapter
bytes, hashes, versions, a checkpoint and all other files remain unchanged by the read; a separate
review test checks the source mapping. No new IPC channel or library-format field was needed.

### Cancellation and stale-source core (2026-11-02)

`runReviewWork()` races disposable analysis against an `AbortSignal`. It reports cancellation before
work starts or during work, discards the work value, and replaces thrown error details with safe
failure copy. `reviewReportFreshness()` compares the report's saved chapter versions/hashes and
coverage identities with a fresh source snapshot; `revalidateReviewEvidence()` returns an evidence
span only while that report is current. Synthetic tests cover cancellation before/during work and
post-completion evidence blocking after a source version/hash change. No renderer or storage wiring is
claimed by this slice.

### Explicit editor flush outcome (2026-11-02)

`EditorHandle.flush()` previously returned `void`, even when the normal save path reported a conflict
or failed. It now returns the resulting `SaveStatus`; synthetic renderer tests cover successful save,
conflict and failure outcomes while confirming the typed text remains in the editor. This is a
prerequisite primitive for 034 T006. `runAfterReviewSave()` in the shared app requires an explicit
save/cancel choice for a dirty buffer, starts analysis only after a confirmed `saved` flush result, and
returns blocked on conflict, error or still-saving outcomes. Synthetic tests cover the choice, save,
conflict, failure, cancellation and no-run branches. The workspace Review manuscript action now wires
the gate to live editor state: a dirty buffer opens `ReviewGateDialog` with the save/cancel choice,
the save path flushes the editor and re-reads a fresh `books.open` snapshot, and blocked or cancelled
outcomes never start a run (`apps/desktop/tests/review-gate.test.tsx`). T006 is done.

### Report entry, view and run states (2026-11-03)

The workspace Review manuscript action (header and mobile menu) gates on a confirmed save, then
analyzes the fresh snapshot in memory (`buildReviewReport` over `analyzeReviewCoverage`) and shows
`ReviewReportDialog`: run scope/time, studio word counts, per-chapter coverage with skip reasons,
the word-count definition with an honest phrase-signal note, and the findings list. Findings stay
empty until the metric decision (T001) lands the T008 scanner, so the report never implies text was
scanned. Evidence navigation revalidates against a fresh snapshot and selects the exact span through
a new `ManuscriptEditor` selection prop; stale reports name the changed chapters and disable
navigation. The report is workspace state only: a new run replaces it, switching books discards it,
and the run path performs no writes. Running, stopped, failed, partial and insufficient-evidence
states each name the next safe action. Host assumption while T002 stays open: desktop first, built
in the shared app component the browser and mobile targets reuse. Fixed two latent strict-mode
errors the new import surfaced in `runReviewWork` (microtask-deferred abort preserved) and
`revalidateReviewEvidence` (saved-only narrowing); core cancellation/evidence tests still pass.

Remaining: T015 keeps the repeatable-phrase scenario for the deferred T008 scanner; T016 smoke
covers review start/results, save-gate cancel and stale with Run again on the fixture book, with
evidence navigation (needs live findings), run-cancel timing and an insufficient-evidence book
journey still to add.

### Metric and host decisions plus live gate status (2026-11-03)

T001/T002 were decided with the author after a synthetic-normalization probe (`/tmp/phrase-probe.mjs`,
throwaway): the first report measures saved words and coverage only, the phrase signal is deferred,
a future signal unifies curly and straight apostrophes, and desktop ships first. Spec decisions 1–2,
tasks T001/T002/T015 and the report copy record the outcome; T008 and the phrase-repeat test stay
deferred with it. The smoke gate-cancel journey exposed a real race: the workspace gated on mirrored
React state, which can lag a fast keystroke by an effect. The gate now reads the editor's live status
(`EditorHandle.getStatus()`), with a renderer test pinning the fast-click case; smoke covers the
Keep-writing journey end to end at 21/21.

- The public shared count semantics in spec 002 FR-016 and the current chapter format are inputs, not
  re-decisions in this spec.
- The repeated-phrase metric was a proposal; the recorded 2026-11-03 decision defers it. The first
  report measures saved words and coverage only, with honest empty-findings copy. A future signal
  unifies curly and straight apostrophes. This does not hold up saved-source handling, count reuse,
  coverage or stale/cancel contracts.
- The host-surface decision is recorded: desktop first through the shared app component. Pure core
  analysis and fixture tests remain independently implementable, and later hosts reuse the same
  component after proving saved version/hash revalidation.
- Report persistence/retention and AI-assisted review are deliberately outside the first milestone.
  No dependent task exists here; future specs must resolve their decisions before implementation.

## Verification approach

- Pure-core tests prove stable output from identical synthetic snapshots, counter parity, phrase
  occurrence offsets, coverage, insufficient-evidence classification, cancellation and stale-source
  evidence suppression.
- Adapter/library tests use isolated temporary libraries with synthetic chapter files and verify
  that review reads do not write, create checkpoints or modify chapter hashes/versions.
- Renderer tests cover dirty-buffer blocking, save failure/conflict, progress and cancel, partial
  coverage, empty scope, stale report and exact evidence navigation.
- A smoke journey may exercise the visible review flow only with a synthetic fixture library.
  No live provider or real author library is needed or authorized by this plan.
