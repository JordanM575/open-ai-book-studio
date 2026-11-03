# Changelog

All notable changes to AI Book Studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Update the `Unreleased` section before every commit.

## [Unreleased]

### Added

- The workspace exports the manuscript as one Markdown file beside the Word export: the book
  title, then each chapter in reading order under its own heading with its text unchanged. It
  goes through the same publication boundary as Word (a cancelled picker or a declined
  replacement writes nothing, a destination inside the library is refused, a file that changes
  after consent is never overwritten) and the header names the saved file. The Word button now
  reads "Export Word document" so the two are told apart. The browser build explains that it
  is a desktop feature. PDF and EPUB remain open under 002 FR-051.
- Each model card now names its capabilities in plain words beside price and context: whether
  it uses tools and reads pictures, or that the provider did not report them.
- A finished turn now shows its whole usage line in the conversation: tokens in and out, the
  reported cost or its estimate/unknown mark, the share of context used, and the model that
  answered in plain words.
- A mid-conversation model change now reads in plain words: the turn records the catalogue's
  display name, and the divider says "Now answering with {account} · {name}" instead of the
  raw model id (older turns without a recorded name still show the id).
- A failed turn that changed chapters now checkpoints before it reports: the error names the
  changed chapters, Retry stays hidden until they are undone, and undoing restores the prose
  and returns the Retry request. When no checkpoint could be saved the turn says the chapters
  need review and offers neither retry nor undo. (Undoing a failed turn previously updated
  nothing on screen; it now patches the turn's message by id.)
- A rate-limited turn says how long to wait and never retries in a loop: the provider's
  `Retry-After` travels from the transport failure to the failed turn, its event and its
  stored message, and the chat names the wait in plain words ("Try again in about 2 minutes")
  beside the existing Retry request. Each attempt makes exactly one provider request.
- An unreachable provider now says so in plain offline words: the failed turn keeps the
  provider message, adds that writing, planning and exporting all still work, and keeps its
  Retry request, so the next prompt sends as a new turn.
- The model picker now shows which account is active: with several accounts on one provider,
  each keeps its label and the book's connection is marked Book default, with a one-off turn
  override named This turn when it differs. Browsing another account never moves the mark.
- A turn that reads before it replies now costs the whole turn: every provider step's reported
  price is summed instead of keeping only the last step's, and the done event and stored
  message carry the summed cost with whole-turn tokens.
- Removing a provider connection is now proven safe: its cached models are dropped (a
  reconnected account fetches again), and the manuscript, its conversation history and every
  library file survive byte-identical.
- Reading aloud can now be held and gone on with: a Pause reading button appears while the
  chapter is said and becomes Resume reading until it ends, for the computer's own voice and
  the voice service alike. A fresh read starts unpaused; ending, cancelling or a new read
  clears the held state.
- Added migration field-carry coverage: `apps/desktop/tests/legacy-import.test.ts` now proves
  outline, story arc (including string and list normalisation), front matter and scene
  purpose/notes survive a legacy import byte-for-byte. `idea` is still silently dropped with no
  skipped-item report; that product work stays open under spec 003
  (FR-026, SC-004). No product code changed.
- Made legacy migration idempotent (003 FR-030): each legacy book is fingerprinted with SHA-256
  over canonical JSON and recorded in `.studio/migrations.json`; a second run over the same export
  creates nothing and names each recognised book, and the library view says so instead of
  reporting a new import. A deleted book re-imports, and an unreadable record warns and imports
  everything again. Match design recorded as D-180; the record format is documented in
  `docs/FORMAT.md`, including the archive-restore caveat.
- Proved author typing survives a live agent turn: text saved while a turn waits on approval
  applies the approved overwrite, and one undo restores the typed text.
- Removing a provider connection is now proven terminal: a later request for that connection
  throws before any network call is made.
- A turn the provider's content policy declines now says so in plain words and offers Try
  another model, which opens the model picker. (Image-generation refusals stay open: that flow
  has no refusal path yet.)
- Provider failures now distinguish a valid key that lacks permission from a rejected key: 403
  and permission-signal failures report `permission` with a needs-permission status and a
  check-the-scopes message, while 401 stays `auth` and content-policy refusals still win.
- Reveal-in-Finder is now driven through the real main-process handlers in a test: the library
  reveals the open folder, a conflict reveals its saved file, and a renderer-supplied escape path
  is refused without touching the shell.
- A failed studio voice no longer means silence or a stale voice label: read-aloud falls back
  to the computer's own voice on service refusal, errors, playback failure and blocked playback,
  and the panel says which voice actually read. The fallback note clears on the next utterance.
- A rendering crash no longer leaves a blank window: an error boundary around the shared app
  shows a plain screen with a Reload studio button on desktop and web. Errors in event handlers
  still report through inline notes.
- Pinned the agent reply contract in a test: the shipped instructions hold the model to two or
  three sentences, no tool names, ids, JSON or process talk, and chapters by number and title.
  Model wording itself is untestable with a mock; no runtime truncation exists by design.
- Pasting into the manuscript now normalises the text on the way in: Windows and old Mac line
  endings, non-breaking spaces and curly quotes are unified (quotes match what the author types,
  keeping pasted and typed prose searchable as one corpus), and runaway blank lines collapse to
  one. Single breaks, stanza breaks, trailing hard breaks, tabs and dashes pass through, so verse
  survives. The shared `normalizePasteText` ships as `@ai-book-studio/core/paste`.
- The agent now checks an author-stated word limit after a rewrite: `replace_in_chapter` and
  `overwrite_chapter` accept an optional `maxWords`, verify the rewritten passage after saving,
  and report within/over with the saved chapter count. A miss is reported, never silently
  reverted. The new bound satisfies the tool limits contract.
- Proved the library grid stats: `listBooks` summaries carry word counts summed from chapters,
  stage, description and chapter counts, and the `library.json` catalog matches. The grid still
  reads all chapter files per the documented catalog-never-truth design; lazy open stays open
  (D-182).
- A previous run's approval can never resume: starting any turn expires stored pending approvals
  no live turn holds (persisted as expired), answering the old turn explains it is no longer
  waiting, and the new turn runs fresh. Approvals held by a live turn are untouched.
- Legacy migration now carries pictures (003 FR-020/FR-024, SC-004): every image version present
  in the export's image map is decoded and stored in the book's image folder byte-identical, with
  prompt, model and cost where the export has them and dimensions and MIME read from the bytes.
  Cover-flagged pages import as cover pictures; missing, unreadable and oversized pictures become
  warnings and never fail the book; per-book picture counts join the report and the library note.
  Page versions, current-version marking, anchor rebinding, cover export inclusion and image style
  stay open (D-181).

- Spec 011 T036: informational spending hooks. The agent dialog has a Spending section with a
  per-turn ceiling and a monthly warning level per book (both unset by default), the month-to-date
  spend with a lower-bound note when turns went unpriced, and both warnings. Warnings never stop
  the agent; enforcement waits on decision D-116, which stays proposed.
- Spec 016 T006/T007: the drift review dialog and the Settings sync section. The main process scans
  on library open and on throttled window focus; the dialog reviews each change with keep-disk,
  keep-mine, open-both and export actions, and the Settings section shows the device, last scan and
  interval. Own saves, trash moves, threads and images note themselves into the sync baseline so
  they never report as someone else's edit. D-120 stays proposed.

### Changed

- Film script draft 2 and a truth pass on the submission packet, which follow the event's
  demo-scope rule. All pre-event context is in one opening segment labelled "Built before the
  event". Every later shot names only event work and marks whether it needs a live Meta call. A
  capture order with per-shot fallbacks replaces the SAM shot.
- The packet, the hackathon README and spec 021 no longer claim SAM cutouts (retired, D-158), Muse
  Wonder or open weights. The packet names OpenRouter's voice as a non-Meta service, no longer claims
  a cache-hit rate, follows the film in its demo runbook, and lists the event work since the October
  26 cut. Its evidence table now holds fields to fill from the final clean clone, with today's numbers
  shown separately. That includes coverage below the floor.
- `AGENTS.md` no longer refers to a document that was removed, and four research notes now say
  "locally" instead of process jargon.

### Fixed

- The full test run is green again (four failures and two errors, each file passing alone).
  Three leaks between files caused them: the agent runtime tests left five-second deadlines
  running after each test, the workspace's "Saved" note timer fired after the workspace
  unmounted, and two different Electron mocks raced to define the module. The deadlines are
  now cleared after every test; the note's timer is cleared on unmount, a real fix that also
  stops a state update into a closed view; and every file registers the one complete
  Electron mock in `tests/support`. The DOM teardown also lets React finish work it
  scheduled outside `act()` before the window closes, which had intermittently failed a
  later file and once hung the run. Nothing was quarantined.
- The accessibility and visual gates run to the end again. After their conflict step, opening
  the library now shows the drift report (016 acceptance scenario 2), and both scripts close it
  before opening the book. Before recapturing 76 of the 112 visual baselines, each diff was
  located: the library's location line moves the grid, and the workspace header gains the
  Format book and Export Markdown buttons. Nothing else differs.
- Corrected the 010 roadmap row: shared UI extraction landed in 013 (`packages/ui`,
  `packages/app`); only the native folder-picker matrix remains there.
- Hardened the web smoke UI typing journey: it now proves the keystrokes landed in the
  editor and the save committed a newer chapter version, instead of trusting a bare
  "Saved" status that also shows when nothing changed. No product code changed.
- Fixed the desktop smoke slow-run cancel check on slow machines: the stopped-state
  wait is now 60s (was 10s) with the outer hang guard at 180s, and a timeout now
  names the state the report is stuck in. The cancel contract itself was proven
  instant in-process; only the gate window was too tight for the 3M-word stress
  fixture. Verified 29/29 twice. No product code changed.
- Fixed manuscript review cancellation on long books (spec 034 T010/T016): the
  word-count analysis ran synchronously on the run thread, so on a fast machine a
  cancel click always landed after the run finished and on a large book the
  interface froze with a Cancel button that could not act. The analysis now
  counts in whitespace-aligned slices and yields between 256KB budgets, so
  Cancel stays clickable, an abort discards partial counts, and small books
  analyze with no added latency. This supersedes the earlier slow-machine
  diagnosis: the gate window was never the fault. The smoke review checks now
  wait for report content rather than the dialog shell, and the stale re-run
  waits for a new report generation instead of the shell losing its banner.
  Verified 29/29 in the desktop smoke with the cancel check green.
- Corrected the 018 roadmap row: the manual desktop/MCP pass (T011) ran against a
  real backend and MCP client with reads verified on disk; it is not pending.
- Fixed the WebMCP `untrustedContentHint` polarity: every studio tool output is
  author-supplied prose (which may embed imported or quoted third-party text), so
  the annotation is now `true` on every tier — in `surfaces.ts`, the
  `bookwriter tools --format webmcp` output, and the glasses page registration.
  The value was `false` while the code comments and the WebMCP semantics both
  describe output the caller must treat as data. No behavior or gate changes.
- Unified the studio word counter (spec 002 FR-016): one dependency-free
  `countWords` in `packages/core/src/words.ts`, re-exported by
  `packages/core/src/markdown.ts` and `packages/app/src/lib/utils.ts`, so the
  editor's live count can never disagree with chapter metadata, the manuscript
  review or import mapping again. Covered by a single-implementation pin plus
  behavior cases and an editor header-count agreement test. No behavior change.
- Proved failed DOCX exports keep the previous file and leave no partial output
  (spec 002 FR-055): real-writer failures into an unwritable folder throw with
  an empty directory for fresh exports and a byte-identical prior file plus no
  staging droppings for replacements. No product change; the boundary already
  threw through the atomic writer.
- Proved DOCX export honors manuscript settings (spec 002 FR-052): the same
  chapters built under default and custom settings produce documents that carry
  only their own font, body size, line spacing and first-line indent runs with
  identical prose. No product change; the existing typography test already
  covered one custom profile and chapter-title alignment.
- Covered the Story Bible dialog (spec 002 FR-019): staged character and memory
  edits save together, Cancel discards a staged removal without writing, blank
  title disables save, and a failed save keeps the dialog open and reports. No
  product change; the tool-level add/update/remove paths were already covered.
- Pinned verse preservation (spec 002 FR-015): a stanza round-trips byte-identical
  through chapter save and read, the counter counts across its breaks, and the
  exported DOCX keeps the stanza lines in order. No product change; the
  canonicaliser already preserved interior breaks.
- Pinned tool limit honesty (spec 002 FR-022): every stated limit resolves to
  an enforced input maximum or a proven execute cap, the two 200-match result
  caps truncate behaviorally with full counts reported, and the system prompt
  policy sections state no numeric limits. No product change; descriptions
  interpolate the enforced constants and the schema carries every exact bound.

### Added

- Spec 026 T015/T016: connector application material. `specs/026-glasses/connector-application.md`
  records the fixed manifest head, the 22-tool classification with the 7 sensitive names,
  per-tier side effects, the refusal contract, the unwired account-linking story and a
  credentials-free test story; `docs/TOOLKIT.md` records the tier-to-shape mapping and
  points at the note. No application sent: no public endpoint exists. All quoted
  strings verified against the real surface functions with synthetic fixtures only.
- Spec 036 T007: pure task-preview candidate evaluation. `packages/core/src/routing/`
  adds versioned task-profile schemas and `evaluateCandidates`, a deterministic pure
  function over per-provider catalogues, connections and build that reports eligible,
  excluded, unknown or unavailable status with plain-language reasons. No settled task
  taxonomy is shipped; no network, key, manuscript or runtime import exists. Covered by
  `packages/core/tests/routing/evaluate.test.ts` with synthetic fixtures only.
- Spec 036 T008: honest cost/context presentation rules. `unitPriceViews` shows
  catalogue input, output and cached-input unit prices with provenance; missing or
  unusable prices stay unknown, never zero, while a published zero stays known.
  `contextView` shows the catalogue limit with request fit always unknown. No total,
  ceiling or rejection exists. Covered by
  `packages/core/tests/routing/presentation.test.ts` with synthetic fixtures only.
- Spec 036 T009: shared task-preview surface. `TaskPreviewDialog` renders the
  evaluation over caller-supplied profiles and local catalogues: unranked candidates
  in catalogue order with statuses, reasons, price/context facts and per-catalogue
  freshness lines. Only a transient selected-profile id is kept; a "Choose in the
  model picker" callback replaces selection with no preselect. Covered by
  `apps/desktop/tests/task-preview.test.tsx` with synthetic fixtures only.
- Spec 036 T010: preview neutrality proofs. `task-preview-neutrality.test.tsx` drives
  the dialog through open, profile changes, Close-button close and Escape cancel
  against a fixture host, proving book default, one-turn override, connection,
  history, usage and manuscript stay unchanged and the picker callback carries no
  model. No `window.studio` mock is installed, so bridge access would throw.
- Spec 036 T011: dedicated preview states. The dialog shows no-catalogue, malformed,
  unreadable-profile, no-candidate and stale-catalogue states, each stating what is
  unknown with Close and the model picker as the only next actions; no refresh,
  retry, replacement choice or manual-flow block exists. Covered by
  `apps/desktop/tests/task-preview-states.test.tsx` with synthetic fixtures only.
- Spec 036 T012: preview call/credential spies. `task-preview-calls.test.tsx`
  exercises the dialog behind a throwing bridge proxy and fetch stub, proving open,
  profile changes, the picker path and close make zero provider calls, read no
  credentials and fetch nothing; a positive control opens the real model picker and
  observes its provider and connection listing.
- Spec 036 T013: preview consent regression. `task-preview-consent.test.tsx` proves
  previewing a Contributor candidate shows the existing 022 warning, offers no
  consent control, leaves the training-consent flag alone and touches no bridge
  surface.
- Spec 036 T014: preview access pass. `task-preview-access.test.tsx` verifies the
  dialog role and name, named native buttons, pressed-state exposure, focusability,
  list markup for reasons, no inline motion styles, and identical token-only
  structure under light and dark themes.
- Spec 036 T020: synthetic-fixture rule verified. All 51 existing preview,
  neutrality, states, calls, consent and access tests audited: no live providers,
  real manuscripts, credentials, paid services, devices, Node or network access;
  bridge objects are self-installed throwing proxies or one canned stub. The rule
  stays standing for the gated T015–T019 tests.
- Spec 031 T010: per-book tone and answer-length settings UI. The existing agent settings
  channel accepts and returns `tone` (500 characters maximum) and `answerLength`
  (Brief/Standard/Detailed, Standard by default); the agent dialog shows both with
  Save/Clear actions and a disclosure that the values travel with submitted turns.
  Values stay in ordinary book data and `SKILLS.md` is unchanged. Covered by
  `agent-interaction-contract.test.ts` and `agent-tone.test.tsx` with synthetic
  fixtures only. Runtime inclusion in submitted turns stays with later tasks.
- Spec 031 T004: interaction contract fields. Turn input requires `mode` with optional
  bounded one-turn `guidance`; stored turns record `mode` and carry a `guidance` part;
  per-book agent settings gain `tone` and `answer-length` with defaults for older books.
  All existing callers send `edit`, preserving behavior; covered by
  `agent-interaction-contract.test.ts` with synthetic fixtures only. No permission or UI
  changes; enforcement and the composer default stay with later tasks.
- Spec 031 T003 (research only): in-flight guidance semantics. `research/inflight-guidance.md`
  pins prompt fixity and the stop-plus-new-turn journey and D-179 proposes no live
  steering, with guidance staying pre-send, in proposed-plan review, and in `SKILLS.md`.
  In-flight guidance remains blocked. No behavior changes.
- Spec 031 T002 (research only): pause acknowledgment and continuation semantics.
  `research/pause-continuation.md` pins terminal-stop facts and mid-write atomicity and
  D-178 proposes event-boundary pause, new-turn continuation, per-turn approvals, and
  close-stops/restart-expires. Pause/resume controls remain blocked. No behavior changes.
- Spec 031 T001 (research only): Discuss default and read-tool policy. `research/discuss-read-policy.md`
  pins the exact read-tier six, the withdrawal subset seam, bridge denial and the plugin
  write-capable surface; D-177 proposes read-only built-ins only with Discuss as the new-turn
  default. The Discuss tool set and composer default remain blocked. No behavior changes.
- Spec 032 T001/T002 (research only): chapter-history storage and retention. `research/storage-layouts.md`
  compares six layouts against the book/trash/archive facts and D-175 proposes book-scoped
  `history/` records mirroring chapter files; `research/retention.md` pins unbounded trash/conflicts
  and failure preservation and D-176 proposes no automatic pruning with trash-based deletion.
  Dependent persistence work remains blocked. No behavior changes.
- Spec 009 T029: schema refusal and manual recovery journey. Opening a book written by a
  newer build now refuses before any write and shows a recovery dialog instead of a toast:
  detected vs supported schema, the compatible-build next step and the FR-047 no-migration
  guarantee. The local support summary reuses the About build metadata with the compatibility
  outcome; it holds no manuscript text, no credentials and no absolute paths, and is copied
  only on request. Covered by `schema-refusal.test.tsx` with synthetic fixtures only.
- Spec 009 T025 (research only): profile cleanup on uninstall. `research/profile-cleanup.md`
  inventories the two-file profile and proves pointer-not-prose storage, missing-file defaults
  and the shared root; D-174 proposes a uniform in-app optional cleanup with itemized
  confirmation, never default-on, library never in scope. Nothing is deleted; dependent work
  remains blocked. No behavior changes.
- Spec 009 T024 (research only): lifecycle support matrix. `research/lifecycle-matrix.md`
  declares the three builder targets with standing, survey-only native methods and per-OS
  profile paths, deferring exact OS floors to upstream confirmation; D-173 proposes the matrix
  with macOS release-blocking, profile-stays-on-uninstall and Settings discovery. Dependent
  work remains blocked. No behavior changes.
- Spec 009 T023 (research only): D-115 scope over user-driven local install and upgrade.
  `research/local-install-upgrade.md` pins the version-free shared settings file, write
  confinement to the profile root, no app version in profile or library files, side-effect-free
  opens and pre-write schema refusal; D-172 proposes D-115 does not gate manual local
  install/compatible upgrade under override disclosure, unsigned labeling, same-schema-only
  and no feed/automation conditions. Nothing installs; dependent work remains blocked. No
  behavior changes except a pure settings-path helper with identical behavior.
- Spec 009 T026: build-metadata identity in About. The metadata now carries observed
  platform and architecture (desktop reports OS/CPU, web reports `web`/`unknown`); About
  shows an Architecture row, `Unknown` when undetectable, alongside version, commit, schema,
  target, platform and signing. Covered by metadata and About dialog tests.
- Spec 009 T004: release checklist. `scripts/release/check.mjs` re-hashes the served
  artifact and compares hash, bytes, version, commit and signing status against the record
  and the About values, naming only the mismatched field. Covered by checklist tests with
  tamper, drift and secret non-disclosure.
- Spec 009 T003: release-artifact scan. `scripts/artifact-scan.ts` refuses credentials,
  environment files, source maps and manuscript-like content in served artifacts, naming file
  and class only; tarballs are extracted and scanned, opaque containers name-checked. Wired as
  the `release-artifact-scan` gate that blocks publication. Covered by new scan tests including
  secret non-disclosure.
- Spec 009 T002: unsigned-path audit. About (Settings) now carries a Signing row from the
  build metadata, unsigned on every target until D-115; the release record already states the
  unsigned status, and no public download page exists yet (testers receive the artifact plus the
  record directly). Covered by the new About dialog tests and build metadata tests.
- Spec 009 T001: machine-readable release record. `scripts/release/record.mjs` hashes exactly
  the served files in a flat artifact directory (streaming SHA-256; names, sizes and hashes
  only, never contents) and writes the plan's JSON shape with version, commit, library schema,
  platform, architecture, gates and signing status; it refuses empty, missing or nested
  directories, `--expect` file-set mismatches and bare `signed` claims without an identity.
  Covered by `apps/desktop/tests/release-record.test.ts`, including secret non-disclosure.
- Spec 034 T003 (research only): report save, export, retention and deletion compared with
  synthetic evidence. `research/report-retention.md` pins the report shape (source references and
  excerpts, never bodies; unbounded excerpts; computed freshness) against the volatile baseline;
  D-171 proposes narrow clipboard/Markdown export with capped excerpts and markings, JSON save
  under `books/<bookId>/reviews/` with a 20-per-book cap, explicit and book-fate deletion, and
  archive/sync exclusion. No persistence work; dependent work remains blocked. No behavior changes.
- Spec 035 T008 (research only): format-profile persistence and physical-layout controls
  compared with synthetic evidence. `research/format-profiles.md` pins the settings-nesting strip
  hazard (unknown nested sections are dropped by supported saves), top-level survival across the
  FormatDialog full-settings merge, transient target state and library-default A4/1-inch page
  geometry; D-170 proposes transient per-export now, a reserved top-level `formatProfiles` shape
  later, and no physical controls until D-108 acceptance. Nothing persists; dependent work remains
  blocked. No behavior changes.
- Spec 035 T007 (research only): ordered-matter schema and legacy conversion compared with
  synthetic evidence. `research/matter-schema.md` pins whole-record replace, ordered string
  survival, the strict-open brick on rich values and failed-patch byte preservation; D-169 proposes
  the key-function kind table, additive `matterOrder` with a deterministic fallback, order-only
  confirmed conversion, clear-to-rollback and tolerant carry for unreadable records. No migration,
  no reinterpretation; dependent work remains blocked. No behavior changes.
- Spec 035 T006 (research only): export renderer and determinism alternatives compared with
  synthetic evidence. `research/export-renderers.md` verifies the `docx` pipeline's deterministic
  content parts and fixed zip entry dates (only `docProps/core.xml` wall-clock timestamps vary)
  and surveys LibreOffice headless, `pdf-lib`, Typst and EPUB assemblers from documentation only;
  D-108 proposes the determinism requirements and per-target illustration/packaging contract with
  KDP acceptance, pagination/trim, font embedding and validator tooling explicitly unresolved. No
  renderer selected, no conformance claimed; dependent work remains blocked. No behavior changes.
- Spec 035 T004–T005: DOCX journey characterized and its safe-publication boundary built. T004
  pins the current journey with synthetic evidence: canonical typography reaches the document
  (OOXML anchors), attached images resolve through the image store with skip rules, source files
  stay byte-identical, and dirty editor input saves before `books.exportDocx` runs. T005 adds
  `exportManuscriptDocx` with picker-cancel, in-library alias refusal, explicit replacement
  consent, destination recheck, atomic staged writes and prior-file preservation on failure; the
  IPC contract and headless hook are unchanged. `ManuscriptEditor` unmount now also clears its
  pending draft timer.
- Spec 035 T001–T003: Format journey designed, built and contract-tested. A Format dialog
  (`Format book` toolbar/overflow entry) binds `settings.manuscript` as the canonical source with
  immediate full-settings-merge saves, offers DOCX with PDF/EPUB/Markdown visibly planned, and shows
  a local approximate preview with a persistent disclosure making no page or publisher claims.
  `apps/desktop/tests/format-dialog.test.tsx` pins binding, merge, disclosure, targets, schema
  parity, failure revert and no chapter writes; hidden smoke covers the preview in the real UI.
- Spec 033 T003 (research only): source-anchor representation and verification compared with
  synthetic evidence. `research/source-anchors.md` and premise tests propose exact ordered
  verification (version+hash equality, excerpt-at-range equality, no fuzzy fallback) (D-168,
  awaiting author acceptance); T008 remains blocked. No behavior changes.
- Spec 033 T002 (research only): collection identity and membership compared with synthetic
  evidence. `research/collection-identity.md` and premise tests propose many-to-many id-ref
  membership, unique names, stable identities and id-lookup trash handling (D-167, awaiting
  author acceptance); T005 remains blocked. No behavior changes.
- Spec 033 T001 (research only): organization data storage matrix compared with synthetic evidence.
  `research/storage-matrix.md` and premise tests propose library-root collections, disposable
  recent-work pointers and per-book goal/annotation sidecars (D-166, awaiting author acceptance);
  D-167/D-168 stay Open and T004–T008 remain blocked. No behavior changes.
- Spec 030 T001 (research only): Story Bible extension storage alternatives compared with synthetic
  evidence. `research/storage-alternatives.md` and premise tests propose a separate versioned
  `planning.json` (D-163, awaiting author acceptance); D-164/D-165 stay Open and T002–T008 remain
  blocked. No behavior changes.
- Spec 028 T007: placeholder-save block. Saving over a chapter whose file is listed but unreadable
  preserves the author's text as a `conflict-placeholder` copy with a new `placeholder` reason and
  shows the existing conflict choices with placeholder-specific copy, instead of overwriting or
  failing raw. Meta-only edits are unchanged (no body text to preserve).
- Spec 028 T005: location health in the library list. A `library:locationHealth` channel
  serves the derived state from a fresh read-only scan, and `LibraryView` shows a
  `location-health` line under the library root until the 016 settings section lands.
- Spec 029 T016: browser/mobile import capability specified and kept refused.
  `research/browser-mobile-import.md` records the per-target verdict (web folders and
  browser storage fail the publication contract — every web port publishes with
  copy+delete, never an atomic rename; iOS/Android inherit the web refusal through the
  Capacitor shell), proven by `apps/web/tests/storage/manuscript-import-refusal.test.ts`
  pinning the honest desktop-app refusal on both channels. Enabling any target needs its
  own source-read, failure-clean publish and hidden-journey conformance.
- Spec 029 T015: other-format intake evaluation. `research/other-formats-intake.md`
  records the per-format verdicts: RTF rejected (`rtf-parser` throws on images and legal
  escaped spaces, inlines headers/footnotes, flattens tables), ODT validated but not
  enabled (`fflate` plus `fast-xml-parser` with mandatory `preserveOrder`/`trimValues:false`;
  enabling needs the format decision, transform, wiring and T013 conformance), legacy
  `.doc` refused with no validated reader. Proven by
  `apps/desktop/tests/other-formats-intake-validation.test.ts` with synthesised fixtures;
  the product path still refuses `.doc`, `.rtf` and `.odt`.
- Spec 029 T014: DOCX intake validation. `research/docx-intake.md` records the evaluated
  contract (mammoth plus zip sniffing; chapter split on non-title top-level headings; body
  fidelity; image refusal instead of base64; table text in order; silent drops reported),
  proven by `apps/desktop/tests/docx-intake-validation.test.ts` with synthesised documents.
  The feature is not enabled: `.docx` is still refused.
- Spec 012 T030: unified summary. The single pass/fail/skip/quarantined summary format now
  carries a tag, and `bun run release` prints the `[release]` summary — per-stage results,
  test counts, quarantined count, verdict — as the last line on both the go and blocked
  paths. Ad-hoc `bun test` keeps its native output.
- Spec 012 T029: fast-command budgets. `bun run verify` prints a budget line every run and
  fails when the whole command exceeds 5 minutes or the suite gate exceeds 20 minutes on the
  reference machine; `docs/TESTING.md` names the budgets and marks the slow checks that stay
  out of the fast command.
- Spec 012 T023: release job. `.gitea/workflows/release.yml` and `bun run release` run the
  full suite, desktop/web/packaged smoke, artifact checksums and a waiver-aware verdict, then
  write a `releases/` record with gates, waivers, checksums and capability differences.
  Signing stays out per D-115; the manual checklist stays T025.
- Spec 012 T022: required gates and waivers. The Gitea workflow now gates on lint,
  quarantine, waiver, coverage and security plus both bundles, with browser (web journey,
  accessibility, visual) and desktop-smoke jobs. `docs/WAIVERS.md` is the waiver ledger and
  `bun run waiver:check` fails on expired or malformed rows; it runs inside `bun run verify`.
- Spec 012 T004: fast result summary. `bun run verify` is now `node scripts/verify.mjs`,
  which runs every fast gate fail-fast with output streamed, then prints one summary (per-gate
  results with durations, test pass/fail/skip, quarantined count, overall verdict) and exits
  with the failed gate's code. The summary carries counts only, never captured output.
- Spec 012 T002: lint gate. Biome is the configured linter (D-162); `bun run lint` fails on
  errors and runs first in `bun run verify` and in the Gitea workflow. Landing it fixed 40
  errors across the app, tests and scripts, including a hook-after-early-return, a
  hook-misnamed plain method, intentional trigger deps documented in place, and explicit guards
  replacing non-null assertions; the remaining warnings stay visible advisory debt.
- Spec 012 T001: requirement map. `tests/requirement-map.md` records the layer inventory
  (owners, commands) and maps all 272 functional requirements in specs 002, 010–014 and 016 to
  covering tests, manual checks or explicit gaps (148 covered, 14 manual, 110 gaps, with the gaps
  clustering on the unbuilt plan flow, device lock, CI registration, lint and timing budgets).
- Spec 012 T027: failure artifacts. `scripts/failure-artifacts.mjs` starts the Playwright trace
  when the page is created, collects redacted console/page errors, and saves a screenshot, a
  redacted console log and the trace only when a run fails; green runs discard everything. Wired
  into the a11y, visual, browser-matrix and perf checks, the web smoke and the desktop smoke
  (screenshot plus redacted renderer log on failure). A real-browser negative control confirmed
  all three artifacts save with secrets redacted.
- Spec 012 T028: quarantine ledger. `docs/QUARANTINE.md` records quarantined tests with owner,
  reason and removal date (empty today); `bun run quarantine:check` fails on expired or malformed
  rows and runs inside `bun run verify`. Skips reference the ledger ID; no test is fixed with a retry.
- Spec 012 T017: visual baselines. `bun run visual` captures the seven product views at four
  widths in light, dark, reduced-motion and reduced-transparency variants (112 committed PNGs),
  failing past a hair of pixels with no retries; volatile timestamps and the random library
  identity are masked. Re-accept with the explicit `--update-baseline`.
- Spec 012 T016: accessibility gate. `bun run a11y` scans welcome, library, workspace, chat,
  settings, Story Bible and conflict views at four widths in headless Chromium, failing on
  critical/serious axe findings and asserting editor/composer tab order with no trap. Fixed en
  route: unnamed icon-only New book button at phone width, mismatched archive button labels, and
  the welcome landmark.
- Spec 012 T018: performance gate. `bun run perf` times cold open, chapter reads and saves
  on a synthetic 120-chapter / 250,000-word library, measures the web bundle and welcome render,
  and fails only the SC-009 regressions (book open doubles, bundle grows past 20%) against the
  committed baseline, rewritten only by `--update-baseline`.
- Spec 012 T014: packaged Settings-open stall fixed. Opening Settings no longer runs the
  synchronous keychain round-trip (it wedged the packaged app when macOS wanted confirmation);
  `status()` is a fast availability read per D-161 and the probe moved to an explicit
  `connections:check` channel behind the Check control. Packaged smoke passes 27/27; the smoke
  runner fails loudly with window state instead of hanging and accepts `SMOKE_APP` overrides.
- Spec 012 T013: browser end-to-end interface journey. The web smoke now opens the book
  through the library card, types with real keystrokes to a Saved status, proves a page reload
  keeps the prose, forces a two-writer conflict through the UI save path with the copy named on
  reopen, and exports through the UI button (18/18). Denied/cancelled folder handling stays
  covered by the storage harness and permission unit tests; native picker clicks stay manual.
- Spec 012 T015: per-route content security policy and production fuse hardening. The web
  page may contact only OpenRouter, the loopback check harnesses nothing external
  (`apps/web/tests/csp.test.ts` guards every served route against the provider registry), and the
  packaged app ships with RunAsNode, node-options and CLI inspect off and asar-only loading on via
  the `scripts/flip-fuses.mjs` afterPack hook (`apps/desktop/tests/fuses.test.ts`; fuse states
  confirmed by packaged readback, hidden smoke 27/27).
- Spec 012 T019: maintained repository/artifact secret scan, source-map check and
  manuscript-like text scan. `scripts/submission-check.ts` now exports `scanTrackedSecrets`,
  `scanArtifactDir`/`scanArtifacts`, `enablesSourceMaps`/`sourceMapConfigProblems` and
  `proseProblems`; every finding names the file and reason, never the matched value, and the
  `submission:check` summary reports the artifact count. Covered by
  `apps/desktop/tests/secret-scan.test.ts` with runtime-built fixtures plus clean-tree
  assertions (full suite 1010 pass, typecheck clean).

- Spec 029 T006, T008: manuscript import parsing and the main-process boundary. Shared core gains
  `refuseUnsupportedExtension` wording plus determinism and span-reconstruction invariants (every
  chapter body equals its source span minus the reported edge blanks, and split order never changes
  the preview). New `apps/desktop/src/main/import.ts` picks through an injected dialog (macOS-gated,
  cancel stays a cancel) and reads through `stat`-first size refusal, an extension pre-check and
  strict shared-core validation; every refusal names only the file, never a host path. Covered by
  `apps/desktop/tests/manuscript-import.test.ts` alongside the parser invariants
  (full suite 919 pass, typecheck clean).
- Spec 029 T007: a presentational import preview dialog shows the full chapter text with line
  ranges, editable book and chapter titles, add/move/remove split controls that re-derive chapters
  from the same source bytes, honest refusal copy for unsupported input, and normalization notes.
  It reports the confirmed mapping through `onConfirm` only and never touches the library before
  the author confirms. Covered by `apps/desktop/tests/manuscript-import-preview.test.tsx`
  (full suite 928 pass, typecheck clean).
- Spec 029 T009: `LibraryService.importManuscript` stages a complete book under a unique
  unpublished `.studio/staging/` path, reads back and checks `book.json` and every chapter, then
  publishes with one atomic directory move — never as sequential visible calls. Any failure before
  the move leaves no visible book and removes staging; a cleanup failure names the remaining
  staging path. Covered by fault-injection tests over a recording in-memory port
  (full suite 934 pass, typecheck clean).
- Spec 029 T010: the `books:importManuscript` channel carries the author's confirmed mapping
  (titles + full bodies, never a path) through a strict shared-core schema to
  `LibraryService.importManuscript`. The preload bridge exposes it; the web runtime refuses it
  as desktop-only. Covered by schema contract tests and a dialog-to-contract test
  (full suite 941 pass, typecheck clean).
- Spec 029 T011: the library offers a macOS-only Import manuscript journey — choose a file in the
  main process, inspect the exact preview with title and split edits, confirm to publish one
  complete book, cancel before the commit with nothing added, and see published, cancelled and
  failed outcomes truthfully (the publish cannot be cancelled into a different result). Covered by
  journey tests over a mocked bridge (full suite 948 pass, typecheck clean).
- Spec 029 T012: after each manuscript publish the library shows a result report with the source
  file name, book title, per-chapter split lines and word counts, normalization notes and the
  explicit note that planning data, images and other metadata were not imported. Every count is
  derived from the committed book, proven by tests that feed the report different committed text
  (full suite 951 pass, typecheck clean).
- Spec 029 T013, T017: the manuscript import journey is covered end to end on the macOS reference
  target. The hidden smoke run stages a synthetic manuscript, drives the real preview, split,
  confirm and result UI, and proves the book appears only after publication while the fixture and
  the rest of the library stay unchanged. Recorded acceptance: full suite 951 pass, typecheck
  clean, hidden smoke 27/27 with synthetic fixtures only (not packaged or release acceptance).
- Spec 012 T007: deterministic property tests for the format core and save decisions. Fixed-seed
  generators prove front-matter round-trips, normalization idempotence, slug safety, order
  round-trips, conflict-name classification, word-count invariance, exact version increments and
  the conflict-decision matrix — 10 tests, ~4,100 assertions, no new dependencies
  (full suite 961 pass, typecheck clean).
- Spec 012 T008: damaged-file isolation at the library-open path. Malformed chapter files fail
  alone with per-file reasons while the book lists and healthy chapters keep saving; prose
  without front matter stays readable. The workspace names each skipped file with its reason in
  a dismissible line (full suite 965 pass, typecheck clean).
- Spec 012 T012 (partial): chapter rail and conflict-banner component coverage. The real
  `ChapterRail` is driven through list, select, add, move, delete and keyboard focus; the real
  `WorkspaceView` proves the reorder shortcut with dialog suppression and both conflict banners
  with working actions (full suite 977 pass, typecheck clean).
- Spec 012 T012 (complete): chat composer and connection-card coverage. Enter sends with the
  continued thread and optional turn model, Shift+Enter adds a newline, the running turn offers
  Stop; cards show kind copy, test on demand with busy disabling, list models with context
  sizes, and remove only after confirm (full suite 988 pass, typecheck clean).
- Spec 012 T011: OAuth sign-in guards for the OpenRouter SSO flow with no network beyond
  localhost and no real account. Callback state, expiry, decline and malformed input are
  refused without echoing the code; the loopback flow proves a mismatched callback exchanges
  nothing, the first callback wins, cancellation frees the flow and a waiting second start is
  refused (full suite 1002 pass, typecheck clean).

- Spec 034 T001, T002, T015: the first report measures saved words and coverage only. Decided with
  the author after synthetic normalization examples: the repeated three-token phrase signal is
  deferred (a future signal unifies curly and straight apostrophes), and desktop ships first with
  browser and mobile reusing the shared component. The report copy, spec decisions, tasks and the
  deferred T008 record the outcome; acceptance tests cover every scenario except the deferred
  repeatable-phrase case, and no provider or network call exists on the run path.
- Spec 034 T011–T014, T017: the Review manuscript action now produces a read-only, run-local report
  over the confirmed saved snapshot (`packages/app/src/components/ReviewReportDialog.tsx`). It shows
  run scope and time, studio word counts, per-chapter coverage with skip reasons, the word-count
  definition, and an empty-findings state that does not imply the proposed phrase signal ran. Evidence
  navigation rechecks the saved version and hash, selects the exact span in the editor, and stays
  disabled while a report is stale; a new run replaces the report and switching books discards it.
  Running, stopped, failed, partial and insufficient-evidence states each name the next safe action.
  Covered by `apps/desktop/tests/review-report.test.tsx` (dialog states, synthetic evidence, and a
  workspace integration run that performs no manuscript writes) and smoke checks that run the
  report over the fixture book, keep writing through the save gate without touching typed text, and
  mark a changed chapter stale before a new run replaces it (21/21 smoke checks). Live phrase
  findings still wait on the metric decision (T008).
- Fixed the review gate reading mirrored React state, which could lag a fast keystroke by an effect
  and skip the save choice. The gate now reads the editor's live buffer status
  (`EditorHandle.getStatus()`), pinned by a fast-click renderer test.
- Spec 034 T016: the smoke run covers an empty book reporting "Not enough saved text to review"
  instead of a false no-findings result, and cancelling a slow run during the snapshot read so no
  analysis starts (23/23 checks). The analysis now reads its own fresh snapshot on the cancellable
  path with abort checks instead of reusing the gate's read. Still open: evidence navigation (needs
  live findings from the deferred phrase scanner).
