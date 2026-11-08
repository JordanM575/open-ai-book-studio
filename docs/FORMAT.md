# The studio file format

A library is an ordinary folder. Everything the app knows can be read, diffed and edited with a text
editor; nothing important lives in a database or in an opaque blob. The app's profile holds settings,
and words a close or quit could not save until the author restores or discards them (see
[Words kept after a failed close or quit](#words-kept-after-a-failed-close-or-quit)).

```
<library>/
  library.json                 derived catalog — safe to delete
  books/
    book_1f4c8a2b9d3e5a71/
      book.json                idea, outline, cast, memories, settings
      chapters/
        0001-the-door.md       YAML front matter + Markdown prose
        0002-the-lighthouse.md
      images/                  illustrations and character images owned by this book
        img_….png
      images.json              image provenance and chapter attachments
      conflicts/               versions kept when two writers disagreed
      threads/                 agent conversations, one JSON file per thread
      checkpoints/             reserved for draft checkpoints
      .studio/
        checkpoints/           undo points, one JSON file per agent turn
  .studio/
    device.json                identity of this machine
    files.json                 reserved index metadata
    sync/
      device_…json             this device's last scan; never exported
    trash/
      book_…/1719340000000-0002-the-lighthouse.md
```

The library folder can live anywhere: locally, in iCloud Drive, in Google Drive, in Dropbox, on a
network share. The studio makes no attempt to merge providers' conflict files; it surfaces them
(see below).

### Browser storage

The browser build keeps the same tree either in origin-private storage or in a folder the author picks.
The directory-handle adapter writes through a swap file and re-checks the whole-file hash before the
commit point; if another writer changed the file, the old bytes stay and the author's text is preserved
in `conflicts/`. Browser storage can be cleared by the browser; export a portable archive to keep a copy.

## Accepted reservations awaiting detailed schemas

ADRs [0019](adr/0019-bounded-autonomous-authoring.md) and
[0020](adr/0020-inline-editorial-review.md) reserve the following locations. **These are not yet
writable formats.** Pure graph/permission/editor contracts can proceed; no writer may infer a wire
schema from these directory names or from an unchecked TypeScript object.

| Reserved location | Accepted ownership / prerequisite |
| --- | --- |
| `books/<bookId>/workflows/<runId>/` | Book-owned run/brief/policy/plans/directions/tasks/commands/attempts/effects/questions/artifacts/contexts/admission records. Schema 1 is defined in [Workflow records](#workflow-records-schema-1); checked writers and independent storage review remain separate. |
| `books/<bookId>/reviews/<runId>.json` | Immutable absent-only explicit saved report; analyzer/profile/source/coverage/findings attribution, bounded quotes, no full source bodies |
| `books/<bookId>/reviews/dispositions/`, `profiles/`, `campaigns/` | Checked author-owned records; full/segmented continuation and related-report trash/restore rules before writers |
| Existing `books/<bookId>/threads/` v2 | Explicit backed-up migration, checked whole-document revisions/raw hashes, lossless supported unknown fields and future/unknown-semantic read-only behavior before new semantic parts |
| Host-local workflow permission (outside library/archive) | Separate selected-host protected/disclosed store; registration/book/run/policy/generation/expiry/revoke/resume, no prose or credential; missing or copied descriptor grants no execution |

The workflow row is now specified in [Workflow records (schema 1)](#workflow-records-schema-1);
its checked writers and independent storage review remain open. The other rows remain reservations.

Each detailed format must name every field and optional/default rule; schema/kind/owner/host-issued ID;
safe revisions/generations; raw-byte and semantic limits (including unknown fields); supported JSON/
Unicode/number domain; absent/current/stale no-op semantics; exact publication/readback and failure
receipts; issue-bearing list/read; conflict preservation; explicit migration; archive/sync and recoverable
trash/restore. Cross-file operations are recoverable sequences. No automatic pruning or replay of
uncertain dispatch/publication. Adopt the ADR-specific byte bounds without inventing eviction.
Changing a reservation requires updating its ADR and owning spec. Existing v1 thread behavior below
is current format evidence, not a claim that checked-write migration is complete.

## Checked planning and goal sidecars

D-163–D-168 / [ADR 0017](adr/0017-planning-and-organization.md) define these optional
book-owned files. Worldbuilding create/read/edit and goal set/clear are connected to the current
Library's shared queue, desktop/browser transport and workspace controls. Timeline/beat/story-note
mutation, record archive/restore and the remaining organization journeys are separate delivery work.

### `books/<bookId>/planning.json` (schema 1)

All listed fields are required except `storyNotes`. Objects are loose: supported unknown JSON
fields at every depth survive known-field edits literally, including whitespace inside strings.
Validation never inserts defaults into an existing document. No trimming or Unicode normalization
is applied. The following is a complete minimal saved example:

```json
{
  "schemaVersion": 1,
  "bookId": "book_1f4c8a2b9d3e5a71",
  "revision": 1,
  "worldbuilding": [
    {
      "id": "wb_1234567890abcdef",
      "kind": "worldbuilding",
      "bookId": "book_1f4c8a2b9d3e5a71",
      "revision": 1,
      "archived": false,
      "name": "The salt road",
      "category": "Place",
      "description": "A road beside the sea.",
      "notes": ""
    }
  ],
  "timeline": [],
  "timelineOrder": [],
  "beats": [],
  "beatOrder": []
}
```

Every record has immutable `id`, `kind`, `bookId`, positive safe-integer `revision`, and boolean
`archived`. In addition to the worldbuilding shape above:

| Field | Record kind / ID prefix | Required authored fields |
| --- | --- | --- |
| `timeline[]` | `timeline` / `tl_` | `title`, `when`, `description`, `notes` |
| `beats[]` | `beat` / `beat_` | `title`, `summary`, `notes` |
| `storyNotes` (optional single object) | `story-notes` / `sn_` | `workingNotes`, `styleNotes`, `synopsis` |

`timelineOrder` and `beatOrder` each contain exactly the corresponding retained record IDs once,
including archived records; hiding archived entries never destroys their position. Lists retain
at most 200 records each, active and archived combined. Names/titles must be nonblank; names,
titles, categories and literal `when` labels have at most 200 **UTF-16 code units**. All other
authored text fields have at most 20,000 code units. IDs have prefix-specific suffixes matching
`[A-Za-z0-9-]{6,40}`; hosts generate them, never the editor. IDs are unique across all retained
records. Every record owner equals the file owner and the actual owning `book.json` ID.

### `books/<bookId>/goals.json` (schema 1)

```json
{
  "schemaVersion": 1,
  "bookId": "book_1f4c8a2b9d3e5a71",
  "revision": 1,
  "targetWords": 50000
}
```

`targetWords` is a positive safe integer or `null`. Clearing an existing goal saves `null`,
preserving unknown fields; it does not delete the file. Clearing an absent goal is a no-write
operation. Counts are derived, never stored here: complete verified saved chapter snapshots yield
`savedWords` and `remaining` (null without a target, otherwise floored at zero). Unreadable chapters
yield `incomplete` with an issue count and no total/remaining; changed or unverifiable sources yield
`unavailable`. Two saved reads must agree on book identity, chapter enumeration, IDs, paths,
versions, raw hashes, bodies and read issues; the goal token is rechecked too. Each enumerated source
is independently read and its exact raw SHA-256 recomputed, decoded with fatal UTF-8, and compared
against its canonical saved body and recorded identity/version. History's quiet plain-value front
matter reader is reused; unsupported metadata makes this count unavailable without changing the
ordinary chapter view. Valid headerless saved text remains countable. Empty books are a complete
zero. The host owns complete enumeration. This is point-in-time verification, not a filesystem
transaction or draft count.

The integrated reader uses fresh directory enumeration, retains duplicate-ID files as read issues
instead of silently counting only the preferred copy, and compares the filesystem adapter's inspected
entries to the readable listing. Unsupported chapter entries, omitted inspected files and iCloud
placeholders cannot confirm a total. A recorded chapter `bookId`, when present, must match the owner.
Valid headerless and partial-metadata chapters retain the existing deterministic fallback identity.
Observed external changes, saved chapter hashes/enumeration/read issues, explicit refresh, window
focus and planning write outcomes invalidate displayed progress. Dirty/pending/failed/conflicting
editor state is separately labelled and never supplies the saved count.

### Sidecar mutation and recovery

Both files have an exact **2,500,000 UTF-8 byte** budget, including unknown fields, two-space
indentation and a final newline in new serialized output. Reads check stat and actual returned
bytes; writes check the baseline input and complete proposed output separately. Unknown fields
are never dropped to make room. Missing means empty without creating directories or files.
Malformed, over-budget, foreign-owner, newer-schema and copy-only documents in an active location
are unavailable and write-refused. An invalid sidecar does not invalidate the rest of the book.

The core save envelope is `{bookId, source, baselineJson, draft}`. `source` is exactly
`{kind:"absent", revision:0}` with `baselineJson:null`, or
`{kind:"sha256", value:<64 lowercase hex>, revision:<positive safe integer>}` with the exact raw
UTF-8 JSON string returned by read. The service checks that string's hash/revision/owner. `draft`
is a strict typed intent: `create-worldbuilding` with `{name,category,description,notes}` fields,
`edit-worldbuilding` with an existing `id` and those fields, or (for goals) `set-goal` with
`targetWords`. No path, generated ID, revision, owner, arbitrary document replacement or unrelated
field patch is accepted in a draft. The full intended document is constructed from that bounded
baseline plus draft; this preserves unknown/unrelated fields without trusting an editor to resend
them correctly. The request carries only one full baseline and bounded authored fields, within
the ADR's two-document allowance: the raw baseline and serialized `{bookId,draft}` are each capped
at 2,500,000 bytes. Strict control validation rejects additional keys. Each unquoted JSON number
must retain its exact mathematical decimal value when parsed and serialized as a JavaScript Number.
Overflow, underflow, rounded decimals/integers and negative zero are refused before mutation,
including in nested unknown fields and recovery baselines. Supported numeric spelling may change
(for example, `1.00` to `1`); numeric-looking strings remain literal. Known revision/target fields
additionally require safe integers. Refusal leaves the original bytes intact.

Under the owning Library's existing book queue, validate the actual book and independently
supported sidecar, then compare exact absence/hash **and** revision. Only a current semantic
no-op writes nothing. A real operation increments the file revision once and its edited record
revision once; host-created records start at 1. Incrementing `Number.MAX_SAFE_INTEGER` is refused.
One checked absent/SHA commit is allowed, through the Library's existing journal-aware commit
hook. There is no retry, rebase, merge, catalog update or book timestamp change.
A current semantic no-op keeps even a compact source whose pretty-printed form would exceed the
budget: it does not reserialize or publish that form.

A stale request (even a same-content request), missing-after-read or commit race preserves its
complete intended document under
`books/<bookId>/conflicts/<planning|goals>.conflict-<external-edit|missing-file>.<deviceId>.<timestamp>[-N].json`.
The copy adds a reserved `conflictMetadata` object with `reason`, original `baseline` token and
observed token. Recovery copies are bounded to 5,000,000 bytes. Colliding names use absent-only
suffix attempts; returned bytes and their hash must verify before reporting `conflict`/`savedAs`.
Only conflict-copy names may be retried, never the active-file commit. A copy cannot be loaded as
an active baseline; eventual explicit recovery must remove the copy-only context and create a
fresh reviewed edit. Both the active write and copy publication can be uncertain after an adapter
error or mismatching readback: report `uncertain`, keep the editor draft and reread storage; never
replay automatically or remove a possibly published file. Copy failure never claims a durable copy.
Owner/schema checks run again before copy creation and each publication attempt.

Transport preserves exact raw baselines, validates strict request/result envelopes and verifies reply
owner, raw hash, revision and submitted fields. Only known request-admission failures return
`outcome: "refused"`; unknown exceptions remain uncertain. Write errors retain `phase: "active" |
"recovery"` and `outcome: "uncertain" | "not-kept"`. The browser adapter marks a `changed` result
after publication with `publication: "uncertain"`; planning treats that as an uncertain outcome,
never as a prepublication conflict or a collision to retry. This adds no cross-process CAS guarantee.

Workspace recovery lists planning/goal copy names in pages of 25 (a display window, not a retention
limit). Inspection verifies bounded raw bytes, hash, schema, owner and copy-only metadata; a named
copy that cannot be verified stays unavailable. Recovery is explicit manual review: inspect the
read-only document, reopen the appropriate current editor, enter the chosen fields and submit a new
checked edit. There is no whole-document restore endpoint or automatic loading of copy metadata as
active state. Newer active unknown fields remain owned by the current baseline. Native close and
shell book/library navigation are blocked until the matching dialog resolves pending/dirty/uncertain
state; after closing an editor, retry the navigation action. Abrupt process termination cannot retain
an in-memory draft or cancel a publication already sent.

Book-side files and their conflict copies travel in folder copies, portable archives and whole-book
trash/restore. Collection and annotation file writers, recents and annotation navigation are not
part of this first slice; their accepted contracts remain in ADR 0017.

## Workflow records (schema 1)

D-194–D-196 / [ADR 0019](adr/0019-bounded-autonomous-authoring.md) define the only full-book workflow
authority. This section specifies the durable schema-1 records under
`books/<bookId>/workflows/<runId>/` that the pure graph, lifecycle and admission contracts need. It
does **not** authorize a writer, scheduler, provider call, publication or host permission. T019,
T022–T025, T029 and independent storage review remain prerequisites. The pure host-neutral raw codec
is `packages/core/src/authoring/wire.ts`; it performs no I/O.

### Layout

| Path under `workflows/<runId>/` | Record kind | Mutability |
| --- | --- | --- |
| `run.json` | `run` | Checked control header. |
| `brief.json` | `brief` | Immutable exact onboarding brief and 033 goal link. |
| `policies/<policyId>.json` | `policy` | Immutable agreement/routing/limits snapshot. |
| `plans/<planId>.json` | `phase-plan` | Immutable linked phase task graph. |
| `directions/<directionId>.json` | `direction` | Immutable direction epoch. |
| `tasks/<taskId>.json` | `task` | Checked task definition and status-projection inputs. |
| `commands/<commandId>.json` | `command` | Append-only command journal entry. |
| `commands/pages/<first>-<last>.json` | `journal-page` | Immutable command pagination page. |
| `attempts/<attemptId>.json` | `attempt` | Checked dispatch, output and accounting record. |
| `effects/<effectId>.json` | `effect` | Checked publication intent and receipt. |
| `effects/receipts/pages/<first>-<last>.json` | `journal-page` | Immutable receipt pagination page. |
| `questions/<questionId>.json` | `question` | Checked question and answer. |
| `artifacts/<artifactId>.meta.json` | `artifact` | Immutable artifact attribution metadata. |
| `artifacts/<artifactId>.md` or `.json` | (body) | Immutable artifact bytes, at most 1 MiB. |
| `contexts/<contextId>.json` | `context` | Immutable captured-source manifest. |
| `admission/reservations/<reservationId>.json` | `reservation` | Checked reservation and settlement. |
| `admission/observations/<sequence>-<observationId>.json` | `observation` | Append-only host observation. |
| `admission/accounting.json` | `accounting` | Checked accounting summary input. |
| `conflicts/` | (copy) | Recoverable conflict copies; never active records. |

### Common encoding and identity

- **Exact bytes.** A saved record is UTF-8 with no byte-order mark. New checked writes use the codec's
  canonical form: compact JSON, object keys sorted by UTF-16 code-unit order, no insignificant
  whitespace and no trailing newline. The codec accepts any valid JSON spelling for inspection, but a
  checked writer must hash and commit the exact canonical bytes it intends to publish. A record's raw
  SHA-256 is over those exact file bytes.
- **Plain JSON only.** No comments, trailing commas, `NaN`, `Infinity`, `-0`, duplicate member names,
  lone surrogates or non-data JavaScript values. Strings are not trimmed or Unicode-normalized.
  Supported unknown plain fields survive at every depth. Strict control objects (`limits`, `routes`,
  `destination`, `cost`, `maximum`, `target`, `intent`, `receipt`, `facts`, `clock`, `accounting`,
  `summary` and journal entries) reject extra keys rather than silently ignoring a control.
- **Numbers.** A numeric token must parse to a finite value whose exact decimal value round-trips
  through the canonical Number spelling; the absolute value is at most `2^53-1`. `9007199254740993`,
  `1e400`, `1e-400`, `1.0000000000000001`, `-0` and equivalent lexemes are refused. Every revision,
  generation, sequence, version, count, timestamp-in-milliseconds and micro-USD amount is a
  nonnegative safe integer except where a positive minimum is stated.
- **Depth and size.** The raw reader admits at most 64 nested value wrappers. Record byte limits
  are in the bounds table below. Reads check the exact byte count before parsing; writes check the
  exact canonical byte count before commit.
- **Schema and identity.** Every record has `schemaVersion: 1`, `kind`, `owner`
  (`{libraryRegistration, bookId, runId}`), a host-issued `id`, and `revision`. `owner` must equal the
  record's actual owning registration/book/run. `id` must use the kind's prefix and a safe
  `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` suffix. A missing, future or foreign record is unavailable; it is
  never rewritten or migrated on read.
- **Checked vs immutable.** Checked records carry `base` and a positive `revision`. At revision 1 the
  base is exactly `{kind:"absent", revision:0}`. At revision `n > 1` the base is exactly
  `{kind:"sha256", value:<lowercase SHA-256>, revision:n-1}` for the previous raw file. A missing,
  mismatched or stale base refuses the write. Immutable records have no `base`; their `revision` is
  exactly 1 unless the kind states otherwise. No read inserts defaults or unknown fields.
- **References.** A reference is exactly `{kind, owner, id, revision, hash}`. `kind` must match the
  named field, `owner` must equal the containing record's owner, `id` must use that kind's prefix,
  `revision` is a positive safe integer, and `hash` is the lowercase SHA-256 of the referenced exact
  raw file (for an artifact reference, the artifact body bytes, not its metadata). No supplied path,
  URL, filename or worker text is a reference.
- **Timestamps.** `createdAt`, `updatedAt`, `recordedAt`, `at`, `intentAt` and `answeredAt` are UTC ISO
  8601 with exactly millisecond precision, for example `2026-11-07T00:00:00.000Z`.
- **Default rule.** Writers emit every required field. Required nullable fields are emitted as `null`;
  the codec never invents a value. Truly optional fields are omitted when absent and keep their
  in-memory default without being written back. Unknown supported extensions are retained literally.
- **Unknown fields.** The fields listed for a record are its known fields; any other plain JSON field
  is a supported extension and survives at every depth, including `__proto__` as ordinary data.
  Strict control objects named above reject extras instead. No record silently drops an unknown field.

### `run.json` — checked run header

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base` | yes | Common envelope; `kind:"run"`, `id:"run_…"`. |
| `generation` | yes | Positive safe integer; the current control/admission generation. |
| `mode` | yes | `running`, `pausing`, `paused`, `cancelling`, `cancelled`, `revoking`, `revoked`, `finishing` or `finished`. Pause/cancel/revoke settle separately from their request. |
| `phasePlan` | yes | Reference to the current immutable `phase-plan`. |
| `policy` | yes | Reference to the current immutable `policy`. |
| `direction` | yes | Reference to the current immutable `direction`. |
| `queue` | yes | Array of up to 64 unique `task` references; empty when nothing is queued. |
| `materialized` | yes | Array of up to 4 unique `reservation` references; empty when none are admitted. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

`run.json` is control only. It never embeds attempts, effects, questions, commands, artifacts or the
in-memory snapshot aggregate. `mode` stores the control request/settling label; the pure reducer's
`RunSnapshot.mode` uses the five stable modes and derives `pausing`/`cancelling`/`revoking` from
unsettled attempts/effects. A host maps between them; a settling label is never permission to
continue or retry. The 2,500,000-byte run bound is a file bound, not a claim that an aggregate
snapshot fits.

### `brief.json` — immutable exact brief

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision` | yes | `kind:"brief"`, `id:"brief_…"`, `revision:1`; no `base` or `generation`. |
| `text` | yes | Exact brief, at most 20,000 UTF-16 code units **and** 65,536 UTF-8 bytes. No trimming or normalization. |
| `goalId` | yes | Existing 033 goal identity; this record never counts words. |
| `targetWords` | yes | Positive safe integer. About 100 words is guidance, not a cap. |
| `genre`, `audience`, `perspective`, `tone` | no | Optional authored strings, each at most 2,000 UTF-16 units and 8,192 UTF-8 bytes. |
| `constraints` | no | Optional array of at most 64 strings, each with the same 2,000-unit/8,192-byte bound. |
| `createdAt` | yes | UTC ISO timestamp. |

The file is immutable. A corrected brief requires an explicit new run or an independently reviewed
migration; it is never rewritten in place.

### `policies/<policyId>.json` — immutable agreement snapshot

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `generation` | yes | `kind:"policy"`, `id:"policy_…"`, `revision:1`; no `base`. |
| `policyDigest` | yes | Lowercase SHA-256 of the exact agreed policy content. |
| `startedAtMs` | yes | Nonnegative safe epoch milliseconds. |
| `limits` | yes | Strict object with exactly the nine keys below. |
| `routes` | yes | 1–7 objects with unique `role` and a strict `destination`; every role is pinned, never ranked or replaced. |
| `cost` | yes | Strict `{mode:"bounded-operations"}` or `{mode:"strict-money", capMicroUsd:<positive safe integer>}`. |
| `createdAt` | yes | UTC ISO timestamp. |

`limits` requires exactly: `concurrency` 1–4; `calls` 1–600; `activeMs` 1–43,200,000;
`lifetimeMs` 1–604,800,000; `localRevisions` 0–2; `globalRevisions` 0–1; `callsPerAttempt` 1–4;
`readsPerAttempt` 1–8; `outputBytes` 1–262,144. A `destination` is exactly
`{connectionId, providerId, modelId, accountKey}`; the first, second and fourth are safe IDs, and
`modelId` is a nonblank string of at most 512 UTF-16 units and 2,048 UTF-8 bytes. A changed agreement
is a new immutable policy record with a new ID/generation, referenced by a checked `run.json` update.
Bounded operations permit unknown actual cost; strict money requires qualified provider-enforceable
all-charge maxima. No zero-cost inference or automatic renewal is part of this format.

### `plans/<planId>.json` — immutable phase plan and link

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `generation` | yes | `kind:"phase-plan"`, `id:"plan_…"`, `revision:1`; no `base`. |
| `phase` | yes | Positive safe integer; phase 1 has `previous:null`. |
| `previous` | yes | `null` for phase 1, otherwise a `phase-plan` reference. The host verifies the linked phase is exactly one lower before accepting the plan. |
| `graph` | yes | Schema-1 graph described below. |
| `createdAt` | yes | UTC ISO timestamp. |

The graph is the existing pure `Graph`: `version:1`, the same `owner`, `policyDigest`, `generation`
equal to the record's `generation`, a `direction` reference and 1–1,024 task definitions. Each task
definition has a `task` reference, a role from the accepted seven, `completion` of `candidate` or
`adoption`, unique `dependsOn` task references and complete host-validated `impact`
`{complete, keys}` with unique safe-ID keys. Every dependency must resolve to the same owner with the
same ID/revision/hash; cycles, duplicate tasks and missing/stale dependencies are refused. Supported
unknown graph/definition fields survive. A worker cannot assert independence or supply paths.
Linked phase plans allow longer work without truncation; no whole-book task limit is inferred from
the 1,024-per-plan bound.

### `directions/<directionId>.json` — immutable direction epoch

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision` | yes | `kind:"direction"`, `id:"direction_…"`; `revision` is the direction epoch (at least 1); no `base` or `generation`. |
| `exactText` | yes | Exact author/direction text, at most 262,144 UTF-16 units and 262,144 UTF-8 bytes. |
| `origin` | yes | `onboarding`, `outline`, `cast`, `answer` or `author`. |
| `previous` | yes | `null` only at revision 1; otherwise a `direction` reference whose revision is exactly one lower and whose ID differs. |
| `question` | yes | Non-null `question` reference exactly when `origin` is `answer`; otherwise `null`. |
| `createdAt` | yes | UTC ISO timestamp. |

A confirmed answer creates immutable versioned direction, closes affected publication gates and
invalidates dependent attempts. Old directions and old-epoch outputs remain historical. No base or
direction token is silently refreshed, and a live attempt's prompt never changes.

### `tasks/<taskId>.json` — checked task and projection inputs

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"task"`, `id:"task_…"`. |
| `plan`, `phase` | yes | `phase-plan` reference and positive phase number. |
| `definition` | yes | `{role, completion, dependsOn, impact}` as in the phase plan. Supported unknown definition fields survive; `impact` is strict. |
| `direction` | yes | The `direction` reference captured for this task. |
| `currentAttempt` | yes | `null` or an `attempt` reference. |
| `retryAllowed`, `needsDirection` | yes | Booleans; an explicit retry is a new host command, never automatic. |
| `status` | no | Optional cached projection: `blocked`, `ready`, `preparing`, `executing`, `validating`, `ready-to-publish`, `completed`, `failed`, `stale`, `uncertain` or `needs-direction`. Absent means recompute from inputs. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

Task status is a projection, not an authority. The host validates dependencies, direction currency,
draft safety, grant and exact target before any dispatch or publication. `failed`, `stale` and
`uncertain` never imply free retry or no charge.

### `commands/<commandId>.json` — append-only command journal entry

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `generation` | yes | `kind:"command"`, `id:"command_…"`, `revision:1`; no `base`. |
| `sequence` | yes | Positive safe integer, unique and contiguous from 1 in the run's command journal. |
| `expectedRevision` | yes | Nonnegative safe integer expected run revision. |
| `payloadDigest` | yes | Lowercase SHA-256 of the complete command payload. |
| `action` | yes | Plain object with `type` one of `pause`, `cancel`, `revoke`, `resume`, `recover`, `finish`, `question`, `close-question`, `answer`, `direction`, `retry`, `prepare`, `attempt`, `prepare-effect` or `effect`; semantic fields are validated by the pure reducers. Supported unknown action fields survive. |
| `recordedAt` | yes | UTC ISO timestamp. |

Command IDs deduplicate only equal payloads: equal ID with the same digest/payload replays the
current snapshot; equal ID with a different payload refuses. A replay never renews execution
authority. Commands are never rewritten or reordered.

### Journal pages — command and receipt pagination

`commands/pages/<first>-<last>.json` and `effects/receipts/pages/<first>-<last>.json` use the same
strict `journal-page` record:

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision` | yes | `kind:"journal-page"`, `id:"journal_…"`, `revision:1`; no `base` or `generation`. |
| `journal` | yes | `command` or `receipt`. |
| `pageSize` | yes | 1–256. |
| `firstSequence`, `lastSequence`, `nextSequence`, `total` | yes | Positive safe integers; `nextSequence` is exactly `lastSequence + 1`; `total` is at least `lastSequence`. |
| `entries` | yes | 1–`pageSize` `{sequence, ref}` objects. Sequences are contiguous from `firstSequence` through `lastSequence`. A command page references `command`; a receipt page references `effect`. |
| `createdAt` | yes | UTC ISO timestamp. |

Pages are immutable, ordered by `firstSequence`, and never leave sequence gaps or overlap. A reader
pages by `firstSequence`/`nextSequence`; `total` reports durable entries. Receipt pages index the
`effect` records whose checked receipt is the publication result; the effect remains the authoritative
receipt holder. No page or receipt is automatically pruned or compacted.

### `attempts/<attemptId>.json` — checked attempt, dispatch and accounting

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"attempt"`, `id:"attempt_…"`. |
| `task`, `direction`, `context` | yes | Same-owner `task`, `direction` and `context` references. |
| `inputDigest` | yes | Lowercase SHA-256 of the immutable attempt input. |
| `revisionOf` | yes | `null`, or the exact base `artifact` reference for a revision-writer attempt. |
| `phase` | yes | `prepared`, `dispatch-intent`, `receiving`, `output-kept`, `completed`, `failed`, `stopped` or `uncertain`. |
| `historical`, `noProgress` | yes | Booleans. Historical attempts keep original inputs/outputs; a no-progress output cannot publish or retry. |
| `outputs` | yes | Up to 64 unique `artifact` references. |
| `dispatch` | yes | `null`, or strict `{destination, requestDigest, intentAt}`. The destination is the pinned route; `requestDigest` is a SHA-256; `intentAt` is UTC ISO. |
| `accounting` | yes | Strict `{calls, localReads, knownSubtotalMicroUsd, unknownCalls, partialCalls}`: calls 0–4, reads 0–8, amounts nonnegative safe integers, and `unknownCalls + partialCalls <= calls`. |
| `providerReceipts` | yes | Up to `calls` unique receipts, each strict `{id, reservationId, outcome, accounting}`; outcome is `succeeded`, `failed` or `stopped`; accounting is `{kind:"reported"|"partial", microUsd}` or `{kind:"unknown"}`. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

Dispatch intent and actual accounting are distinct. A persisted intent without a conclusive receipt
is uncertain, never known-unsent. Failed, stopped and uncertain never imply no charge. There is no
automatic provider retry or model/route substitution.

### `effects/<effectId>.json` — checked publication intent and receipt

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"effect"`, `id:"effect_…"`. |
| `attempt`, `candidate` | yes | Same-owner `attempt` and exact `artifact` references. |
| `phase` | yes | `prepared`, `publish-intent`, `confirmed`, `conflict`, `not-published` or `uncertain`. |
| `target` | yes | Strict `{kind, chapterId, path}`; kind is `new-chapter` or `replace-chapter`, `chapterId` is safe, and `path` is a relative library path with no leading slash, backslash or `..` segment. A new chapter preallocates an absent ID/path. |
| `intent` | yes | `null`, or strict `{at, baseVersion, baseHash, intendedHash, intendedBytes, safety}`. `intendedBytes` is 0–1,048,576. New chapters require baseVersion 0, baseHash null and safety null; replacements require baseVersion at least 1, a baseHash and a safety `artifact` reference. |
| `receipt` | yes | `null`, or strict `{outcome, at, resultVersion?, resultHash?, savedAs?}`. Confirmed requires resultVersion/resultHash; conflict requires `savedAs`; resultVersion/resultHash travel together; `savedAs` is a bounded relative path. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

`prepared` has neither intent nor receipt; `publish-intent` has an intent and no receipt; terminal
phases require a receipt whose outcome equals the phase. Exact intended serialized bytes and the
publish intent are durable before one checked commit. A receipt records the actual observation,
separately from catalog/thread/accounting projection. An uncertain intent is never replayed; finding
the exact intended bytes means the intended result was observed, not that writer identity is proven.

### `questions/<questionId>.json` — checked question and answer

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"question"`, `id:"question_…"`. |
| `keys` | yes | 1–256 unique safe-ID impact keys. |
| `affected` | yes | Up to 1,024 unique safe task IDs; unknown dependency impact is conservative. |
| `characterId` | yes | `null` or a safe character ID. |
| `evidence` | yes | Up to 64 `artifact`/`context` references; source chapter evidence lives in the context manifest. |
| `options` | yes | Up to 16 strict `{id, label, consequence}` objects; label at most 200 units/800 bytes, consequence at most 2,000 units/8,192 bytes; IDs unique. |
| `state` | yes | `open`, `answered`, `superseded` or `withdrawn`. |
| `answer` | yes | `null`, or strict `{exactText, confirmedText, direction, answeredAt}`. Exact and confirmed text are each at most 262,144 units/bytes; direction is a same-owner reference; answeredAt is UTC ISO. Non-null exactly when `state` is `answered`. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

Silence or dismissal never answers. A stale question revision refuses. A confirmed answer creates a
new immutable direction; affected publication gates close synchronously and dependent attempts are
invalidated. Provably independent work may keep its captured direction.

### Artifacts — immutable body plus metadata

`artifacts/<artifactId>.meta.json` is a strict `artifact` record:

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision` | yes | `kind:"artifact"`, `id:"artifact_…"`, `revision:1`; no `base` or `generation`. |
| `mediaType` | yes | `text/markdown` or `application/json`. |
| `bytes` | yes | 0–1,048,576; exact body byte count. |
| `hash` | yes | Lowercase SHA-256 of the exact body bytes. |
| `role` | yes | The accepted role that produced the candidate. |
| `producedBy` | yes | Same-owner `attempt` reference. |
| `createdAt` | yes | UTC ISO timestamp. |

The body is `artifacts/<artifactId>.md` for Markdown or `artifacts/<artifactId>.json` for JSON. A JSON
body is an ordinary candidate document, not a workflow record and not an envelope. Artifact references
hash the body bytes, not the metadata file. Both files are immutable. Missing, unreadable or
metadata/body hash-mismatched artifacts are unavailable; they are never rewritten or guessed.

### `contexts/<contextId>.json` — immutable captured-source manifest

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision` | yes | `kind:"context"`, `id:"context_…"`, `revision:1`; no `base` or `generation`. |
| `sources` | yes | 0–64 same-owner `brief`, `phase-plan`, `direction` or `artifact` references. |
| `chapters` | yes | 0–64 strict `{chapterId, version, hash}` entries; version is positive, hash is the saved chapter's raw SHA-256. |
| `envelopeDigest` | yes | Lowercase SHA-256 of the exact canonical context envelope. |
| `bytes` | yes | 0–2,500,000; exact serialized envelope bytes. |
| `createdAt` | yes | UTC ISO timestamp. |

At least one source or chapter is required. The manifest embeds no source body and accepts no
unselected content. The host builds the attempt's captured prompt only from these exact references;
a changed, missing or foreign source makes the attempt stale or unavailable rather than widening the
scope.

### `admission/reservations/<reservationId>.json` — checked reservation

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"reservation"`, `id:"reservation_…"`. |
| `request` | yes | Strict request object described below. |
| `phase` | yes | `reserved`, `dispatched`, `uncertain`, `settled` or `released`. |
| `receipt` | yes | `null`, or strict `{id, outcome, accounting}` with outcome `succeeded`/`failed`/`stopped` and the accounting union above. `released` has no receipt; `settled` requires one. |
| `createdAt`, `updatedAt` | yes | UTC ISO timestamps. |

The request is exactly `{policyDigest, attempt, role, destination, requestDigest, inputDigest,
directionDigest, reviewDigest, scopeId, localRevision, globalRevision, callIndex, localReads,
outputTokens, outputBytes, maximum}`. Digests are lowercase SHA-256; the attempt is same-owner; role
is one of the accepted seven; destination is strict; scopeId is safe; localRevision is 0–2,
globalRevision 0–1, callIndex 1–4, localReads 0–8, outputTokens 1 through the role ceiling, and
outputBytes 1–262,144. `maximum` is `null` or exactly `{qualificationId, enforcement:
"provider-all-charge", hostQualified:true, tariffKnown:true, connectionId, requestDigest, policyDigest,
microUsd}`; its request/connection/policy digests and IDs must bind the request, and microUsd is a
positive safe integer. The raw codec validates that internal binding; the immutable policy and
admission ledger enforce the mode: bounded operations require `maximum:null`, and strict money
requires the qualified maximum.

A reservation ID deduplicates its entire request, including after release; the same ID with a
different request refuses. Reservations are created and settled under the single host admission lock
and persisted before transport. Only a reservation known not to have crossed dispatch intent may be
released. Timeout, cancellation or uncertainty never releases a possible charge.

### `admission/observations/<sequence>-<observationId>.json` — append-only host observation

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `generation` | yes | `kind:"observation"`, `id:"observation_…"`, `revision:1`; no `base`. |
| `sequence` | yes | Positive safe integer, unique and contiguous from 1 across the run's observations. |
| `reservation` | yes | Same-owner `reservation` reference. |
| `type` | yes | `dispatch`, `known-unsent`, `uncertain` or `receipt`. |
| `at` | yes | UTC ISO timestamp. |
| `facts` | yes | `null`, or strict `{clock:{nowMs,activeMs}, gate:"open"|"closed", accountingDurable, otherHostActive, otherAccountActive, accountLimit}`; counts are nonnegative safe integers and accountLimit is 1–4. `dispatch` requires facts; the other types require null. |
| `receipt` | yes | `null`, or the strict reservation receipt. `receipt` requires it; other types require null. |

Observations are append-only host facts, never worker claims. They are ordered by `sequence` and
never rewritten. A receipt observation does not prove exactly-once provider execution or charging.

### `admission/accounting.json` — checked accounting summary input

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion`, `kind`, `owner`, `id`, `revision`, `base`, `generation` | yes | `kind:"accounting"`, `id:"accounting_…"`. |
| `summary` | yes | Strict `{knownSubtotalMicroUsd, unknownCalls, partialCalls, pendingCalls, reservedMicroUsd, consumedCalls}`; all nonnegative safe integers, pending calls 0–4, consumed calls 0–600, and `unknownCalls + partialCalls <= consumedCalls`. |
| `clock` | yes | Strict `{nowMs, activeMs}` nonnegative safe integers. |
| `enforcementViolated` | yes | Boolean; true closes future admission after a receipt exceeds its qualified maximum. |
| `updatedAt` | yes | UTC ISO timestamp. |

Known subtotal, unknown/partial calls, pending calls and reserved maxima remain distinct. Unknown cost
is never reported as zero. The summary is derived from reservations/observations but is a checked
durable input; a failed accounting persistence closes dependent admission and never relabels saved
prose.

### Size, count and depth bounds

| Bound | Value |
| --- | --- |
| Raw JSON nesting | 64 value wrappers |
| `run.json` | 2,500,000 UTF-8 bytes |
| `plans/<planId>.json` | 2,500,000 UTF-8 bytes |
| Every other record | 262,144 UTF-8 bytes |
| Artifact body | 1,048,576 bytes |
| Context envelope | 2,500,000 bytes |
| Tasks per phase plan | 1,024 |
| Queued task references in `run.json` | 64 |
| Materialized reservation references in `run.json` | 4 |
| Impact keys per task/question | 256 |
| Attempt outputs | 64 |
| Attempt calls / local reads | 4 / 8 |
| Context sources / chapters | 64 / 64 |
| Question options | 16 |
| Journal page size | 256 |

All intersecting limits apply. Reads and streams are bounded before allocating the whole value.
Overflow preserves existing durable data; it never truncates or deletes a record.

### Ordering, retention and related-file recovery

- Commands and observations are ordered by their positive `sequence`; journal pages are ordered by
  `firstSequence` and never overlap or gap. Tasks, attempts, effects, questions, directions and
  artifacts are listed by their host-issued IDs and `createdAt`/revision metadata, never by filename
  identity or a worker-supplied path.
- There is no automatic pruning, expiry, compaction or count quota. Archive and whole-book trash carry
  the entire `workflows/<runId>/` folder, including unavailable records and conflict copies. Host
  permission is outside the library/archive and is not carried by a book copy.
- A checked write validates the actual owning book/run, the complete intended bytes, the exact
  absence/base hash **and** revision, then commits one file. Only a current semantic no-op writes
  nothing. A stale, missing or racing base preserves the complete intended record under
  `books/<bookId>/workflows/<runId>/conflicts/<relative-name>.conflict-<external-edit|missing-file>.<deviceId>.<timestamp>[-N].json`.
  The copy adds a reserved `conflictMetadata` object (`reason`, baseline token, observed token) and is
  bounded to 5,000,000 bytes. Colliding names use absent-only suffix attempts. A recovery copy cannot
  be loaded as an active record; explicit recovery must remove its copy-only context and create a
  fresh reviewed edit. A copy or active write can be uncertain after an adapter error or mismatching
  readback: report `uncertain`, keep the draft, reread storage and never replay automatically.
- Cross-file changes are recoverable sequences, not transactions. A missing, foreign, stale or
  unavailable related plan/task/attempt/effect/question/artifact/context/permission makes the
  dependent record unavailable; it never silently drops, rewrites, prunes or replays it. Persist
  dispatch/publish intent before crossing the boundary; persist the actual observation before any
  projection. A failed projection never invites another write. Default restart performs local
  recovery and requires Continue; an uncertain attempt or publication is never blindly replayed.
- In-memory run/admission snapshots are aggregates across these records. **They are never written as a
  wholesale `run.json`**, never used as a wire record and never assumed to fit a per-file bound.

## `book.json`

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Currently `1`. Files with a newer number are refused with an "update the app" error. |
| `id` | string | `book_` + 16 hex characters. Matches the folder name. Never reuse. |
| `title` | string | Shown in the library. May be empty while the author is still deciding. |
| `workingTitle` | string | Optional alternate title. |
| `description` | string | One-line premise. |
| `genres` | string[] | Free-form. |
| `influences` | string[] | Style influences, shown in the Story Bible. |
| `isErotica` | boolean | Gates explicit-content affordances. |
| `chapterRange` | `{ minimum, maximum }` | Planned length. |
| `outline` | string | Markdown outline of the whole book. |
| `storyArc` | object | `beginning`, `middle`, `end`, each with `overview`, `keyMoments` and `openQuestions`: text, one line per item. An array of strings, the shape this page once described, is read as one line per item and stays an array on disk until that part is edited. |
| `characters` | array | `id` (`char_…`), `name`, `role`, `description`, `motivations`, `notes`. |
| `memories` | array | `id` (`mem_…`), `text` (≤180 chars by convention), `importance`, timestamps. |
| `stage` | `onboarding` \| `drafting` | Setup or writing. |
| `settings.manuscript` | object | Export typography: `bodyFont`, `bodyFontSize`, `firstLineIndent`, `lineSpacing`, `chapterTitleAlignment`, `includeTableOfContents`, `preserveLineBreaks`. |
| `settings.agent` | object | Agent behavior: `disabledTools` (withdrawn tool names), `skillsEnabled`, `tone` (free text, at most 500 characters, empty means none), `answerLength` (`brief`, `standard` or `detailed`). Older books gain the defaults on read. |
| `defaultProvider` | string \| null | Provider chosen for this book (`openrouter`, `openai`, `anthropic`, `gemini`, `meta`), or `null` when not chosen. Older books gain `null` on read. |
| `defaultConnectionId` | string \| null | A connection id such as `conn_…`. The secret lives in the app's protected storage, never here. |
| `defaultModelId` | string \| null | Model id as the provider names it. A model that disappears stays recorded and is shown as unavailable. |
| `allowContributorTraining` | boolean | Default `false`. Explicit consent to use a training-eligible model such as Muse Spark Contributor with this book. The model picker sets it; migrations never do. |
| `frontMatter` | record | Legacy free-form pages, keyed by page id (an earlier studio's subtitle, author, dedication and so on). Kept exactly as written and never exported; the Format dialog lists what it holds and converts it into `matter` only when the author asks (D-169). |
| `matter` | object, optional | Ordered front and back matter (D-169), below. Absent in older books. |
| `createdAt`, `updatedAt` | ISO 8601 | Written by the app. |

Unknown fields are preserved when a book is written, so a newer app can add fields without the
older one silently dropping them. That holds at every level: inside each character and memory, the
story arc and its three parts, `chapterRange` and every `settings` section, as well as at the top.

### Saving `book.json`

Several writers share `book.json`: the Story Bible, the book and format settings, the model picker,
the agent's book tools, the `bookwriter` toolkit and other devices through a sync folder. It has no
`version`, so a save works field by field:

- The editor sends only the top-level fields it changed, each with the value it started from.
- The main process reads the file again under the book's write lock and merges each change onto that
  read. A field the editor did not change is never written. Unknown keys survive at every level, and
  a part nobody changed keeps the shape another writer gave it. The exception is a list of records
  that is written: each of its records is written in this build's shape, so a missing default such
  as `notes: ""` is filled in.
- Objects merge key by key. `characters` and `memories` merge record by record, by `id`, so an added
  memory and an edited character never collide. A record's `updatedAt` takes the later stamp.
- The default provider, connection and model (`defaultProvider`, `defaultConnectionId`,
  `defaultModelId`) are one choice. An editor that changes any of them sends all three, and if another
  writer changed any of them since the editor read, the file keeps all of their choice and the
  editor's whole choice goes to the copy, so a connection is never paired with a model it does not serve.
- The file is replaced atomically, and only while it is still the version that was read. If another
  writer got in between, the merge runs again on the new read.
- Where another writer changed the same part since the editor read it, the file keeps their value and
  the editor's whole version of the book is kept as
  `conflicts/book.conflict-external-edit.<deviceId>.<timestamp>.json`. The parts only the editor
  changed are saved as usual. The Story Bible says which fields overlapped and offers to show the copy;
  the agent's tools tell the model where the copy went. The copy is listed with the book's other
  conflict copies, so the workspace's saved-copies banner offers it too.

A caller with no earlier read, such as the import, replaces whole fields instead. It leaves every
part it did not change as it was written, and if the file changed while it was saving it keeps its
update as a conflict copy rather than writing over the change.

### Front and back matter

`matter` holds the pages around the chapters, in the order the author set:

```json
"matter": {
  "version": 3,
  "titlePage": true,
  "author": "Ana Reyes",
  "subtitle": "A tidewater tale",
  "sections": [
    { "id": "mat_3f9c2a1b7d4e", "kind": "copyright", "position": "front", "title": "", "text": "Copyright © 2026 Ana Reyes\nAll rights reserved." },
    { "id": "mat_8a1e0c55b2f9", "kind": "dedication", "position": "front", "title": "", "text": "For those who wait." },
    { "id": "mat_c41d7e9a0b36", "kind": "about-the-author", "position": "back", "title": "About the author", "text": "Ana lives by the sea." }
  ]
}
```

| Field | Notes |
| --- | --- |
| `version` | Incremented on every accepted save, like a chapter's `version`. |
| `titlePage` | Whether a generated title page (title, subtitle, author) opens every export. |
| `author`, `subtitle` | The title page's byline and second line, at most 300 characters each. |
| `sections[].id` | `mat_` + 6 to 40 letters, digits or hyphens; unique in the list. |
| `sections[].kind` | `copyright`, `disclaimer`, `dedication`, `epigraph`, `acknowledgements`, `about-the-author` or `other`. |
| `sections[].position` | `front` (before the chapters) or `back` (after them). |
| `sections[].title` | The page's heading, at most 200 characters; empty means the page shows none. |
| `sections[].text` | Markdown, at most 50,000 characters, set like a chapter body: a paragraph is a line. |

At most 40 sections. The app writes the front sections first, then the back ones, each side in the
author's order. Every export uses one order: the title page, the front sections, the contents page
when the book asks for one, the chapters, then the back sections. A book whose `matter` is absent,
`null`, or empty (title page on, no author, no subtitle, no sections) exports exactly as before
ordered matter existed, with the title and description on its title page. Once the matter holds
anything, the title page shows the title, subtitle and author, and the description stays out of
it (Word and EPUB files keep it in their metadata).

The app reads `matter` without stopping the book from opening: a value it cannot read is kept as it
is, the Format dialog says so, saves never write over it, and every export stops with that reason
rather than leaving the matter out. Fields inside `matter` that the app does not know are kept when it
saves. Only the matter save writes `matter`; a general book update never does. The format of
`matter` changes only with `schemaVersion`.

## Chapter files

One Markdown file per chapter, named `NNNN-slug.md` (`0001-the-door.md`). The numeric prefix is the
chapter's position when the file was created, and the slug comes from its title; both are only hints.
Moving a chapter rewrites `order` inside the files and never renames them, so after a reorder the
prefixes no longer follow reading order. The order that matters is the `order` field inside the file.

```markdown
---
id: ch_6a1d0f9c2b7e4d13
title: The Door
order: 1
arc: middle
purpose: Introduce the lighthouse and the keeper's routine.
synopsis: The keeper finds the door open and the light already turning.
notes: ""
isPrologue: false
version: 7
createdAt: 2026-10-24T14:02:11.000Z
updatedAt: 2026-10-24T16:41:57.000Z
---

The door had been shut when he went to bed.
```

- `id` is stable for the life of the chapter. Renaming the file or the title never changes it. One
  file is the chapter for an `id`; a sync tool's copy is not (see [Copies of a chapter](#copies-of-a-chapter)).
- `order` is an integer ≥ 1; the book reads in its order, and chapters on the same number by file
  name, so every device shows one order. The numbers need not run without gaps: deleting a chapter
  leaves one, and a move keeps them. A move gives the chapters it shifts the numbers those places
  had and rewrites only their files, so moving a chapter from 120th to 118th rewrites three files
  however long the book is. Each of those files is an atomic write checked against its hash, and
  `version` moves on. A move cut short, for example by a crash, can leave the moved chapter and its
  new neighbour on one number; the book still reads in one order, with every other chapter in its
  place, and the next move gives each chapter a number of its own.
- `version` increments on every save the studio performs. It is how the app detects that another
  writer (another device, another editor, a sync provider) changed the file.
- Front matter is written by the `yaml` package and is stable across saves; only the fields above
  are canonical, and unknown keys are preserved. Whitespace at the end of a value, including blank lines at the end of a block scalar, is part of the value and is kept.
- The body is Markdown. Line breaks are preserved as typed.

Files with **no** front matter are readable: the app derives an id from the file name, takes the
title from the slug, the order from the numeric prefix, and treats the file as version 1. This keeps
a chapter written in another editor from being invisible.

### Canonical body text

Saving normalises the body so a re-save is a no-op:

- CRLF and CR become LF.
- Leading and trailing blank lines are removed; the file always ends with exactly one newline
  (an empty chapter stays empty).
- Nothing else is touched: no wrapping, no trailing-space stripping, no Markdown rewriting.

### Imported Word documents

A Word document imported by the desktop app becomes ordinary chapter files; the format does not
change. Each body is canonical Markdown made from the document. Each Word paragraph becomes one
block, blocks are separated by one blank line, and each empty paragraph adds one more. Line breaks
are kept. Bold and italic become `**` and `*`, list items become `- ` or `1. ` lines, and quote
paragraphs become `> ` lines. Table cells become plain lines, and a heading that does not title a
chapter stays a `#` line. Text is otherwise kept as written. A chapter's title comes from the heading
that starts it.

Images, footnotes, endnotes, comments, page headers and footers, and the tracking of changes are
not stored in the library. Tracked changes are imported as if accepted. The import report lists
everything left out instead.

## Chapter history

`books/<bookId>/history/<chapterId>/<timestamp>-<label-slug>[-n].md` holds one saved-text
record per ordinary file (D-175/D-176, [ADR 0016](adr/0016-chapter-history.md)). The timestamp
is UTC ISO with milliseconds and `:`/`.` replaced by `-`; the slug is a 60-character
filename hint, never identity. Collisions append `-2`, `-3`, etc., with absent-only atomic
commits. Creating a record never replaces an existing record; intent transitions use the checked update described below. Capture is explicit and never runs on ordinary saves.
The filesystem adapter's existence check and rename are not a cross-process compare-and-swap;
an external writer racing between them is outside that guarantee. Returned bytes are checked
against the intended snapshot. A write/readback failure can leave a complete snapshot: review
history before retrying. The core never automatically retries or deletes an unconfirmed write.

Front matter is required, followed by a blank separator line and the canonical Markdown body:

| Field | Contract |
| --- | --- |
| `schemaVersion` | `1`; future versions are refused without rewriting. |
| `id` | Stable `hist_` plus at least six letters, digits or hyphens. |
| `kind` | `snapshot`, `safety`, or `intent`. The current capture operation creates only `snapshot`. |
| `bookId`, `chapterId` | Stable owning IDs; both must match the requested history directory. |
| `label` | Nonblank single line, at most 200 Unicode code points, no control characters. Explicit capture trims surrounding whitespace; reads never trim or truncate metadata. |
| `capturedAt` | UTC ISO 8601 with exactly millisecond precision. |
| `sourceVersion` | Nonnegative safe integer: version of the saved source chapter. |
| `sourceHash` | Lowercase hexadecimal SHA-256 of the raw source chapter file. Historical provenance, not a later restore base. |
| `bodyHash` | Lowercase hexadecimal SHA-256 of the UTF-8 canonical body; intents use the empty body's hash. |

Intent metadata additionally contains `selected` and `safety` references, each with
`fileName`, `id`, and `hash` (raw history-file SHA-256), and `intendedBodyHash`.
`sourceVersion`/`sourceHash` identify its checked pre-restore base. Its `state` is `prepared`,
`applied` (requires `result: { version, hash }`), or `undone` (requires both `result` and
`undoResult: { version, hash }`). Prepared intents have neither result; applied intents
have no undo result. Intent bodies are empty.

The restore core adds optional loose `plannedResult: { version, hash }` and
`plannedUndoResult: { version, hash }`. These hold the next complete serialized chapter's exact
version and raw-file SHA-256, computed before the respective write, not just its body hash.
`plannedResult` remains through applied/undone states; `plannedUndoResult` is allowed only on
applied/undone intents. When present, finalized results must equal their plans. Older records
remain readable; a prepared intent without an exact plan is uncertain. Recovery reads never replay
writes or infer ownership from matching prose. Exact identity matches permit checked undo of a
restore, including interrupted finalization; an interrupted undo plan is reported for review, not
silently retried. Identity is not authenticated provenance.

Restore verifies a visible safety record and prepared intent before starting the chapter writer.
Undo persists its plan in that intent first. Updates are expected-raw-hash guarded, with unknown
supported fields preserved. Both operations exact-check current version and raw hash within the
existing book queue, including equal bodies, and use the journal-aware checked writer. They preserve
current metadata values and replace only the body plus normal version/update-time bookkeeping;
even equal-body operations increment the version. Cancellation before history publication changes
nothing; after safety publication it retains safety and prepares the intent before stopping. Once
chapter writing starts, the actual saved/conflict/uncertain outcome wins over cancellation. Failed or
uncertain writes never delete selected, safety or intent material. IPC/UI and live host draft/save
gating are separate obligations; the core cannot observe editor state.

All known metadata objects are loose: supported unknown fields survive codec round-trips,
including nested references/results. Supported metadata contains plain string-keyed mappings,
dense arrays, strings, booleans, null and finite numbers. Integer numbers must be safe integers;
negative zero and numeric tokens whose value would round or underflow during serialization are
refused. Complex keys, unsupported YAML tags, Set/Date/Map values, cycles, `__proto__`, accessors
and other non-data/foreign JS values are refused before schema conversion; they are never silently
changed into another type. Acyclic alias values survive, without promising comments, anchor names
or object-graph identity. Serialization snapshots this validated metadata before asynchronous work.
No read writes back. Invalid YAML, missing required data,
wrong identity, unsupported schemas and body-hash mismatches are unavailable records, left
intact for recovery. Listing reports them individually. Parsing errors never include prose;
the complete history source-resolution path uses quiet parsing and fatal UTF-8 decoding.
Canonical body hashing uses the same normalization as chapter bodies; front-matter formatting
is not covered by `bodyHash`. An open result also reports the record's raw-file hash.

Capture requires a confirmed saved state and exact source version/hash, reads only the saved
file, and requires its persisted chapter ID (headerless fallback IDs cannot anchor history).
It verifies raw source hashes and refuses a changed, missing, unreadable or future-schema source. It never flushes a draft or
changes chapter bytes. Hosts must check their live draft/save state before requesting capture.
List/open work even while the chapter is in trash; comparison requires the current saved
chapter and identifies its two bodies as saved text, excluding any draft.

History follows a stable chapter ID through title, filename and order changes. Chapter trash
leaves history in the book; whole-book trash carries it with the entire folder. Portable
archives include ordinary files' exact bytes and hashes by the author-file rule, including
unknown or unavailable record contents; history validation happens when those records are read.
Filesystem links and special entries are unsupported. Direct access refuses them; metadata-only
history inspection lists unsupported `.md` entry names as unavailable without reading their
targets. They remain excluded from ordinary archive traversal.
No automatic pruning, count/size quota, expiry or compaction applies, including to intents.
List sizes come from storage stats, not a format field. Storage failures never delete recovery
material. Future explicit deletion must move a record to recoverable chapter trash and protect
restore dependencies; no deletion operation is provided by the saved-only core.

## Conversation files

`threads/<threadId>.json` stores one agent conversation. It is written through the same atomic commit
as a chapter and is not part of `library.json`; a missing or stale catalog never loses a conversation.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Currently `1`. A newer version is refused. |
| `id` | string | `thread_` + at least 6 letters, digits or hyphens. Matches the file name. |
| `bookId` | string | The owning book. |
| `title` | string | Author-facing label; defaults to "New conversation". |
| `createdAt`, `updatedAt` | ISO 8601 | `updatedAt` changes on every save. |
| `messages` | array | Each has `id`, `role`, `parts`, optional `model`, `mode` and `usage`, and `createdAt`. New user submissions and assistant outcomes record their fixed turn `mode` (`discuss` or `edit`); older messages have none and are shown as unrecorded, never inferred from the current composer. |
| `checkpointTurns` | string[] | Turn ids whose checkpoints belong to this conversation, newest last: each turn that changed the book and saved its checkpoint, including one stopped while it waited for approval and one that failed before it stored a reply. Undo takes the book's newest checkpoint, so the chat offers it only on the last of these, and names that turn: if another change now owns the newest checkpoint, nothing is undone (see [Agent turn checkpoints](#agent-turn-checkpoints)). An undo removes its turn from every conversation that lists it. A branch copies its source's list when it keeps the newest of these turns, and starts with none otherwise. |

Message parts are `text`, `reasoning`, `tool-call`, `tool-result`, `source`, `file`, `error` and
`guidance`. Tool calls and results keep their ids, so a resumed conversation can be inspected
without replaying prose. A call that failed, including one whose tool threw, ends in a `tool-result`
with `isError: true` and an output of `{ "ok": false, "message": … }`. An approved overwrite, line
deletion, split or merge that found its chapter changed since it was proposed also carries
`"changedSinceRead": true` and the `chapterId`, and an overwrite carries `savedAs`, the library-relative
path of the conflict copy that holds its text (see [Saving and conflicts](#saving-and-conflicts)). A `guidance` part carries one turn of author instructions (1–2,000
characters, never truncated) with the submitted user message; it applies to that turn only.
The schema lives in `packages/core/src/agent/messages.ts`.

Stored error explanations are limited to 2,000 UTF-16 code units. Longer provider details carry an
explicit shortening marker; retry-wait explanations and checkpoint-loss warnings are retained.
The numeric `retryAfterSeconds` field supports up to 86,400 seconds. A longer provider wait is
preserved as seconds in the stored explanation instead of being clamped; the live terminal event
still carries the original wait. Conversation validation or persistence failure cannot suppress
the turn's terminal event.

A corrupt file is never rewritten or deleted by a list operation; opening it reports the error. Thread
writes use the library port's checked commit, so a failed write leaves the previous file intact.

## Agent turn checkpoints

`.studio/checkpoints/<at>-<turnId>.json` inside a book folder is the undo point for one agent turn.
`<at>` is the time of the turn's first change, with `:` and `.` replaced by `-`. The turn writes the
file again, whole and atomically, each time it changes a chapter and before the tool answers the
model. A change made after an approval is covered as fully as one made before it. A turn has at most
one file; undo restores from the newest file, then removes it and takes its turn out of every
conversation's `checkpointTurns` (see [Conversation files](#conversation-files)). Each write and removal
is noted in this device's sync journal (see [Sync journals](#sync-journals)), so a drift scan does not
list the studio's own checkpoints; one written or removed by another device is still listed. The newest
file is the one whose name sorts last. An undo that names its turn, as the chat's does, goes ahead only
while the newest file is that turn's; otherwise it restores nothing, removes nothing, and says which
request and chapters the newest file holds. The control plane's undo route accepts the same turn id. The
ambient strip, the CLI, MCP and the phone name no turn and take the newest file.

| Field | Type | Notes |
| --- | --- | --- |
| `turnId`, `bookId` | string | The turn and its book. |
| `at` | ISO 8601 | When the turn first changed the book. Later saves keep it, so they rewrite the same file. |
| `prompt` | string | The author's request. |
| `entries` | array | One per chapter the turn changed. Undo walks them from last to first. |

Each entry has `chapterId`, `title` and `before`, the body text the chapter had before the turn first
wrote it. Optional fields:

- `created: true` marks a chapter the turn created. Undo moves it to the trash.
- `deleted: true` marks a chapter the turn deleted. Undo moves the chapter's own file back out of the
  trash (see `trashedAt`), so it keeps its id and front matter, then restores its text and details if
  the turn changed them too. When the file is no longer in the trash, `trashedAt` is refused, or the
  entry has no `trashedAt`, undo writes a new chapter with that title and `before` as its text, and
  says so. A
  deleted chapter that is already back in the book is left as it is and reported.
- `trashedAt` is where a deleted chapter's file went, the library-relative path
  `.studio/trash/<bookId>/<file>.md` that the delete returned. Undo accepts no other path, and only a
  file that holds this chapter's id.
- `order` is the 1-based position undo puts the chapter back at. For a deleted chapter it is where the
  chapter stood. For a moved chapter it is where the chapter stood before the turn first moved it.
- `afterHash` is the SHA-256 (hex) of the body text the turn left. Undo leaves a chapter whose body
  no longer has this hash and reports it as skipped, so it never writes over a later edit. The front
  matter is not hashed, because moving one chapter renumbers its neighbours without changing their
  text.
- `meta` holds the chapter's details before the turn first changed them: `title`, `synopsis`,
  `purpose`, `notes`, `arc`, `color` and `isPrologue`. Undo puts them back with a checked write.
- `afterMetaHash` is the SHA-256 (hex) of those seven details as the turn left them, hashed as a JSON
  array in that order. Undo leaves a chapter whose details no longer have this hash and reports it,
  as it does for text. `order`, `version` and the dates are not hashed, for the same reason.
- `outsideEdit: true` marks a chapter someone else wrote in between two of the turn's own changes,
  for example while an approval was waiting: the text or details a tool found were not the ones the
  turn had left. Undo first keeps the chapter's file, byte for byte, as a conflict copy with the
  reason `undo` (see [Saving and conflicts](#saving-and-conflicts)), then restores the chapter. If the
  copy cannot be written, undo leaves the chapter as it is. A chapter the turn created goes to the
  trash whole, so it needs no copy.

Restoring is an ordinary checked save: the body comes back exactly, and `version` and `updatedAt`
move forward. A checkpoint written before `afterHash` existed
restores over the current text, as it always did. One written before `meta`, `afterMetaHash`,
`outsideEdit` and `trashedAt` existed is read as before: it restores no details, keeps no copy, and
brings a deleted chapter back as a new one. A chapter the turn created and then deleted leaves
no entry, and a turn whose changes cancel out leaves no file.

Undo reports how many chapters it restored and how many it skipped, the conflict copies it kept, each
with the chapter's id and title and the copy's library-relative path, and one sentence for each chapter
that did not simply go back.

## Saving and conflicts

Every save carries the version and hash the editor started from. The main process, which is the only
writer, compares them with what is on disk:

| Situation | Result |
| --- | --- |
| Content equals the file | No write, no version bump. |
| `disk.version > base.version` | Conflict copy, reason `newer-version`. |
| `disk.hash ≠ base.hash` | Conflict copy, reason `external-edit`. |
| Otherwise | File replaced atomically, `version + 1`, `updatedAt` refreshed. |

A conflict never overwrites the other writer. The local text is written to
`conflicts/<name>.conflict-<reason>.<deviceId>.<timestamp>.md`, the UI shows both versions, and the
author chooses: *Show the saved copy* or *Load the version on disk*. A Story Bible or settings save
that overlaps another writer keeps the author's `book.json` the same way, as
`conflicts/book.conflict-external-edit.<deviceId>.<timestamp>.json` (see
[Saving `book.json`](#saving-bookjson)).

One conflicted save writes one copy. The editor never saves words a copy already holds against the
same base again, and drops the draft it held for them, so loading the version on disk, closing and
quitting write no second copy. Words typed after the conflict are new, so they get a copy of their own.

An agent edit that waits for the author's approval is checked the same way, against the version and
hash the chapter had when the author was asked. If the chapter was saved in between, an approved
`overwrite_chapter` keeps the file on disk and writes its text as a conflict copy with the usual reason,
and an approved line deletion, split or merge writes nothing. The chat says so on the step, and offers
the overwrite's copy.

The front and back matter saves the same way: the save carries the `version` and a SHA-256 of the
matter the author started from (its JSON as the app parsed it). When either no longer matches what is
on disk, nothing is written over it: the author's matter is kept as
`conflicts/front-and-back-matter.conflict-<reason>.<deviceId>.<timestamp>.json`, a JSON object
`{ "matter": … }` exactly as they had it, and the Format dialog shows the matter now on disk with the
copy's name and a *Show the saved copy* action. A `book.json` that another writer replaces while the matter is saving is refused, and the
author's change is saved again on their next change or when the dialog closes.

Ordinary book metadata updates also commit against the SHA-256 of the `book.json` snapshot they
read. If another writer changes that file before the commit, the newer bytes stay in place and the
studio's proposed book is kept as `conflicts/book-metadata.conflict-external-edit.<deviceId>.<timestamp>.json`
with shape `{ "book": … }`. The update reports the conflict instead of claiming it was saved.

Undo of an agent turn uses the same folder and naming with the reason `undo`. Before it restores a
chapter that someone else wrote in during the turn, it keeps the chapter's file exactly as it is, and
keeps nothing if the file changed since undo read it.

Writes go through a sibling temp file, `fsync`, and `rename`, with one retry for Windows sharing
violations. Writes for a single book are serialised, so two IPC calls cannot interleave. The temp
file is named `.<file name>.<process id>.<milliseconds in base 36>.tmp`, for example
`.book.json.4242.mhl7x2ps.tmp`. It exists only for the moment of the write; the studio's watcher never
reports a file of that shape, and nothing should sync, edit or keep one.

## Words kept after a failed close or quit

When the last save before a window closes or the studio quits cannot write a chapter (a full disk, a
read-only or locked folder, a chapter file that is missing, a library folder renamed while open), the
unsaved text is kept in the studio's own profile, never in the library, at
`<userData>/recovery/rec_<16 hex digits>.json`:

```json
{
  "version": 1,
  "id": "rec_0f3c9a1b2d4e5f60",
  "bookId": "book_1f4c8a2b9d3e5a71",
  "chapterId": "ch_6a1d0f9c2b7e4d13",
  "content": "The whole chapter text as it was in the editor.",
  "baseVersion": 4,
  "baseHash": "…",
  "keptAt": "2026-11-04T07:15:00.000Z",
  "reason": "The disk is full. Nothing was replaced.",
  "libraryRoot": "/Users/…/Writing"
}
```

- `baseVersion` and `baseHash` are the chapter's version and SHA-256 the words were typed against.
  `libraryRoot` is shown, never matched: a library folder that was renamed keeps its book ids.
- Each file is written atomically with mode `0600`, in a folder with mode `0700`. A failure that
  repeats writes a new file, so later words never replace earlier ones; an identical copy (same
  chapter, base hash and text) is written once. A file that does not read is reported and left alone.
- The author is asked before the studio closes or quits with kept words: keep it open, or leave with
  the words kept. A hidden run logs the counts and the reason instead.
- A kept copy is offered when its book opens. *Restore words* saves it through the checked save above,
  so a chapter that changed since keeps the words as a conflict copy; the file goes once that save
  returns. *Discard words* asks first, then removes the file. Nothing else removes one: not a later
  save, not a restart, not a timer.
- It is a disposable draft, not a second source of truth. Nothing reads it as the chapter, it never
  travels in a portable archive, and deleting the folder loses only words the author has not restored.
  The browser build keeps none; its drafts are flushed into storage when the page hides.

## Trash

Deleting a chapter moves its file to `.studio/trash/<bookId>/<stamp>-<original name>.md`, where `<stamp>`
is the deletion time in milliseconds since 1970, written in base 36 (`mh3k2x1c-0002-the-door.md`). Nothing
is unlinked. Restoring is a file move back into `chapters/`. Undo of an agent turn makes that move for
a chapter the turn deleted: the file goes back under its original name, or the next free one, with its
id and front matter, and only when no chapter with that id is in the book.

Deleting a book moves its whole folder to `.studio/trash/books/<stamp>-<bookId>/`, with the same stamp. The folder keeps
its `book.json`, chapters, conflicts and checkpoints, so restoring is a move back into `books/`.

## Sync journals

`.studio/sync/<deviceId>.json` is this device's baseline for drift detection: the last observed hash of
each author-owned file, the hash this device last wrote, and tombstones for deletions. It is written
after a reviewed scan, never during one. The chapters, conversations, images and agent checkpoints
the studio writes or removes are noted in it as this device's own, so a scan does not list them. For
an existing file, the intended save hash is recorded before the atomic file commit as well as the
observed hash after it. If the process stops between those writes, a later scan still recognizes the
exact committed bytes; a different on-disk hash remains an outside change for review. A
conflict copy is not, because the save that made it still needs the author's review. Notes take
turns, so two made at once both land. It contains no prose or credentials, is excluded from portable
archives, and is safe to delete; the next scan rebuilds it by comparing the files and warns that it had
no baseline. A journal copied from another device is ignored by its device id.

## Migration record

`.studio/migrations.json` maps each imported legacy book's content fingerprint to the book it
created: `{ version: 1, books: { "<sha256>": { bookId, title, importedAt } } }`. The fingerprint is
the SHA-256 of the canonical legacy book payload, so a second run over the same export recognises
every book whose target still exists, imports nothing, and names each recognised book in the report.

It contains no prose, only ids, titles, timestamps and hashes. Like sync journals it is excluded
from portable archives: restoring an archive and re-importing the same export imports the books
again. Deleting it is safe; the next run simply imports every book in the export.

## `library.json`

A cache for the library grid: `{ schemaVersion, app: "ai-book-studio", updatedAt, books: [...] }` where
each entry is `{ id, title, description, stage, chapterCount, wordCount, updatedAt }`.

It is derived and best-effort. The app rebuilds it from `books/*/book.json` on open and after each
change, and never reads it as truth. Deleting it is safe; a stale copy in a sync folder is harmless.

## Portable archive

A whole library can travel as a ZIP with a root `manifest.json` (format version, app version,
creation time, entry count, expanded size, and each file's relative path, size and SHA-256). The
archive is a transport format, not a second source of truth: importing writes the ordinary files
back and then opens them.

- Include every author-owned file, including unknown files, images, conflicts and trash.
- Exclude `library.json`, everything under `.studio/` except `.studio/trash/`, and any temporary or
  lock file. Credentials are never in a library and are rejected if an archive claims to contain one.
- Import only into a new or empty folder; never merge with or replace an open library.
- Validate the manifest, normalized relative paths, duplicates, entry count (10,000), expanded size
  (2 GiB total, 512 MiB per file), format/schema versions and every hash before publishing.
- A failed import removes the files it wrote and leaves an existing destination untouched.

The contract is in [`specs/010-web-target/contracts/archive-v1.md`](../specs/010-web-target/contracts/archive-v1.md)
and [ADR 0012](adr/0012-portable-library-archive.md).

## Copies of a chapter

When two machines write the same file through a sync service that cannot merge them, the service
keeps both, and the copy keeps the original's front matter, `id` included. Exactly one file is a
chapter's own file. The studio lists, opens, saves, edits the details of and trashes only that file;
every other file is a copy.

A file in `chapters/` is a copy by its name when it carries one of these marks:

| Source | Example |
| --- | --- |
| iCloud Drive | `0002-the-lighthouse 2.md` |
| Google Drive | `0002-the-lighthouse (1).md` |
| Dropbox, Nextcloud | `0002-the-lighthouse (MacBook's conflicted copy 2026-11-04).md`; Dropbox's `(Case Conflict)` and `(Selective Sync Conflict)` too |
| Syncthing | `0002-the-lighthouse.sync-conflict-20261104-093000-ABCDEF1.md` |
| This studio | `0002-the-lighthouse.conflict-external-edit.<deviceId>.<timestamp>.md` |

The iCloud and Google Drive marks count only after a name the studio writes, `NNNN-slug.md`, so a
chapter named `Chapter 2.md` in another editor is still a chapter. Only the exact marks count, so
`Part Two (The Conflict).md` is a chapter too. A copy by name is never read as a chapter, whatever
its front matter says.

When several readable files without such a mark carry one `id`, the chapter's own file is chosen by
name alone:

1. a name the studio writes, `NNNN-slug.md` (`0002-the-lighthouse.md`, or `0002-the-lighthouse-2.md`
   when that name was taken);
2. then the shorter name;
3. then the first name in character order.

The rest are copies. File dates are not used, for two reasons: every device must pick the same file,
and an atomic save gives the chapter's file a new creation date, so "the oldest file" would hand the
chapter to its copy at the next save. A copy that is newer, by date or by `version`, never takes the
original's place.

The studio never writes, renames, moves or deletes a copy. It stays where the sync tool put it and is
listed beside the copies in `conflicts/`: the workspace counts them in its *saved copies from earlier
sync conflicts* line, whose *Show in folder* action opens the folder at the first copy, and the sync
review lists the copies named as such. Resolving a copy is a deliberate act by the author, not an automatic merge. Deleting a chapter
trashes only its own file, and a copy named as one stays a copy. A copy that carries no mark, such as a
Finder duplicate (`0002-the-lighthouse copy.md`), is told apart only while the original is there: once
the original is in the trash, the copy is the only file with that `id` and opens as the chapter.

## Version compatibility

`schemaVersion` is checked on read:

- Missing → the file is not ours; the error names the file.
- Greater than the app's → refused, with "This library was written by a newer version of Open Book
  Studio. Update the app to open it." The same check runs before every write into the book, because
  another device may upgrade `book.json` while the book is open. A chapter save, a new, moved,
  deleted, restored, merged or split chapter, a kept copy, the Story Bible and every settings save,
  images, conversations, moving the book to the trash, the agent's tools and the toolkit's saves are
  all refused with that message before anything is written.
- Lower → accepted; the app writes the current version on the next save.

A book folder that does not open is never hidden. The library shows it as a card that says why, with a
*Show in Finder* action on desktop (*Show in folder* off macOS), and leaves its folder exactly as it is:

| `book.json` | The card says |
| --- | --- |
| A newer `schemaVersion` | "This book was saved by a newer version of the studio", with the title it carries |
| Missing, empty, or an iCloud `.book.json.icloud` stand-in | "This book is still syncing" |
| Anything else that does not read: not JSON, no `schemaVersion`, the wrong shape, no permission | "This book's details could not be read" |

`library.json` lists only the books that open.

## Privacy

Library files are the only copy. The app has no account, no telemetry and no server-side copy. It
writes exactly four things outside the library: the library path in `studio.json`, window bounds in
the same file, an OpenRouter key (later, in the macOS Keychain), and words a close or quit could not
save, in `recovery/` in the same profile, until the author restores or discards them.

## Images

`images.json` is the source manifest for `images/`. It is versioned like `book.json`; a newer
`schemaVersion` is refused rather than rewritten. An unknown or corrupt manifest yields an empty
gallery with a warning, and the image files stay on disk.

```json
{
  "schemaVersion": 1,
  "images": [
    {
      "id": "img_6a1d0f9c2b7e4d13",
      "kind": "chapter",
      "chapterId": "ch_6a1d0f9c2b7e4d13",
      "characterId": null,
      "fileName": "img_6a1d0f9c2b7e4d13.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024,
      "bytes": 184320,
      "sha256": "…",
      "prompt": "a lighthouse in a storm, ink and wash",
      "provider": "meta",
      "model": "muse-image-1.0",
      "size": "1024x1024",
      "source": "generated",
      "createdAt": "2026-10-26T12:00:00.000Z",
      "cutoutOf": null,
      "costUsd": 0.01
    }
  ]
}
```

- Image bytes are written first, then the manifest, both atomically through the library port. A
  failed manifest write removes the new file when it can and otherwise reports an orphan.
- `kind` is `chapter`, `character`, `cover` or `other`; `source` is `generated` or `imported`.
  `cutout` is a legacy source: a book saved by an earlier build may hold one, and the studio still
  reads, shows and exports it, but never writes a new one (D-158).
- A chapter has at most one attached image. Attaching another clears the previous `chapterId` in the
  same manifest commit.
- `cutoutOf` is legacy too: on an earlier build's SAM cutout it points at the source image, which was
  never modified. The studio writes `null`.
- The manifest and every image are author files and travel in the portable archive. No image is stored
  in `book.json`, the catalog or the app profile.
