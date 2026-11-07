# Plan: structured reader and continuity review

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

**Status:** In progress. D-193 / ADR 0018 and D-197–D-199 / ADR 0020 accept the initial and expanded
contracts. Pure envelope/citation/profile/overflow leaves are implemented; independent correction,
actual runtime/UI integration and persistence acceptance remain separate.

## Approach

Build on 037's planned foreground provider-disclosure and read-only execution boundary, 034's saved-source
evidence concepts and 011/022's configured connections. Do not merge their user-visible report types.
Reuse envelope/citation/execution contracts only: the 037 conversation-retention and thread-safety
prerequisite does not gate volatile 039. Keep all 039 snapshots, profiles and results in memory with
zero ThreadStore/report-writer calls on start, finish, stop and failure.
Define studio-owned finding/profile/run contracts in `packages/core`; provider output is untrusted
and validated at the runtime edge. `packages/app` owns scope selection, findings, citation navigation,
stale/incomplete states and rerun comparison. Confirm concrete modules during implementation.

Reuse 037's source/execution contracts, not its persistence policy. Structured 039 runs keep their
snapshots, profiles and results volatile and write no conversation payloads. Their first volatile
slice does not depend on 037's thread-safety work; only durable 037 integration needs that prerequisite.

Capture immutable selected-source snapshots through existing library reads. Bind quotations to that
snapshot, then compare revisions before declaring currency. No additional read tool may escape the
approved scope. Credentials remain in the provider service; no renderer access or new network route.

## Sequence and gates

Apply accepted D-193 / ADR 0018 for U-039-01/02/04. U-039-04 remains a prerequisite of T003's selected-source
request assembly as well as T006's multi-book work; single-book input can overflow too. The proposed
first delivery is a single-book volatile report, after those gates. Add cross-book inputs only through explicit selection;
030 is needed only when its proposed planning records are included. Existing manuscript sources do
not wait for all of 030. 036 remains advisory and is not a dispatch prerequisite.

U-039-03/D-171 are resolved by ADR 0020. Add detailed FORMAT/continuation schemas before implementing
immutable explicit saves, checked separate dispositions/profiles/campaigns and related-file recovery.
No new persistence is inferred for the unsaved run. Saved quotes travel with archive/sync.

T010–T019 order the expansion: corrected scoped boundary → pure exact-source/overlap contracts →
minimal CodeMirror adapter preserving the current editor/save owner → accessible mounted review →
explicit recoverable storage → author-invoked checked suggestion → all-range campaign/coverage →
037 scheduler integration and exact-candidate evidence. W08 owns concurrent Library/API/Workspace
edits until its bounded planning integration returns; editor leaves expose injected contracts first.

## Decision work before implementation

| Question / task | Required decision packet | Evidence that distinguishes alternatives |
| --- | --- | --- |
| U-039-01 / T002 | Finding fields, source-location representation, exact versus normalized quote matching, relation to U-037-02 | Synthetic repeated passages, Unicode/line endings, invented quotes, wrong book/revision and missing sources. Document which findings are withheld and why; never select a plausible replacement passage. |
| U-039-02 / T002 | Reader identity/version, editable profile scope, what two runs may compare and how input changes are labelled | Two profiles across two source revisions; changed profile text cannot relabel an earlier run. Separate changed evidence from changed model interpretation. |
| U-039-04 / T003/T006 | Explicit source bounds and overflow/refusal behavior for single- and multi-book inputs, with optional planning inclusion | Oversized one-chapter and multi-book fixtures; payload inventory must match disclosure. Compare smaller-scope refusal and any proposed reduction policy without accepting silent truncation. |
| U-039-03 / T007 | Whether D-171 applies, excerpts/profile retention, deletion, export and archive/sync implications | Compare volatile-only and recoverable saved-report alternatives. Do not inherit 034's proposed numeric cap or a new storage directory by assumption. |

The proposed single-book exemption from U-039-04 was rejected in D-193. T003 uses the accepted shared
bounds/refusal policy. The decision packets below record the original questions and evidence still
needed from implementation; D-193, not those earlier alternatives, supplies the selected contract.

## Delivery checkpoints

1. **Contract inventory (T001):** map existing 034 snapshot/evidence types and 011/022 consent to
   037's unfinished read-only boundary. Name the modules actually reusable and the missing contracts;
   keep 034 metrics, 037 conversation and 039 findings separate in the interface and test inventory.
2. **One selected-source report (T002–T004/T008):** after acceptance of the schema/profile/overflow
   decisions, disclose captured text, provider/model, profile, terms and known/unknown cost. Enforce
   the selected-source boundary at execution, not just the picker. Exit only when cancel/absent consent
   sends nothing, hostile content cannot widen scope and valid quotations navigate to their snapshot.
3. **Explicit reread (T005):** retain both volatile runs with their identities and source/profile
   versions. Recheck currency without refreshing content or sending a request automatically. Exercise
   changed/deleted chapters and malformed provider output before comparison is described as available.
4. **Cross-book continuity (T006):** require a visible inventory of each included book and source kind.
   Existing manuscripts do not require 030's new records; adding those records waits for their accepted
   schema/scope. Findings must identify missing evidence rather than invent a continuity conclusion.
5. **Acceptance (T007–T009):** keep persistence out until separately approved. Run the built-app
   disclosure/navigation/stop/refusal journeys and record exact-head results. A quote-valid report
   still needs a separately agreed quality evaluation; transport tests do not prove useful critique.

## Verification

### W10 core evidence (2026-11-07)

`packages/core/src/review/{contract,sources,envelope,facade,profiles,wire-schema,findings}.ts`
implements the accepted pure contracts. T002's finding/profile/version/run types, validators and
synthetic tests are delivered. T003–T006 have reusable core portions but their whole runtime/UI
tasks stay open. The existing 034 deterministic implementation remains separate; 037 uses a guided
envelope rather than the 039 findings type. No new store, caller authority or provider exists.

The focused source, envelope and reader test files under `packages/core/tests/review/scoped-*.test.ts`
exercise sentinel exclusion, exact spans, byte/scalar/count boundaries, immutable attribution and
invalidation. [`SCOPED-CONTRACTS.md`](../../packages/core/src/review/SCOPED-CONTRACTS.md) records APIs,
resource accounting and the source/consent/runtime/thread-safety/export prerequisites. Built-app,
provider, usability and quality acceptance below remains pending.

Executed W10 checks: 64 focused tests passed (286 assertions, three files); strict focused core
TypeScript check passed; Biome lint passed for the seven source/four test-helper files; completion
documentation validation and `git diff --check` passed. These are pure-contract results, not
runtime/UI acceptance. The attempted wider source-plus-test TypeScript invocation lacked the
repository's Bun test declarations; the successful typecheck is explicitly scoped to core source.

Mock provider boundaries; use temporary synthetic multi-book fixtures. Test payload equality to
disclosure, pre-start known/unknown price and data-use/training terms, missing-consent zero-call
refusal, pre-send cancellation, hostile book/profile content, tool rejection, schema/quotation
validation, stale sources, attribution, overflow, failure and stop. Hash manuscript files before and
after every outcome. Verify keyboard/theme, reduced-motion/transparency states and unsupported-host
refusal in the built app.
Run relevant tests, typecheck and hidden smoke on the integrated commit; semantic critique quality
needs separately agreed evaluation and is not established by quote matching.
