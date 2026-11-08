# Pure authoring contracts

Internal, platform-independent leaves for 037 T021/T022/T025 and the T018 workflow wire codec,
selected by D-194–D-196/D-116 and ADR 0019. Import the local `index.ts`; no global package export is
exposed. The in-memory contracts are **not a scheduler, execution grant or wholesale persisted
`run.json`**. `wire.ts` reads and writes the schema-1 workflow records specified in `docs/FORMAT.md`;
the remaining thread/host-permission schemas, writers and independent review stay separate.
No dependency imports, provider, filesystem, credential, clock reader, timer, callback or host writer
exists in the implementation. All IDs, digests, clocks, receipts and host facts are supplied explicitly.

## API and invariants

| Module | Surface | Meaning |
| --- | --- | --- |
| `contracts.ts` | `Owner`, `Reference<K>`, `Graph`, `TaskDefinition`, `validateGraph`, `prepareBrief` | Readonly owner/kind/id/revision/hash references; supported version, duplicate/missing/foreign/stale dependency and DAG checks. Input descriptors are copied, not trusted as permissions. The exact brief and existing 033 goal survive; no word counter. |
| `graph.ts` | `createRun`, `reduceRun`, `taskStatuses`, `runStatus`, `publicationEligible` | Checked command/revision/generation transitions, deterministic graph-order projection, questions/direction, preserved historical attempts, explicit author finish. Publication eligibility is only a necessary graph condition. |
| `lifecycle.ts` | `advanceAttempt`, `advanceEffect` | Prepared, intent, receiving, output-kept and completed are separate. Publication intent and actual receipt are separate. Recovery never turns possible sends/writes into known-free failure or a replay. |
| `admission.ts` | `createLedger`, `reserve`, `observeReservation`, `accountingSummary` | Finite reservations, actual receipts, pinned routes, per-attempt continuations/read limits, revision/no-progress checks and known/unknown/partial accounting. |
| `admission.ts` | `advanceAdmissionGeneration`, `parkConnection`, `continueConnection` | Preserve budgets across pause/recovery generations. Old reservations cannot dispatch. Auth/quota parks; 429 records eligibility only. Explicit Continue removes a park, never creates a request. |
| `value.ts` | `copyValue`, `AuthoringError` | Plain acyclic value admission without getters/toJSON, exact escaped JSON-size accounting, well-formed Unicode, depth 64, and checked arithmetic. This is not a wire encoder/parser. |
| `wire.ts` | `decodeWorkflowRecord`, `encodeWorkflowRecord`, `canonicalWorkflowJson`, `WORKFLOW_LIMITS` | Raw schema-1 UTF-8 JSON admission and deterministic canonical encoding for the FORMAT workflow records. Refuses invalid UTF-8/BOM, duplicate keys at any depth, lossy numeric lexemes, unsupported versions, foreign owner/kind/prefix, stale bases/links, depth and per-kind size/count overflow before returning a semantic record. Preserves supported unknown plain fields; no I/O, crypto, clock or host action. |

Factories and reducers defensively copy before returning recursively frozen snapshots. They never
freeze or mutate caller objects, prior snapshots, commands or receipts. Inputs and supported unknown
plain fields are preserved. Validation failures throw `AuthoringError` with a stable code and return
no changed snapshot. A same-ID command must have both the same supplied payload digest and the same
complete structural payload (including expected revision/generation). Exact replay returns the
**current** snapshot, never historical state or renewed execution permission. A reservation ID also
deduplicates its entire request, including after release. Snapshots must come from these factories/
reducers; casting deserialized or worker values to `RunSnapshot`/`AdmissionLedger` is unsupported.

External records retain depth64 admission before validation. Internal snapshot copying separately
allows the maximum three structural wrappers (`reservations[].request`); aggregate depth is at most67.
Graph/policy records add one wrapper, commands two, and reservation requests three. Extracted graph/
command references and receipt/clock projections fit within the same allowance. Repeated transitions
replace that aggregate rather than nest it again. This internal copier is not exported from the leaf
index and never admits external records or new wire formats; unknown extension values are preserved.
Explicit connection Continue copies its supplied clock before reading or comparing any property.

