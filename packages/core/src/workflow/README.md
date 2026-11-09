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
| `question` | `questions/<questionId>.json` | Checked revision + exact previous raw hash. |
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