- Spec 028 T006 (D-161): provider settings shows each connection's health from the author's last
  explicit Test, with a volatile check time that clears whenever Settings opens; opening Settings
  never probes. Voice shows configured read-aloud/dictation availability with no check time and
  states it is never tested automatically. A rejected key renders the redacted safe message, never
  the secret. Covered by `apps/desktop/tests/settings-status.test.tsx`.
- Spec 029 T001–T003, T005: manuscript import decisions recorded with the author (whole-file
  default with line-boundary splits, Markdown literal, filename-derived editable title; 5 MiB
  strict-UTF-8 source with one BOM strip, NUL/control rejection, empty refusal). New pure parser
  `packages/core/src/manuscript-import/` (`validateSource`, `previewImport` with canonical bodies
  and per-chapter edge-blank-line accounting) covered by 11 synthetic-fixture tests. Publication
  verified: the desktop adapter atomically publishes a staged tree with one same-filesystem rename,
  refuses cross-device moves, and gained `removeDirectory` for staging cleanup (desktop, in-memory
  and web stubs) with contract and conformance tests. Web copy+delete does not qualify, so the
  first profile's publisher stays desktop-gated.
- Spec 034 T006: the workspace has a Review manuscript action (header and mobile menu) wired to live
  editor state. A dirty chapter opens a save gate with Save and continue or Keep writing; the save
  path flushes the editor and re-reads a fresh snapshot before anything runs, while a conflict,
  failure or cancel never starts the review and leaves typed text untouched
  (`packages/app/src/components/ReviewGateDialog.tsx`,
  `apps/desktop/tests/review-gate.test.tsx`).