Plain values allow finite fractional numbers within the safe-number magnitude; all semantic revisions,
generations, bounds, times and micro-USD are separately required to be nonnegative safe integers.
Negative zero, nonfinite/unsafe numbers, lone surrogates, classes, functions, symbols, getters,
nonenumerable fields, extended/sparse arrays and cycles refuse. Shared acyclic subobjects are copied
independently. The raw reader in `wire.ts` detects duplicate JSON keys, lossy numeric **lexemes**,
invalid UTF-8 and unsupported wire versions *before* constructing values; those facts cannot be
recovered from an already parsed object. It also refuses a BOM, a lone surrogate escape, depth/size
overflow, foreign owner/kind/prefix and stale base/direction links. There is no claim to sandbox
executable JavaScript/proxies.

## Direction, completion and settlement

- Each task declares complete host-verified impact keys (source/entity keys) and exact dependency
  references. A question or direction change invalidates intersecting tasks and transitive dependants.
  Incomplete impact metadata is always affected. A worker cannot assert independence to remove edges.
- Questions remain unanswered until an explicit current-question/revision answer. Exact and confirmed
  answer text are retained separately. Direction revisions advance by one with a fresh immutable ID.
  Only affected tasks take the new direction. Proven-independent work retains its captured direction.
- Invalidated attempts keep original inputs, direction and outputs. Late output may be retained and
  settled but cannot become current. Already-started effects settle with real observations; an old
  confirmed receipt stays historical. No base or direction tokens are silently refreshed.
- Pause/cancel/revoke increments the generation and closes unfinished graph gates synchronously in
  the returned snapshot. Caller must close its real host gate **before** any awaited work, even when
  persistence or integer overflow prevents recording this transition. Pure state cannot cancel I/O.
- Live attempts/effects keep the run settling. Recovery marks possible sends/publications uncertain,
  and prepared-without-intent work known unsent. Explicit Continue may allow proven-independent work
  after recovery while uncertain branches and their dependants stay blocked. Still-live work prevents
  resume. Verified completed dependencies survive repeated pause/recovery; cancellation/revocation
  cannot be resumed. Final-review-ready requires every task completed and no open question; author
  finish is a separate command, not a literary-quality assertion.
  - A `candidate` task completes at validated output; an `adoption` task needs an actual confirmed effect
  receipt before dependants become ready. Review quality, actual output retention, exact target/base,
  first-keystroke draft protection, host grant, source scope, safety and actual write verification all
  remain host responsibilities. `publicationEligible` certifies none of them.

## Admission and accounting

The initial-policy defaults are 3 concurrent requests (configurable 1–4), 600 calls, 12 accumulated
active hours, 7 calendar days, 2 local revision cycles, 1 global pass, 4 calls/8 reads per attempt,
262,144 output bytes, and the ADR's role-specific token ceilings. Lower explicit ceilings are accepted.
Extensions above this initial envelope need a separately reviewed explicit policy-extension contract;
no caller should reset a ledger to obtain more budget. A 1,024-task phase limit does not define a
whole-book limit; linked phase-plan persistence belongs to T018/T023.

The host must serialize reservation decisions under its single admission lock, atomically retain the
new ledger before transport, and recheck all actual gates at the send boundary. Passing the same old
snapshot to two callers is **not** concurrent-safe admission. `otherHostActive`/`otherAccountActive`
exclude this ledger and include other runs; `accountLimit` is the effective limit capped by the host's
maximum four. Known account aliases share `accountKey`; unknown aliases require the conservative
provider bucket. Pin destinations to author-selected routes; no fallback is selected here.

