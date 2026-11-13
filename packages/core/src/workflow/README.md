# Workflow record storage (037 T023)

Checked, recoverable storage for the schema-1 records specified in `docs/FORMAT.md`, "Workflow
records (schema 1)". The pure codec and graph/lifecycle/admission contracts live in
`packages/core/src/authoring/`; this directory owns only the library-facing writer and its exact
paths.

## Surface

`WorkflowRecordStore` is constructed by `LibraryService` as `library.workflowRecords`. It is the only
writer for these files and has no IPC, scheduler, provider, execution, publication or deletion path.

| Kind | Path under `books/<bookId>/workflows/<runId>/` | Mutability |
| --- | --- | --- |
| `run` | `run.json` | Checked revision + exact previous raw hash. |
| `task` | `tasks/<taskId>.json` | Checked revision + exact previous raw hash. |
| `attempt` | `attempts/<attemptId>.json` | Checked revision + exact previous raw hash. |
| `effect` | `effects/<effectId>.json` | Checked revision + exact previous raw hash. |
| `question` | `questions/<questionId>.json` | Checked revision + exact previous raw hash. `listQuestions` reads the folder; it does not write. |
| `artifact` | `artifacts/<artifactId>.meta.json` + `artifacts/<artifactId>.{md,json}` | Absent-only immutable pair. |
| `context` | `contexts/<contextId>.json` | Absent-only immutable manifest. |

`brief`, `policy`, `phase-plan`, `direction`, command/receipt pages, reservation, observation and
accounting records keep their reserved FORMAT paths but have no writer in this slice.

## Invariants

- Canonical bytes come from the T018 codec and are parsed again by this build's reader before any
  commit. A newer schema is refused; malformed UTF-8, duplicate keys, lone surrogates, lossy numbers,
  depth overflow and size overflow never produce a record.
- Checked writes require the exact previous raw hash **and** revision. A missing, stale or racing base
  preserves the complete intended document under `conflicts/` and reports where it went. A
  semantically identical record is a no-op and writes nothing.
- Immutable records are absent-only. An artifact's metadata and body must agree on the exact SHA-256
  and byte count; a missing body, an orphan body, a second body or a mismatch refuses without
  rewriting either file.
- Every commit is the Library's journal-aware checked commit, and every write is compared with the
  exact bytes and hash on readback. A publication that cannot be verified is reported as
  `uncertain`; it is never retried automatically.
- Conflict copy names are bounded below the filesystem component limit; the complete record identity
  remains inside the document. There is no pruning, eviction, compaction or deletion.
- Supported unknown plain fields survive read-modify-write at every depth, including an own
  `__proto__` data property. Values from a closed semantic union that this build does not know are
  read-only and unavailable.

## Adoption receipts (beside this store)

`AdoptionReceiptStore` (`adoption-receipt-store.ts`) stores the FR-017 adoption receipts from
`packages/core/src/authoring/adoption-receipt.ts` at
`books/<bookId>/workflows/<runId>/adoptions/<receiptId>.json`. It follows this workflow
record-store pattern — the one the checked question records use — not the review record-store,
because receipts are run-scoped workflow state under the same book queue and journal. The
review store owns single-book reports and is the wrong sibling.

Reused: the injected host shape (`storage`, `runtime`, `deviceId`, per-book `withBook`,
journal-aware `commitFile`), canonical compact sorted-key bytes re-parsed before publication,
runtime SHA-256 checks, byte-exact readback (`uncertain` on mismatch), bounded observed reads,
owning-book/writable checks, the `WorkflowRecordError` vocabulary, and bounded recoverable
conflict copies under `conflicts/`. Added, because the schema-1 kinds cannot express receipts
without widening that codec: the beside-store class and `adoptions/` paths, strict absent-only
creation scoped to the candidate artifact (any existing receipt for that candidate refuses,
including a byte-identical replay), candidate/sequence uniqueness by bounded scan, and a
bounded listing sorted by sequence (page at most 256, at most 10,000 receipts per run).
Foreign book/run receipts refuse on read and list. The store validates grant/direction
references through the authoring validators but judges no adoption.

The store now has a LibraryService writer. `LibraryService` constructs it as
`library.adoptionReceipts`, bound to the open library instance and its per-book queue exactly
like `library.workflowRecords` — there is no second writer path. The publisher entry point is
`library.recordConfirmedAdoptionReceipt(bookId, runId, effectId, { grant, direction })`, which
records a receipt at the existing confirmation point: a checked effect record saved through
`library.workflowRecords.saveEffect` with phase `confirmed` and a receipt carrying
`resultVersion`/`resultHash`. That effect record carries the adopting owner, the exact candidate
and the target chapter; it does not carry a `grant` or `direction` reference, so the caller
supplies those two references from the current host permission and direction, and they are never
derived from the effect, its policy or its attempt. Inside one per-book queue hold,
`AdoptionReceiptStore.recordConfirmedAdoption` allocates the next sequence as one past the
maximum read from the store in that same hold, returns `already-recorded` for a retried
confirmation that matches the stored receipt on owner, chapter, exact candidate, result
version/hash, grant and direction, settles an uncertain write by byte-exact read-back before
reporting `recorded`, and otherwise reports `confirmed-unrecorded` with the failure's code —
the confirmed adoption is never rolled back and no receipt is claimed. Other effect phases
(`prepared`, `publish-intent`, `conflict`, `not-published`, `uncertain`) record nothing.

What remains: the cadence host does not yet count these receipts on resume
(`countAdoptedChapters` is still unwired there). Recorded questions can be listed, but the host
still does not supply that list to the pending-question reader, so host cadence supply stays
withheld.

## Question listing

`WorkflowRecordStore.listQuestions` is read-only. It asks the storage port to inspect the
questions folder, because a plain directory list can drop a name this version cannot open and can
turn a missing folder into an empty list for a different reason than a successful read. A missing
folder is an empty list. A port that cannot inspect names refuses. An unsupported name, a nested
directory, a file whose name is not a question id, a record this build cannot read, or any other
listing failure refuses the whole list and leaves the files untouched. The folder is scanned and
every question is decoded before a page is cut. A page is at most 256 questions and a run is at
most 10,000. The page is `{ questions }` store snapshots. This method does not resume cadence.

## Limits of this slice

The store does not verify cross-file references (a task's plan/direction, an attempt's context or an
effect's candidate), the exact context envelope behind a manifest's digest, host permission,
transcript streaming, dispatch, effect publication or scheduling. Those belong to T020, T022,
T024–T025, T029 and independent storage review. T023 stays unchecked until that review.

Focused checks, from the repository root:

```sh
bun test packages/core/tests/workflow
bun run typecheck
bunx --no-install biome lint packages/core/src/workflow packages/core/tests/workflow
```