### Changed

- Removed the competitor branding research and its references from the event branch, and stopped
  tracking Spec Kit's machine-local extension cache. A public repository should not carry another
  product's name or 240 KB of someone's tool state.

- The live check now runs the Contributor model the spec names. It used to take the first id in the
  catalogue containing "contributor", which was `muse-spark-1.2-contributor` while spec 022 and the
  submission described 1.3 — a check that measures a different model than the document names reads as
  proof of something it never tested. It prefers the preset, then the newest version the key offers,
  and the run records which one it used (`apps/desktop/tests/live-model-choice.test.ts`).
- The glasses decision is **D-160**, not D-158. Spec 026 had reused the number that
  `docs/DECISIONS.md` gives to the SAM retirement, so the same id named two unrelated decisions.
  `docs/DECISIONS.md` now carries both rows.
- Spec 012's ledger is brought up to date with evidence: the coverage ratchet (T003) and the
  failed-write test (T009) are done; T002's lint and T008's damaged-file test are recorded as partly
  done rather than left ambiguous, and the stale test counts are replaced by a pointer to
  `docs/TESTING.md`.
- `specs/README.md` gains a "Beyond the event" table for the four capabilities that are deliberately
  out of hackathon scope — import wizard, review engine, formatting and KDP export, task-aware model
  routing — and says plainly that spec 007's EPUB and print PDF were folded into 002 as intent and
  never built.