Inject monotonic observed wall time and accumulated active time. Pause/sleep accounting belongs to the
host; the core refuses regression, impossible active time and expiry. Reserve and dispatch both check
gate, clock, capacity and accounting-durability facts. Advance the ledger generation together with the
run's gate before any new dispatch; history/charges/cycles survive, old reserved sends refuse, and old
already-dispatched receipts remain valid historical accounting. Release only `reserved` entries known
not to have crossed dispatch intent. Timeout, cancellation or uncertainty never releases a possible charge.

Every continuation consumes a call and needs a successful settled predecessor, the same immutable
attempt inputs/destination/generation, a new request digest and the next call index. Failed/stopped
attempts cannot be disguised as continuations. Repeated input/direction/review/role tuples across new
attempts, repeated exact request digests and reused/exhausted revision ordinals refuse as no progress.
An explicit Retry alone cannot bypass this; changed instructions/direction are needed for a new attempt.
Revision-writer attempts also name their exact base artifact. An output with that same artifact digest
is retained but parks the completed task as `needs-direction`, with no publication/retry eligibility.
This detects exact unchanged artifacts, not semantic quality or identical prose inside changed metadata.

Bounded operations allow unknown costs and report known subtotal, partial/unknown calls, pending calls
and reservations separately. Strict money requires the caller's **host-qualified provider-enforceable
all-charge maximum**, bound to the exact request/connection/policy. The core does not qualify an adapter
or authenticate that evidence. Catalog estimates, unknown tariff and unqualified enforcement refuse.
Safe micro-USD maxima are reserved across concurrent requests; unresolved charges block further strict
admission. Only actual complete reported receipts release unused maximum. A receipt exceeding its
maximum is retained and closes future admission as an enforcement violation. Integer-sum overflow
refuses the mutation; the host must independently retain the received accounting evidence and park.
Unknown/partial final receipts remain immutable and blocking in strict mode; a future append-only
accounting-reconciliation contract is required to attach later definitive billing evidence.

## Integration prerequisites and evidence boundaries

T018 now supplies the schema-1 workflow records and this raw codec: field-level FORMAT definitions,
exact reference/hash rules, command/receipt pagination, per-kind bounds and conflict/recovery rules.
Shared thread migration and host-permission schemas, checked workflow writers, real streaming and
independent review remain open. A snapshot here aggregates multiple records and command history; do
**not** write it wholesale as `run.json` or infer that it fits the 2.5 MB run-file limit. New graph
inputs enforce 2.5 MB/1,024 tasks and individual task/command/request values enforce 262,144 bytes.
The codec validates hash shape but cannot compute a SHA-256, read a related file or verify currency;
the host owns exact-byte hashing, storage and cross-file reconciliation.

T019/T020/T022–T025/T029/T032–T035 own checked conversation/storage, pinned host permission, durable
reservation/effect receipts, lifecycle, real transport, quiescence and publication. No package global
export, SDK/runtime, Library/API/IPC/preload/Workspace or ThreadStore is changed here; the FORMAT change
is limited to the T018 workflow-record section.
Host integration must prevent copied descriptors and worker text from entering privileged command/
receipt/fact inputs, retain observations before projection errors, reconcile uncertain work explicitly,
and never recreate a ledger on restart to erase charges. Source/exact-citation/context construction,
adoption receipts and 033 saved-word progress remain separate services.

Focused checks (from repository root):

```sh
bun test packages/core/tests/authoring
bunx --no-install tsc -p packages/core/tests/authoring/tsconfig.strict.json
bunx --no-install tsc -p packages/core/tests/authoring/tsconfig.pure.json
bunx --no-install biome lint packages/core/src/authoring packages/core/tests/authoring
```

`tsconfig.pure.json` gives the source no Node/Bun types. The boundary test checks local-only imports and
absence of runtime/send/write/timer primitives; all behavioral tests use synthetic in-memory values.
These tests do not establish transport overlap, actual host serialization, durable persistence,
filesystem recovery, a full-length generated book, literary quality, device behavior or a dollar-cap
adapter. Independent exact-candidate review and the parent-owned integrated gates remain required.
