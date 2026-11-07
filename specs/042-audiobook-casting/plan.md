# Plan: narrator and character casting with audiobook creation

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

**Status:** Draft / Planned. Expanded November 7, 2026; no casting, generation or packaging implementation claimed.

## Approach

Reuse integrated 038's model/voice preferences and the existing TTS catalog/request/audio helpers,
011/022's privileged configured providers and 035's immutable export concepts. Spec 017 owns dictation
and explicit background turns, and excludes TTS; it supplies no audiobook selection/job system.
Keep audiobook cast/run contracts studio-owned in `packages/core`; `packages/app`
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

## Decision work before implementation

| Question / task | Required decision packet | Evidence to distinguish alternatives |
| --- | --- | --- |
| U-042-01 / T001–T002 | Source/cast/script identities, segmentation, pronunciation and ambiguous dialogue policy | Synthetic narration/dialogue with repeated names, unknown speakers and edits between preview and start. Compare assignment/segmentation representations; none may silently approve a character identity. |
| U-042-02 / T004–T005 | Ordinary-file asset/run layout, checked publication, uncertain-request states, retention/deletion and restart reconciliation | Fault matrix spanning before send, sent/no reply, reply received/no durable audio, audio saved/no finalized record and successful chapter followed by failure. List bytes/metadata retained and the safe next action at each point. |
| U-042-03 / T003/T005 | Allowed stock voices/providers, request limits, disclosed text treatment and bounded authorization | Reconcile with 038's actual local catalog; availability is not implied by a label. Mock removed voices, unknown price, pre-send cancel and partial/uncertain charges. Do not inherit global playback preferences as consent to send a book. |
| U-042-04 / T006 | Output/manifest formats, chapter ordering, incomplete-export policy and measurable audio rules | Synthetic test tones, corrupt/truncated media, missing chapters and independently measured output. Pick tooling/rule versions explicitly; do not infer distributor conformance from a playable WAV. |

## Delivery checkpoints

1. **Approved stock-narrator audition (T001–T003):** after U-042-01/03, select explicit saved text and
   a catalog-valid stock narrator; disclose actual voice/model and text treatment. Cancel sends nothing;
   failed/removed selections never substitute voices. Optional 030 character records are unnecessary.
2. **One durable chapter (T004–T005):** after storage/recovery acceptance, bind source revision/order,
   script/cast version and pronunciation to the generated asset. Publish through checked Library
   operations. In-progress or uncertain output is never reported as complete after restart.
3. **Recoverable multi-chapter run (T005):** make chapter one succeed and chapter two fail, stop or
   lose its reply. Reopen the run, validate/reuse chapter one and require explicit consent for chapter
   two. Show stale audio if source/cast changes; a retry of uncertain work must disclose possible
   duplicate charging. No background batch authority follows from the resume button.
4. **Packaging (T006):** after output-policy acceptance, export ordered validated assets with source,
   voice/provider and generated-audio disclosure. Independently measure required audio properties;
   handle partial exports according to the accepted policy and preserve prior destinations on failure.
5. **Optional character casting and acceptance (T002/T005/T007):** extend only through reviewed
   assignments and the accepted ambiguity policy. Test cast conflicts, removed voices, pronunciation
   changes and stale detection alongside keyboard/text alternatives and exact-head verification.
   Live-provider audio quality and distributor validation remain separately evidenced checks.

## Verification

Mock speech requests with synthetic scripts and test-tone audio. Test consent payloads, removed
voices, segmentation/attribution, stale snapshots, checkpoint/restart, uncertain provider completion,
partial failures, disk-full, corrupt media, conflicts, redaction and failure-safe packaging. Assert
unchanged manuscript hashes and reuse of valid successful audio without repeat requests. Measure
export properties using independently chosen U-042-04 tools. Run built-app keyboard/theme/refusal
journeys and exact-head tests/typecheck/smoke. Paid auditions, native devices and distributor tests
need separate explicit access/authorization and may not be inferred from fixture evidence.