### Added

- One line in the README that places the studio in time: it began two days before the event and this
  repository is the edition submitted. It is a fact a reader would otherwise have to infer from the
  first commit's size.

- Spec 028, integration health: one derived state per location and per provider, and one warning
  component with a severity and a safe action. Planned, indexed, not built.

- The desktop component tests render in a DOM that `apps/desktop/tests/support/dom.ts` registers for
  one file and restores after it, so later files see Node's globals again. React loads only once that
  DOM exists, and its scheduling uses Node's timers, which is what lets the next file render.
- Archived the inherited repository (private, read-only) instead of forking its history. This repository
  starts from a clean initial commit and contains none of its fixtures, exports or branding.
- Moved to Bun workspaces: `apps/desktop` holds the Electron app and `packages/core` holds the schemas,
  the IPC contract and the Markdown format, imported by both sides as `@ai-book-studio/core/*`. Root
  scripts delegate with `bun --filter`; `bun.lock` replaces `pnpm-lock.yaml`.
- Migrated the library tests from Vitest to `bun:test` with the same 13 cases and assertions, and removed
  the Vitest configuration and dependency.
- Repointed the token generator, the smoke runner and the packaging configuration at the workspace
  layout. The smoke runner resolves Electron from the desktop workspace.
- Scrubbed the inherited product's name and design-kit paths from the docs, the changelog and the
  vendored tokens. The one remaining reference is the legacy export's wire marker
  `moms-ai-book-studio`, which the port must recognise; it is documented as a format constant, not as
  the product name. The type specimen in `tokens.json` no longer uses a personal book title.
