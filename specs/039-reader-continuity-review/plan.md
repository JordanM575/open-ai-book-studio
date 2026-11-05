# Plan: structured reader and continuity review

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Approach

Reuse 037's foreground provider-disclosure and read-only execution boundary, 034's saved-source
evidence concepts and 011/022's configured connections. Do not merge their user-visible report types.
Define studio-owned finding/profile/run contracts in `packages/core`; provider output is untrusted
and validated at the runtime edge. `packages/app` owns scope selection, findings, citation navigation,
stale/incomplete states and rerun comparison. Confirm concrete modules during implementation.

Capture immutable selected-source snapshots through existing library reads. Bind quotations to that
snapshot, then compare revisions before declaring currency. No additional read tool may escape the
approved scope. Credentials remain in the provider service; no renderer access or new network route.

## Sequence and gates

Resolve U-039-01/02 before schema and comparison work; U-039-04 before multi-book request assembly.
Deliver a single-book volatile report first. Add cross-book inputs only through explicit selection;
030 is needed only when its proposed planning records are included. Existing manuscript sources do
not wait for all of 030. 036 remains advisory and is not a dispatch prerequisite.

Resolve U-039-03 and D-171 before planning any persistence implementation. This plan adds no file
format. If approved later, amend docs/FORMAT.md, add a storage ADR, checked Library writes, conflict,
retention/deletion and recovery tests before implementing saved reports.

## Verification

Mock provider boundaries; use temporary synthetic multi-book fixtures. Test payload equality to
disclosure, pre-start known/unknown price and data-use/training terms, missing-consent zero-call
refusal, pre-send cancellation, hostile book/profile content, tool rejection, schema/quotation
validation, stale sources, attribution, overflow, failure and stop. Hash manuscript files before and
after every outcome. Verify keyboard/theme, reduced-motion/transparency states and unsupported-host
refusal in the built app.
Run relevant tests, typecheck and hidden smoke on the integrated commit; semantic critique quality
needs separately agreed evaluation and is not established by quote matching.
