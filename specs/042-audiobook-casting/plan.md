# Plan: narrator and character casting with audiobook creation

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Approach

Reuse 017/038's speech selection seams, 011/022's privileged configured providers and 035's immutable
export concepts. Keep audiobook cast/run contracts studio-owned in `packages/core`; `packages/app`
owns script/cast review, explicit chapter authorization, progress and recovery. Extend existing
Library/port asset operations only after U-042-02; exact filenames await that decision. No direct
renderer filesystem or credential access, independent writer, account or hosted manuscript service.

First implement stock single-narrator auditions, then explicit per-chapter generation, recovery and
export. Optional multi-character assignment follows U-042-01 and must be author-approved. Existing
character IDs may be reused after validation; new 030 records are not required for narrator-only work.
Store exact voice IDs/provider attribution rather than trusting mutable catalogue display labels.

## Gates and failure flow

Resolve U-042-01/03 before sending scripts; U-042-02 before durable assets/restart support; U-042-04
before packaging. Record storage ADR and docs/FORMAT.md with schema/retention/conflict rules before
implementation. Library writes stay atomic/version-hash checked; every output is traceable to its
source/cast run. A manifest is not a promise that the provider produces identical audio on rerender.

Bounded explicit author requests are the initial authority. 036 and D-116 do not authorize hard caps,
automatic routing, retries or fallback. Unknown completion/charge after interruption requires author
review and explicit retry. Do not build an unattended/background job system under this plan; any such
change must pass 037's authority/lifecycle gates separately.

## Verification

Mock speech requests with synthetic scripts and test-tone audio. Test consent payloads, removed
voices, segmentation/attribution, stale snapshots, checkpoint/restart, uncertain provider completion,
partial failures, disk-full, corrupt media, conflicts, redaction and failure-safe packaging. Assert
unchanged manuscript hashes and reuse of valid successful audio without repeat requests. Measure
export properties using independently chosen U-042-04 tools. Run built-app keyboard/theme/refusal
journeys and exact-head tests/typecheck/smoke. Paid auditions, native devices and distributor tests
need separate explicit access/authorization and may not be inferred from fixture evidence.