- The book's `settings` now carry the agent's own settings, and every setting is defaulted on the
  *input*, so a book written before a setting existed still opens. The committed sample library
  proves it, and a test guards it.
- The usage log now records whether the provider reported its cache at all, so a measured cache of
  zero is never shown as a provider that measures no cache.

### Added

- Added the studio's tool catalog in Meta's two interchange shapes (spec 026): a WebMCP tool list,
  which a page on Meta's Ray-Ban Display glasses registers so the wearer can ask for it by voice,
  and a Meta AI connector manifest, with every tool classified Read or Write and the destructive
  ones marked sensitive. `bookwriter tools --format webmcp` and `--format connector` produce them
  from a live studio. The studio's own tier was already the classification Meta asks for, so this
  is a renaming rather than a translation.
- Added a minimal mode to the workspace: a strip that knows where you are in the book, says it
  out loud when you ask, offers to read the prose, and takes a sentence when you have something to
  say. It has a microphone for the hands-free loop: press it, say a sentence, and it is shown as
  heard and sent to the agent, and the answer is read back. Speech goes through a connected voice
  service when there is one and through the system voices when there is not, and every word it says
  is also on the screen.
- Added the agent's own capabilities (spec 025): a cacheable prompt prefix where the provider
  supports one, with the hit rate, the cached and fresh token counts and the turns that hit it
  shown per book, and a switch to turn the prefix off; per-tool call, success and failure counts; a
  switch per built-in tool, per book, that withdraws the tool from the model, the backend and the
  MCP server alike; an optional `SKILLS.md` in the book folder, given to the agent as the author's
  own instructions; and a plugin folder of TypeScript tools the author points the app at.
  Documented in [`docs/AGENT-CAPABILITIES.md`](docs/AGENT-CAPABILITIES.md), and proved in the built
  app by `bun run plugin:probe`.
- A plugin's arguments are a JSON Schema, or a Zod schema when the plugin's own folder can resolve
  it: a plugin folder usually sits outside the app, where the app's packages cannot be resolved, so
  a plugin that needed an import would simply fail to load.
- Recorded the toolkit manual pass in `docs/research/toolkit-2026-10-26.md`: the compiled
  `bookwriter` binary and a separate MCP client process against a real backend over a real library,
  with every change read back from the file.
- Recorded the glasses assessment in `docs/research/glasses-2026-10-26.md`: Meta's three surfaces
  for the Ray-Ban Display, the Web App's documented constraints, the one constraint that decides
  the design, and the live check that rendered the studio's 22 tools into both the WebMCP and the
  connector shapes.
- Proved the glasses page's assistant half without the hardware. The page's normal path in a
  browser is the buttons-only one, which left WebMCP — the part that only runs on the glasses —
  untested. A stub model context installed before the page's own script records what it is given:
  the read verbs are there with their schemas and handlers, the write verb is marked as a write, the
  destructive tools are not offered to an assistant at all, and calling one through the assistant's
  path comes back with the book.
- Added the phone-width walk to the end-to-end gate: the same dead-end and accessibility audit at
  390×844, because the phone layout is a surface people use and it strands people differently.
- Added `.github/workflows/verify.yml`: the typecheck, tests, builds and the coverage floor on every
  push, and the end-to-end checks under a virtual display. The e2e job is marked allowed-to-fail
  until it has been watched passing on Linux, because every check so far has been run on macOS and
  claiming otherwise would be a guess.
- Added the ambient agent, the voice pipeline, the bridge and the glasses page to
  `docs/ARCHITECTURE.md`, and marked the SAM section superseded where it is described rather than
  leaving it looking live.
- Added the studio's session verbs to the MCP server: `studio_status`, `studio_ask`,
  `studio_undo` and `studio_stop`. Without them a third-party agent could edit a book it could not
  describe, and could not undo what it had just done. The status is readable on a read-only server;
  the three that change the book need `--allow-writes`. The tier filter now applies to every tool
  rather than only to the mirrored catalog, which a test caught: the new write verbs had been
  sitting in the always-included list.
- Added a coverage ratchet, `bun run coverage`: 81.5% of functions and 88.3% of lines, with a floor
  of 80 and 87 that only moves up. Coverage had never been measured, so nobody could tell whether a
  change made it worse.
- Added the archive export to the smoke run, so both export paths are proven end to end: the Word
  file is unzipped and checked for its illustration and its text, and the archive is read back for
  its entries and the book inside it. Spec 019 T010b closes.
- Made the glasses page show the agent's own status line, the same sentence the desktop's minimal
  mode says, rather than composing its own summary of the book. What the device cannot do — being
  spoken to, when WebMCP is off — moved to the header, so the agent's line keeps the display.
- Made the ambient status say the truth about `working`. It was always `false`, so the minimal
  mode never offered Stop, and a phone would have shown a Stop it could not honour. The status now
  asks the runtime, and the control plane and the bridge both grew `POST /v1/books/:bookId/stop`.
- Fixed the minimal mode in the browser build. It showed an error on every book because the ambient
  status was a desktop-only stub, but the status is a pure function over the book, so this build now
  computes it from the library it already has. The web smoke proves the line and the six actions.
- Added undo to the control plane and the bridge, and `bookwriter undo`. The ambient status offers
  the action whenever a checkpoint exists, so a client that shows the status must be able to perform
  it; a route that offers an action it cannot do is a dead end in a pair of glasses. The bridge probe
  and the ambient check both drive the refusal that says there is nothing to undo.
- Added one end-to-end gate, `bun run e2e`, which builds the app, the web build and the toolkit and
  then runs seven checks against them: the built app through its own renderer, the browser build over
  its own storage, the real window for dead ends, the 600×600 glasses page, the ambient agent and the
  toolkit, a folder of plugins, and the phone's bridge **from a separate process**. Documented in
  [`docs/TESTING.md`](docs/TESTING.md).
- Added an accessibility pass to the UI audit: every control has an accessible name, is at least
  20 px to hit, every image has an `alt`, the view has exactly one `h1`, and one Tab reaches a control
  with a visible focus ring. The app passes all of them (33 controls).
- Added a real Word-export check to the smoke run, which needed a way to export without a save
  dialog: `STUDIO_EXPORT_PATH` names a folder for a headless run. The check unzips the file it
  produced and looks for the text and the picture, because the thing that goes wrong is never the
  writer's opinion of what it wrote. The fixture now carries an illustration.
- Added the voice pipeline (spec D-159): a text-to-speech seam in `packages/core/src/providers/tts.ts`
  with two services behind it, both using OpenAI's `audio/speech` shape — OpenAI directly for the
  studio's voice, and OpenRouter, whose free `fish-audio/s2.1-pro-free:free` makes a check that runs
  on every change cost nothing. OpenRouter has fifteen dedicated TTS models, discoverable with
  `GET /api/v1/models?output_modalities=speech`; they are listed under `"speech"`, not `"audio"`,
  which is easy to miss. A provider that answers with raw `audio/pcm` is wrapped in a WAV. A chapter
  is longer than one request, so the text is split at sentence boundaries and the audio is joined
  back into one sound. The minimal mode speaks through it, offers the voices, and falls back to the
  device's own voice when no service is connected. Documented in [`docs/VOICE.md`](docs/VOICE.md).
- Retired the SAM cutout (D-158): the request reaches Meta and is accepted, but returns no records
  and no usage on real and synthetic images alike, so nothing is built on it and spec 020 is marked
  superseded. The implementation and its tests stay where they are.
- Recorded the live Meta pass in `docs/research/live-meta-2026-10-26.md`: the model catalogue, a real
  writing turn with a Contributor model on a temporary copy of the sample (the pass condition was that
  the file on disk changed), dictation scored against a spoken phrase (all nine words), and a live
  Muse Image. SAM 3.1 answers `200 completed` with no records and no usage on every image and prompt
  tried, so it is recorded as blocked on the model's availability rather than on the studio.
- The check scripts now clear `NODE_OPTIONS` and the `HEADROOM_*` variables before spawning the app.
  A coding agent's shell can install a `fetch` shim that routes requests through a proxy that
  authorises only the agent, and an app that inherits it sees `{"error":"unauthorized"}` from every
  provider — an error indistinguishable from a bad key. The checks must measure the product, not the
  agent's proxy.
- Added the ambient agent: a status the studio keeps whether or not anyone is looking, and two
  ways to reach it. `GET /v1/books/:bookId/ambient` says where the author is, what changed last
  and what can be said or done; `POST /v1/books/:bookId/turn` runs a turn and waits for the
  answer, through the same runtime the app uses. The toolkit gained `bookwriter where` and
  `bookwriter ask`. The glasses' phone app needs exactly these two routes.
- Added the glasses page (spec 026): a 600×600 interface for Meta Ray-Ban Display glasses, served
  by the studio itself so it is the same origin as the API. It is dark because the display is an
  additive waveguide, it never scrolls because there is no scrollbar the wearer can see, it moves
  focus with the D-pad, it speaks through `speechSynthesis` while keeping the text visible, it
  registers the studio's own read tools with the browser's model context so an assistant on the
  glasses can call them by voice, it asks the wearer before every write, and it says plainly when
  the device cannot do something. `bun run glasses:check` drives it in a real browser at 600×600
  against the real studio: twelve checks, no dead ends.
- Recorded the plugin manual pass in `docs/research/plugins-2026-10-26.md`: the built app pointed at
  a folder of TypeScript plugins, the plugin's tool listed in the backend's catalog, the tool run
  against the open book, and a plugin that cannot resolve its imports left the others working.
  `bun run plugin:probe` repeats it.
- Added the studio's own writing tools to the loopback backend and the MCP server (spec 024): the
  backend serves `GET /v1/tools` and `POST /v1/books/:bookId/tools/:tool`, and `bookwriter mcp`
  mirrors the built-in agent's tools with a `bookId` argument, so a third-party agent gets the same
  verbs. Read tools are always available, write tools need `--allow-writes` and destructive tools
  need `--allow-destructive` on both the client and the request.
- Added `bookwriter tools` and `bookwriter call`, so a script can run one studio tool against the
  open book.
- Fixed two dead ends in the interface: the model picker without a connection pointed at a
  "Connections window" that does not exist and offered no way to add a key, and a failed turn in the
  writing agent offered only "Retry request", stranding the author's prompt when no model was
  chosen. Both now offer the action that resolves them.
- Added `bun run ui:audit`, which drives the real app through the main flows and reports any dead
  end, missing control or console error it finds.
