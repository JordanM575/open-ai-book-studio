# Plan: structured reader and continuity review

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

**Status:** Draft / Planned. D-193 / ADR 0018 accepts initial envelope/citation/profile/overflow
contracts; implementation and persistence acceptance remain separate.

## Approach

Build on 037's planned foreground provider-disclosure and read-only execution boundary, 034's saved-source
evidence concepts and 011/022's configured connections. Do not merge their user-visible report types.
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

Resolve U-039-03 and D-171 before planning any persistence implementation. This plan adds no file
format. If approved later, amend docs/FORMAT.md, add a storage ADR, checked Library writes, conflict,
retention/deletion and recovery tests before implementing saved reports.

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

Mock provider boundaries; use temporary synthetic multi-book fixtures. Test payload equality to
disclosure, pre-start known/unknown price and data-use/training terms, missing-consent zero-call
refusal, pre-send cancellation, hostile book/profile content, tool rejection, schema/quotation
validation, stale sources, attribution, overflow, failure and stop. Hash manuscript files before and
after every outcome. Verify keyboard/theme, reduced-motion/transparency states and unsupported-host
refusal in the built app.
Run relevant tests, typecheck and hidden smoke on the integrated commit; semantic critique quality
needs separately agreed evaluation and is not established by quote matching.