- Added the submission package (spec 023): a committed original sample library at
  `samples/the-salt-road`, `hackathon/SUBMISSION.md` with the form fields, event-built disclosure, model
  list, demo runbook and judge map, and `bun run submission:check` for branch/tree, required files,
  forbidden paths, secret patterns and sample integrity.
- Added the film motion plates (spec 021 T007): eight HTML/CSS scenes using the studio tokens, a
  deterministic `window.renderAt(ms)` timeline, and a Playwright renderer for 1920×1080 preview stills or
  30 fps PNG sequences. Previews checked for problem, files, trust, background, visuals, voice, interop
  and close.
- Added a credential-vault health check and macOS runbook: `connections:status`, a non-secret
  `safeStorage` encrypt/decrypt probe, a **Check keychain** action in Settings, `STUDIO_VISIBLE=1` for a
  visible throwaway profile, and [`docs/KEYCHAIN.md`](docs/KEYCHAIN.md) covering unlock, locked-state
  testing, recovery and the legacy-keychain limits.
- Added the provider compatibility layer (spec 022): one `modelFor` AI SDK adapter registry, Meta model
  presets for Muse Spark 1.3 Contributor/Standard, cached prices and reasoning facts, and a per-book
  Contributor training consent with a model-picker warning and an agent guard.
- Added the film fixture generator (spec 021 T004): `bun run film:fixture` builds an original short
  book with a Story Bible, two chapters, a deterministic 1024×1024 illustration and a 512×512
  transparent character cutout through the real library and image store. The fixture is ignored by git;
  the generator and its test are committed.
- Added the product-film plan (spec 021): a positioning review of the category, a positioned script,
  a shot-by-shot storyboard and the voice, music
  and motion-plate production plan. Added the brand-positioning paragraph to `docs/DESIGN.md`.
- Added SAM 3.1 character cutouts (spec 020): prompt validation, the official `@meta-sam/parser` for the
  mask grammar, a `segmentation:segment` IPC route, the renderer `applyCutoutMask`/PNG compositor and
  cutout mode in the Illustration dialog. Cutouts save as `character` images with `cutoutOf`; a cutout
  can be attached to a cast member at save time or from the image list, and the character id is stored on
  the image record.
- Added the illustration pipeline (spec 019): a versioned `images.json`, an atomic image store over
  `LibraryPort`, PNG/WebP/JPEG inspection, Muse Image generation through Meta at a visible `$0.01`
  per-image estimate, IPC, an Illustration dialog, an attached image below the chapter and DOCX
  embedding with the prompt as a caption. The dialog’s missing-connection, attached-image, generation,
  attach and SAM-match states are covered under happy-dom.
- Added specs 019 and 020 for illustrations and SAM 3.1 cutouts, including the documented Meta
  endpoints, the mask grammar and the renderer-side compositor plan.
- Added the standalone `bookwriter` toolkit (spec 018): a loopback-only desktop backend with a per-run
  token, a CLI for info/books/read/search/conflicts/create/save, and an MCP stdio server whose read
  tools are on by default and whose write tools require `--allow-writes`. Saves carry the version and
  hash from the read and use the existing conflict path.
- Added Muse Voice Transcribe dictation (spec 017): a Meta ASR service in the main process, strict
  mono 16-bit PCM WAV validation, browser-side decode/resample/encode, a microphone button with a
  ten-minute cap, and insertion at the editor caret through the normal save path.
- Added background agent turns: an opt-in per-turn flag, an outcome callback after finish, failure,
  stop or approval pause, native notifications with a short preview, a dock badge and focus-on-click.
  Destructive approvals still wait for the author.
- Recorded the Meta participant guide in `hackathon/EVENT.md`: the full schedule and Discord channels,
  the four-person team cap, the open-source and event-only-work rules, the anti-project list, the $150
  credit and partner offers, the three-stage judging rubric, both prize tracks and the bonus prizes, and
  the submission requirements including the three-minute demo video.
- Added spec 009 for desktop packaging, signing, notarisation, release provenance and the gated
  update path; D-115 keeps signing and updates deferred.
- Added the automated-verification plan and task ledger for spec 012, covering the existing Bun,
  smoke, browser-matrix, gallery and key-check evidence and the remaining lint, coverage,
  accessibility, performance, security, CI and live-provider gaps.
- The browser storage harness reloads a saved OPFS library in the same tab and verifies the chapter,
  alongside the picker and two-tab checks. Chromium passes 16/16 real-browser checks.
- The browser storage harness now covers picker cancellation, a denied folder re-grant that keeps the
  pending folder, and two-tab Web Lock serialization. Chromium passes 15/15 real-browser checks; the
  native picker and real Safari/Firefox remain open.
- The writing agent now treats manuscript, Story Bible and tool text as untrusted data: the prompt
  wraps it in a labelled block and tool descriptions mark returned text as data.
- The chat composer can choose a model for the next message only. The runtime validates it, records
  it on the turn, and leaves the book default unchanged.
- A turn that pauses for approval stores the request on its assistant message. Reloading the
  conversation shows the same Allow/Deny card; allow, deny and stop update the stored decision, and a
  request left by a closed app reports that it expired when answered.
- A context-overflow error now names the model's context limit and offers **Choose a larger model** and
  **Start a new conversation** instead of a dead-end retry.
- The assistant message stores a per-section estimated context breakdown (instructions, book, outline,
  characters, memories, chapters, active chapter and conversation) and the chat shows it in a closed
  Context disclosure.
- The turn usage line now shows input tokens as a percentage of the selected model's context window
  when the catalogue reports one; the context length is stored with the assistant message and usage.
- The chat can start a new conversation and list stored conversations in a history dialog; choosing
  one reloads its messages and checkpoints. Conversations can be renamed inline, branched from an
  assistant turn into a new thread, or deleted behind an explicit confirmation. The smoke run now
  covers the new/history controls (16/16).
- OpenRouter's reported final-step cost is read from provider metadata and shown per turn; a missing,
  negative or non-numeric value stays unknown instead of becoming zero. Other providers stay unknown.
- Tool activity now carries its input and output, and the chat keeps the main line plain while a
  closed Details disclosure shows the raw call and result. The stored-message conversion moved to
  `packages/app/src/lib/chat-view.ts` with tests.
- Added a provider-registry contract suite: every provider has a complete entry and unique hosts,
  keys stay in headers, base URLs are normalized, provider catalogue payloads parse consistently, and
  model capabilities and selection never guess an unreported field.
- Moved the studio shell into `packages/app`: `App`, views, product components, hooks and renderer
  utilities. The desktop renderer keeps a one-line re-export; the web imports `@ai-book-studio/app`
  directly, and the `@renderer` alias is gone from the build and typecheck configs.
- Moved the Liquid Glass stylesheet and generated tokens into `packages/ui/src/styles/`; both build
  entry points import `@ai-book-studio/ui/styles/base.css`. `build:info` now checks the app, core and
  UI package versions too.
- Added `merge_chapters`: merges adjacent chapters into the first, pauses for approval, and records the
  deleted chapter in the checkpoint so undo recreates it in its original position.
- Added `split_chapter`: splits a chapter at a 1-based line into two ordered chapters. It pauses for
  approval and records the created chapter in the turn checkpoint, so undo removes it as well.
- Added `insert_at_line`, `delete_lines_in_chapter` and `move_chapter` to the writing agent. Line
  delete and chapter move pause for approval; line insert and delete are checkpointed, while a move
  changes chapter order only.
- Added `overwrite_chapter` and `delete_chapter` to the writing agent. Both pause for the author's
  approval; overwrite is checkpointed and undoable, delete moves the chapter to the trash.
- Added the first approval-gated agent tool: `remove_memory` now pauses the turn with an Allow/Deny
  card, resumes with a `tool-approval-response`, and passes a denial back to the model. The pause and
  denial are covered by mock-model tests; ADR 0014 records the protocol.
- Added a model-factory seam to `AgentRuntime` and two contract tests using AI SDK mock models: a full
  text turn persists its thread and usage, and a tool call runs through the same `ToolLoopAgent`.
- Added `compactHistory`: the runtime keeps the last six user turns verbatim and summarizes older
  tool activity before sending, while the stored thread remains complete. This closes 002 FR-030.
- Added `find_in_chapter`, `find_in_chapters` and `update_memory` to the writing agent. Search returns
  line numbers and matching text; memory updates keep the Story Bible current without removing a
  memory (removal still needs the approval flow).
- Added the `hackathon/` folder with the Meta Global AI Developer Hackathon brief, the AI Book Studio
  Meta Edition plan and the 10-day milestones.
- The writing agent now stores each turn under `books/<bookId>/threads/` and the chat reloads the
  latest conversation. A failed turn keeps its user message for Retry; a stopped turn keeps its
  partial text, reasoning and tool parts.
- Adopted the Apache License 2.0 (`LICENSE`, `NOTICE`) and declared it in every workspace package.
- Added the canonical agent message/thread format in `packages/core/src/agent/` and a `ThreadStore`
  over the shared library port, with 8 tests. Conversations have a file format under
  `books/<bookId>/threads/`; the runtime and chat do not write it yet. Recorded in ADR 0013 and
  `docs/FORMAT.md`.
- The writing agent now reads the Story Bible: the prompt carries saved memories and each character's
  description, motivations and notes; `read_story_bible` returns the full bible; `update_character` can
  change motivations and notes; and a snapshot plus a 4,000-token budget test guard the prompt. The
  worst-case fixture is 3,384 tokens.
- Added `docs/AGENTIC-COVERAGE.md`, an audit of specs 002/011/012 against the agent runtime: 19
  requirements implemented, 5 specified but missing, and conversation persistence, approvals, context
  assembly, injection safety and agent evals unspecified. Corrected the stale known-gaps list in
  `AGENTS.md`.
- Added T014's shared-component gallery at `apps/web/check/gallery.html`. It renders the shared Button,
  Brand, Notice and Dialog, compares browser-storage and folder disclosures, and was measured in light
  and dark at phone, tablet and desktop sizes. Also taught the web stylesheet to scan `packages/ui`.
- Moved `Brand` and `Notice` into `packages/ui`; the desktop renderer re-exports them, and the web
  welcome imports the shared Brand and Button instead of the `@renderer` alias.
- Added the first `packages/ui` extractions: `Button`, `Dialog` and `cn` now live in the shared package,
  the desktop renderer re-exports them, and both apps depend on the package. Remaining components and
  the visual check page are still open.
- Added `bun run smoke:packaged`: it builds the unpacked macOS app, starts the packaged binary with a
  throwaway profile and fixture library, and runs the full hidden suite against it. Passed 16/16.
- Added a Playwright cross-browser matrix for the real storage harness: Chromium passes 12/12, including folder mode through a picked OPFS handle; Firefox
  and WebKit OPFS openings are recorded findings. Browser storage now times out after five seconds and
  tells the author to choose a folder or export an archive instead of waiting indefinitely.
- Added unit coverage for the cross-tab Web Lock request and its no-lock fallback; the real-browser
  two-tab matrix remains.
- Completed the mobile accessibility pass: touch controls, accessibility labels and visual order on the
  iPad mini shell, reduced motion/transparency enabled and relaunched, and a web smoke check that
  emulates both media features and asserts no transition duration or backdrop filter.
- Added browser OpenRouter sign-in: a same-origin popup with PKCE and checked state, code exchange,
  storage in the browser vault, and list/remove in Settings. The live browser-access pass remains
  T040/T041; manual keys and the other providers stay gated.
- Added unit coverage for browser capability detection and persistence denial, unsupported and failure
  paths; the real-browser Playwright matrix remains.
- Added browser permission-recovery tests: a re-granted folder opens as `folder://`, and a denied
  re-grant keeps the folder pending without switching storage tiers. All T026 browser journeys now have
  automated coverage; the real-browser picker matrix remains T013/T027.
- Added a browser folder-mode integration test: a picked fake folder opens as `folder://`, creates a
  book and chapter, and saves through the shared library service.
- Added the browser credential vault (D-105): an origin-scoped IndexedDB store that returns summaries
  without secrets, supports touch/remove/re-open, and shows a Settings disclosure that it is not the OS
  keychain and can be cleared with site data. The browser OpenRouter flow stores its connection here.
- Added a DOM test for the browser archive import picker, covering both a selected archive and a
  cancelled picker. The core import path and the web export journey remain covered separately.
- Added a real DOM component-test setup (happy-dom and Testing Library) and editor tests for the 700 ms
  autosave debounce and the conflict state. The legacy import is recorded as delivered with its parser
  and importer tests.
- Chapters can be dragged to a new position in the rail. The move renumbers only the affected orders,
  checks both versions and hashes, rolls back a conflicting write, and is covered by the hidden smoke
  run. The rail buttons and keyboard move remain.
- Documented the sync journal, read-only scanner and drift detector, the two-system harness results and
  the D-124 device-identity caveat in the architecture and decision records. No drift UI or app lock has
  shipped; both remain behind D-121–D-124.
- Verified the iPad mini rotation path in the Capacitor shell: a chapter keeps its selected state, typed
  text and `Saved` status across portrait and landscape. The procedure, accessible names and remaining
  VoiceOver/reduced-motion checks are recorded in `docs/research/mobile-layouts.md`.
- Undo and redo now survive switching chapters. The editor keeps a per-chapter in-memory history,
  coalesces a typing burst into one step, clears it when the disk version is refreshed, and the hidden
  smoke run switches chapters and undoes the typed marker.
- Each agent turn records its provider, connection label and model id with its usage, and the
  conversation shows the model when it changes between turns.
- The studio now notices changes made outside it. The desktop filesystem port watches `books/**` and
  `.studio/trash/**`, the main process debounces them into one event, and the workspace offers a refresh
  that flushes unsaved text before reloading the chapter. Chapters can also move with ⌘⌥↑/⌘⌥↓
  (Ctrl+Alt on Windows) beside the rail buttons.
- Added browser smoke journeys for a stale-save conflict and a portable archive export, plus fake-handle
  tests for folder-picker cancellation and permission mapping. Updated the storage architecture/format
  docs and the spec 011 web tasks to record the landed storage boundary and the remaining decisions.
- Added shared build metadata and a capability table. Settings → About now reports the target, version,
  commit, format version, platform, storage and whether each capability is available, with a reason for
  every unavailable one. Vite and electron-vite inject the same version and commit as `bun run build:info`.
- Added one build-info source (`bun run build:info`) for version, commit, schema and target; it fails when
  the workspace package versions disagree. Desktop artifacts now carry the product, version, OS and
  architecture in their names. Added a deployment, promotion and five-minute rollback runbook, a Gitea
  verify workflow, and an honest README note that no runner is registered yet.
- Chapters can be moved up and down from the chapter rail. The move swaps order metadata only, leaves
  file names in place, checks both chapters' versions and hashes, rolls back a half-applied move, and is
  covered by the hidden smoke run.
- Added the two-system sync harness and read-only library scan from spec 016 (T004–T005). The scan hashes
  `books/**` and `.studio/trash/**`, probes online-only placeholders before reading, skips provider sidecars
  and transient files, and reads book schema and chapter identity from the same bytes. Ten scenarios cover
  clean propagation, concurrent and offline edits, deletion/tombstones, placeholders, interrupted copies,
  corrupt journals, repeated scans, provider conflict copies and renames. The harness found and fixed a
  detector bug where a chapter moved to the trash was paired as a rename instead of a deletion.
- Added the sync baseline and read-only drift detector from spec 016 (T001–T003): a per-device journal
  with tombstones, rename pairing, placeholder/unreadable/newer-schema reporting, and 14 tests. No UI or
  provider integration yet.
- Captured spec 016, sync and device trust: two-device folder sync, read-only drift detection with
  tombstones, an optional Face ID/Touch ID or keychain-PIN app lock, and a two-system transport harness.
  No sync code ships yet; decisions D-120–D-123 are open.
- The browser build now reports its storage summary through `LibraryInfo`, including the tier,
  persistence and the last confirmed save time, and Settings shows it with the browser warning.
- The browser build keeps unsaved chapter text in a draft buffer and flushes it once when the page
  is hidden. The flush reports `confirmed`, `conflict`, `unconfirmed` or `empty`; a write that does
  not land is never reported as saved, and the held text stays available.
- Books can be renamed and moved to the library trash from the library grid. Deletion preserves the
  whole folder under `.studio/trash/books/<timestamp>-<bookId>/`; the browser build moves the folder
  through the same storage port, so a deleted book survives in site storage and in archives.

### Fixed

- Speech says the words, not the Markdown. Emphasis, links, images, headings, lists, tables, rules and
  code fences are converted before anything is spoken, by the spoken answer, read-aloud and the device
  voice alike (`packages/core/src/speech-text.ts`). The stored text is never changed.
- Provider names and connection ids now share Zod schemas between the core contract and the IPC
  boundary; malformed connection ids and unknown providers are rejected in tests.
- The credential vault repairs a world-readable file to owner-only permissions at startup and reports
  when the platform cannot confirm the mode. A scan test proves a stored connection leaves no plaintext
  secret in `studio.json` or the library.
- Browser saves now re-check the target hash immediately before the commit point and abort the swap file
  when another tab or folder writer changed the file. A read-back hash mismatch is reported as a conflict,
  never as saved. Injected permission, read-only, quota, interrupted-close and concurrent-edit tests assert
  that the previous bytes stay intact and the author's text survives in a conflict copy.
- A chapter whose title contains `conflict` is no longer hidden from the chapter list or treated as a
  provider conflict copy. The rule now matches only `.conflict-<reason>` and `(conflicted copy)` names,
  and the library and the sync scan share it.
- In the browser build, a successful save no longer discards newer draft text that was typed while
  the save was in flight; the draft is cleared only when its content is the content that was written.
- A failed agent turn keeps its original prompt and history for an explicit retry. Auth failures also
  offer Reconnect, which opens Settings on the provider-connections section without clearing the turn.
  Partial writes are checkpointed before the error is shown, and retry waits until the author undoes
  the changed chapters. The hidden smoke run covers the no-model retry path.
- Settings is now reachable from the workspace, from both the header gear and the phone More
  sheet. The old Connections dialog became a shared Settings surface covering appearance,
  provider connections, and where the library lives, and the Library gear is labelled Settings.
- The workspace save state shows a short text label at every width instead of only a coloured
  dot. The chapter delete action is visible on touch instead of hover-only. Settings and Story
  Bible keep Done/Save visible while their bodies scroll. Recorded in
  `docs/research/ui-audit-2026-10-25.md`.

### Added

- Added the Capacitor iOS shell (`apps/mobile`) around the real web build. It runs on the iPhone 17 Pro
  and iPad mini simulators with no native plugins, honors safe-area insets, and hides or explains
  actions WebKit cannot support instead of failing at the moment of use. `bun run ios:iphone`,
  `bun run ios:ipad` and `bun run ios:pair` build and open the devices.

- Polished the web shell: a plain-language storage welcome, and a phone-width library card that no
  longer wraps onto a third metadata line.
- Added the `apps/web` static shell: the real renderer runs in a browser with a storage-choice welcome screen, OPFS or chosen-folder libraries, archive import/export, and desktop-only actions explained instead of failing silently. `bun run build:web` emits `apps/web/dist`, and `bun run smoke:web` drives the built app in a hidden Chromium window (6/6 checks).

- Added a browser storage self-check harness at `apps/web/check/` that runs the real OPFS adapter, checked saves, a stale-save conflict, archive round-trip and IndexedDB in a browser and reports pass or fail without touching an author library.

- Added browser archive I/O: export streams into the browser's save picker when one exists and otherwise downloads a Blob; import reads a chosen File twice, so the core validator can check every path and hash before writing. No archive byte or credential is sent to a server.

- Added the browser storage layer in `apps/web`: one `LibraryPort` over a browser directory handle serves both chosen folders and OPFS; IndexedDB keeps only the handle and library id; folder permission, persistence, quota and cross-tab lock state are reported through the shared storage summary.

- Added library archive actions to the desktop library view: export writes a complete ZIP beside the chosen file and only replaces an older export after success; import validates the archive, requires an empty destination, never merges into the open library, and opens the imported library on success.

- Added the portable library archive in `packages/core`: a versioned, hash-validated ZIP manifest; streaming export that excludes credentials, catalogs, device identity, temporary and lock files; and a two-pass import that validates every path, size and hash before writing, refuses a non-empty destination and cleans up its own partial writes.

- The hidden smoke runner now reads the app's machine-readable result, so a passing run is not reported as a timeout when Electron closes the window but leaves the main process alive (recorded as a known issue in spec 012).
- Moved the library rules into `packages/core`: `LibraryService`, validated library-relative paths and the `LibraryPort` contract now own checked saves, conflict copies, trash, search and the derived catalog. `apps/desktop/src/main/library/fs-port.ts` is the reference filesystem adapter and `store.ts` is a thin facade, so the desktop IPC surface and its tests are unchanged. The in-memory conformance suite covers external edits, stale versions, trash/restore, newer schemas and failed writes.

- Added spec 010 for the browser storage/portable archive prerequisite, including a researched decision for browser credentials and the archive format, and a task plan that records the missing storage-port implementation instead of assuming ADR 0009 is already landed.
- Added the first target-neutral `LibraryPort` contract, validated relative/archive paths and in-memory tests for compare-before-write, byte isolation, directory listing and non-overwriting moves.
- Corrected the architecture status: the port contract exists, but shared library logic and production adapters are still pending in spec 010.
- Added plan and task tracking for spec 014; the 44px touch-target audit, safe-area work, orientation checks and real Capacitor renderer integration are now explicit open tasks.
- Finished the spec 014 touch-target pass: coarse-pointer layouts enlarge hit areas without changing icon size, the chapter delete action is reachable without hover, the agent Send button no longer overflows at 393px, long library paths truncate, and tall dialogs scroll inside the viewport.
- `capture.mjs --coarse` now emulates touch and fails on any visible control below 44 × 44 or on horizontal document overflow; the measured audit is recorded in `specs/014-mobile/checklists/touch-targets.md`.

- Model access, Phases 1–4 of spec 011: the provider contract and static registry (OpenRouter, OpenAI,
  Anthropic, Gemini, Meta with browser-access status), catalogue freshness and merge rules,
  `capabilitiesFor` with explicit unknown, `normalizeProviderError` (including `Retry-After`) and
  redaction for keys, bearer headers and query strings. `packages/core/tests/providers.test.ts` covers
  the contract.
- Desktop provider layer: a testable `FileCredentialVault` behind the operating system's protected
  storage (`userData/credentials.json`, `0600`, no plaintext), an OpenRouter loopback sign-in with PKCE
  S256, state checking, a ten-minute timeout and cancel, code exchange, labelled connections, a cached
  model catalogue and a key test. The Connections dialog connects, tests, lists models and removes a
  connection, and refuses to save when protected storage is unavailable. D-104 is accepted for desktop.
- Direct API keys for OpenAI, Anthropic, Gemini and Meta: the key is validated against the provider
  before it is stored, a rejected or unreachable key is never saved, keys travel in headers rather than
  query strings, Meta's base URL is configuration, multiple labelled accounts per provider are allowed,
  and removing a connection drops its secret and cached catalogue together.
- Optional provider, connection and model fields on `book.json`; books written before them still parse.
- Model selection per book: a turn override wins, then the book's saved choice, then the first usable
  connection. A saved model that can no longer run the agent falls back and explains why. The model
  picker lists every connection's models with context size and price, searches them, disables models
  that cannot use tools with a one-sentence reason, and warns when the saved model has vanished.
- The renderer's content security policy now allows only local connections. Model requests and keys
  stay in the main process, and a test fails if a registered provider host appears in the policy.
- A single transport module builds the AI SDK model for every provider: OpenRouter, the native OpenAI,
  Anthropic and Gemini factories, and Meta through an OpenAI-compatible client with its configured base
  URL. Nothing else in the app constructs a provider client.
- Usage is recorded per turn in `.studio/usage/<bookId>.jsonl` with reported or estimated cost. Cost is
  labelled reported, estimated, included in a plan, or unknown; an unknown cost never appears as $0.00.
  A usage summary channel reads the file without ever uploading it.
- Provider errors are normalised to auth, rate limit, quota, context, refusal, offline or unknown, with
  the provider's retry delay carried through.
- The first writing-agent loop: a `ToolLoopAgent` in the main process reads the book, the chapter list
  and the active chapter into a compact prompt, then edits through five tools (chapter list, read a
  chapter, count words, replace one unique passage, append text). Each edit goes through the same
  version-and-hash save protocol as the editor, so a conflict becomes a refusal rather than data loss.
  The chat panel streams text and tool progress, can stop a turn, and reloads the manuscript when the
  agent finishes. A turn's usage is appended to the book's usage file.
- The Story Bible: one dialog edits the book's title and description, genres and influences,
  outline, the three-act story arc, the cast and saved memories, all through the same book update
  channel and validated schema.
- A turn that edits chapters writes a checkpoint before its first change. The chat offers “Undo this
  turn”, which restores every chapter the turn touched through the same version and hash save
  protocol; checkpoints live under the book's `.studio/checkpoints` folder.
- The writing agent can also shape the book: it creates chapters, updates chapter titles, synopses
  and purposes, revises the book's description, outline or genres, keeps characters current and
  saves short memories. All of these go through the same book and chapter store.
- Export to Word: a book becomes a `.docx` with a title page, a page break per chapter, and the
  manuscript's font, size, line spacing and first-line indent, written atomically to a location the
  author chooses.
- Legacy import: a backup from the earlier app becomes books, chapters, characters, memories and
  manuscript settings in the open library. Chapters keep their text, the old conversations are left
  behind, and a damaged book is reported instead of stopping the rest.
- Book search: a search window finds matching lines across every chapter, ignores case, and opens
  the chapter from a result.
- Mobile path recorded: Capacitor for the iOS and Android shell, Expo Simulators or the Device hub for
  device testing. Expo is not adopted as the app framework (D-117, D-118).
- Local iOS simulator ready: Xcode 26.6 installed the iOS 26.5 runtime, iPhone 17 Pro boots and
  screenshots, and `Simulator.app` opens. Device hub agent access still needs to be enabled for the
  T3 simulator tools; `simctl` works without it.
- Capacitor shell spike: Capacitor 8.5.3 built through Swift Package Manager and launched a bundled
  page on the iPhone 17 Pro simulator, proving the WKWebView path without Expo or React Native. The
  real renderer and the Filesystem, SQLite, Keychain and iCloud plugins wait for spec 010. Recorded in
  `docs/research/capacitor-ios-spike.md`.
- Mobile-first layouts for the iPhone (393 × 852) and iPad mini (744 × 1133): a compact header, a
  bottom action bar, a chapter drawer, a full-screen agent sheet and a two-pane tablet workspace.
  The 700px and 1000px breakpoints, responsive manuscript type and dialog widths are recorded in
  `docs/DESIGN.md`; spec 014 defines the acceptance criteria and D-119 records the reference devices.
  Captures are in `docs/research/mobile-layouts.md`.
- A capture harness for the real renderer: `STUDIO_WINDOW_SIZE` and `STUDIO_CAPTURE` in the main
  process, plus `bun run capture:run 393x852 out.png` and an optional selector to open a book or panel.
- 107 tests pass (13 library, 26 provider contract, 5 credential file, 13 provider flow, 5 selection,
  2 content security policy, 4 transport, 6 usage contracts, 5 usage storage, 8 agent tools and
  prompt, 5 checkpoints and undo, 5 planning tools, 2 export, 4 legacy import, 4 search).
- `docs/DECISIONS.md`: a decision register with 16 settled decisions and 16 open ones (D-101…D-116),
  each naming the evidence needed and the spec or task it blocks, plus the rule that a spec relies only
  on an accepted decision or a stated assumption.
- Plan and tasks for spec 013: the six-phase workspace, packaging, shared UI, web target, environments
  and CI sequence (T001–T021), with T001–T012 complete.
- Packaging spike: `bun run package:dir` builds `release/mac-arm64/AI Book Studio.app`, and the packaged
  binary passes all five hidden smoke checks against a fixture library, including a saved edit. The
  build is unsigned and uses the default icon, as expected for this stage.
- Hidden test runs: `STUDIO_TEST`, `STUDIO_HEADLESS` and `STUDIO_SMOKE` launch an off-screen window
  with its own profile, and `bun run smoke` drives the real UI through the preload bridge, the library,
  opening a book and an autosave reaching the disk.
- Spec-driven record: `.specify/memory/constitution.md` with seven principles, `specs/README.md` with
  the roadmap, and `specs/001-foundation/` (spec, plan, tasks) describing the foundation as built.
- `docs/ARCHITECTURE.md` (process split, save protocol, sync model, testing seams) and
  `docs/DESIGN.md` (Liquid Glass rules, type scale, voice, accessibility checklist).
- ADRs 0001–0006: local-first Electron, Markdown as source of truth, user-chosen sync folder, token
  pipeline, spec-driven development, and AI calls plus secrets in the main process.
- White-room product specification `specs/002-studio-v1/` covering writing, the Story Bible, the agent,
  import and migration, voice, illustrations, export, sync and trust (76 requirements, 16 measurable
  outcomes), with its quality checklist.
- Import specification `specs/003-earlier-studio-import/` for an earlier studio's JSON export, mapped
  book by book, with idempotency, atomic publication, a migration report and rollback.
- `docs/FEEDBACK-DISPOSITION.md`: all fifty inherited defects (F-001…F-050), nineteen follow-up themes
  and fifteen unresolved design decisions given a disposition and a target requirement.
- Browser build requirements in spec 002: one shared book format, real-folder access in Chromium,
  origin-private storage in Safari and Firefox, explicit degraded guarantees, direct provider calls,
  and archive portability (FR-071…FR-076, SC-015, SC-016, user story 10).
- `docs/adr/0009-multi-target-storage.md`: the core/port/adapter design, the verified File System Access
  and OpenRouter CORS facts, and the three storage tiers. Electron becomes one adapter rather than the
  owner of the format.
- Harness evaluation appended to ADR 0007: `@ai-sdk/harness` cannot run in a browser, would bypass the
  save protocol, and is experimental, so harness runtimes are deferred behind the runtime seam.
- `docs/adr/0010-bun-and-workspaces.md`: Bun as package manager, task runner and test runner; a Bun
  workspaces layout for desktop, web, core, UI and shared config; Electron keeps its Node runtime and
  builder/Playwright stay on Node. Electrobun rejected for v1.
- Deep specs 011 (model access: OpenRouter SSO, provider keys, ChatGPT plan, capability rules),
  012 (automated verification: unit, contract, web and Electron end-to-end, live checks, gates) and
  013 (builds and deployment: shared core, desktop and web targets, staging). Each has a passing
  requirements checklist.
- `.env.example` and `bun run keys:check`, which verifies OpenRouter, OpenAI, Anthropic, Gemini and a
  configurable Meta endpoint without printing key material.
- Spec 011 plan and task list: provider registry and capability rules, a credential vault with desktop
  and web adapters, OpenRouter PKCE connection, API-key validation for four providers, the ChatGPT plan
  phase gated on D-102, model selection and runtime wiring, cost labelling and error recovery, and the
  web-enablement phase gated on spec 010. Forty-two tasks across nine phases.
- ADR 0007 picks the Vercel AI SDK 7 `ToolLoopAgent` with the OpenRouter provider as the agent runtime
  (rejecting the OpenRouter Agent SDK, OpenAI Agents SDK and Claude Agent SDK); ADR 0008 makes the
  one-way import through the export file.
- Spec Kit initialised for OpenCode with the `git`, `agent-context`, `bug` and `assess` extensions;
  `/speckit-*` commands are available in `.opencode/commands/`.

## [0.1.0] — 2026-10-24

The first foundation: a local-first studio that opens a folder of files, writes chapters atomically,
and shows them in the Liquid Glass interface from the design kit. No agent, exports or packaging yet.

### Added

- Electron 45 application scaffolded with electron-vite, React 19, Tailwind 4 and TypeScript.
- Library format: `book.json` per book, one Markdown file per chapter with YAML front matter, and a
  derived `library.json` catalog that is never read as truth.
- `Library` store with create/read/update for books, chapters and chapter metadata; chapter order,
  slugged file names, deterministic fallback ids for files written by other tools.
- Atomic writes (temp file, fsync, rename, retry for Windows sharing violations) and per-book write
  serialization.
- Optimistic concurrency: every save carries the version and SHA-256 hash it was based on. A newer
  version or an edited file produces a conflict copy in `conflicts/` instead of an overwrite.
- Draft buffer in the main process, flushed on window close and on quit.
- Deleted chapters move to `.studio/trash/<bookId>/` rather than being unlinked.
- Schema versioning that refuses files from a newer app with an explicit "update the app" error.
- Typed IPC contract (`src/shared/ipc.ts`) with a `Result` envelope and Zod validation on every
  channel; context isolation, sandboxed renderer and a restrictive CSP.
- Design tokens generated from the local design kit (`design/tokens.json` → 38 primitives,
  96 semantic colors) plus the glass, window-wash and manuscript styles.
- Welcome, Library and Workspace views: 248 px chapter rail, 760 px manuscript sheet, save status,
  conflict banner with "Show the saved copy" and "Load the version on disk", theme cycle.
- 13 Vitest tests covering the format, atomic saves, conflicts, trash, schema rejection and path
  safety.
- electron-builder configuration for macOS (dmg, zip), Windows (nsis) and Linux (AppImage), with
  hardened-runtime entitlements.

### Notes

- This repository starts fresh. It replaces an earlier local prototype and shares no history, no
  Next.js server and no localStorage library.
