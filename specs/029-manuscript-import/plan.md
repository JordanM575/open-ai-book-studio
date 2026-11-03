# Plan: manuscript-file import

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)  
**Status:** Draft / Planned — no implementation has started

## Shape

Add a separate one-file-to-one-new-book journey. The desktop main process owns the native picker and source reads; shared, platform-neutral code validates and maps text; the existing library boundary stages and publishes ordinary book files. The author reviews a deterministic preview and confirms before any book is visible. The source file is read-only throughout.

This does not extend `importLegacyBackup`, the JSON migration in spec 003, or the portable archive importer in spec 010. In particular, the new flow is one book and all-or-nothing publication: it does not inherit multi-book processing or “completed items remain after cancel” semantics.

## Current public boundary

- `apps/desktop/src/main/library/store.ts` is a thin `Library` facade over `LibraryService` in `packages/core/src/library/service.ts`. Ordinary `createBook` and `createChapter` calls publish incrementally; using them in sequence would risk exposing a partial import.
- `packages/core/src/library/port.ts` supplies library-relative reads, checked file commits, directory moves and file removal. The desktop adapter is `apps/desktop/src/main/library/fs-port.ts`; host filesystem access belongs in the main process.
- The renderer has no filesystem access. The existing IPC contract is in `packages/core/src/ipc.ts`, with validation/handlers in `apps/desktop/src/main/ipc.ts` and the bridge in `apps/desktop/src/preload/index.ts`.
- `docs/FORMAT.md` defines the ordinary `book.json` and chapter Markdown layout and the canonical body normalization. The importer should produce those same files, not a new import-only book format.
- Accepted ADR 0009 keeps library policy in a target-neutral core over `LibraryPort`. The first UI/capability may be desktop-only; that does not authorize Node or Electron dependencies in the shared parser.

## Proposed architecture

1. **Picker and read (desktop main):** Add a user-initiated native picker restricted to the accepted first-profile extensions. Resolve and read the selected source in the main process, enforce the accepted byte and text limits there, and pass validated bytes or decoded text into the pure import parser. The renderer never submits or trusts a host path.
2. **Parse and preview (shared core):** Add a pure parser/mapping layer with no Node, Electron, DOM or provider imports. It validates encoding, applies only the accepted input rules, returns ordered text segments and a proposed mapping. For the current proposal, the complete file is one chapter unless the author adds line-boundary splits; Markdown stays literal text. The UI renders the exact normalized bodies and names the normalization.
3. **Explicit author mapping (shared UI):** Provide a desktop-gated import journey in the shared application surface. The author edits the book title and chapter titles, reviews all text and boundaries, then explicitly confirms. No library write occurs while selecting or previewing.
4. **Stage and publish (library core):** Add a dedicated import operation rather than composing public `createBook`/`createChapter` calls. It creates a unique staging directory in the selected library, writes `book.json` and all chapter files through `LibraryPort`, reads them back and validates them, then publishes the directory with one atomic move into `books/<bookId>`. Before publication, failures and cancellation clean only this operation's staging content. A failed cleanup is kept unpublished and surfaced to the author. The operation must refuse to publish if the active adapter cannot meet the atomic move contract.
5. **Report and refresh:** Compute the report from the validated staged or published files and show the actual outcome, counts, mapping and normalization in the result view. After successful directory publication, refresh the derived catalog. If catalog refresh fails, the book remains a successful import because the ordinary files are authoritative.
6. **Capability honesty:** Keep the import action unavailable on web and mobile for the first profile. Enable it only for desktop targets whose native picker, safe read, path validation and atomic publication checks pass. Do not imply Windows/Linux support before the platform matrix is accepted and verified.

## Safety and cancellation model

- **Before confirmation:** the source may be read, but the library is untouched. Picker cancel, preview dismissal and confirmation cancel are no-ops against the library.
- **During staging:** cancellation is honored; the importer stops before publication, removes only its own staging files and returns a cancelled-before-publication report. Existing books remain unchanged.
- **At publication:** the atomic directory move is the commit point. Cancellation is disabled while it resolves. The UI waits and reports the actual result; it cannot claim cancellation if a complete book was published.
- **On error:** validation, source-read, staging or publication errors leave no incomplete book visible. A cleanup failure is a distinct recoverable outcome, with unpublished staging location and safe cleanup action shown.
- **After publication:** the operation is complete. A best-effort catalog refresh cannot reverse or misstate publication. Retrying the same source creates another new book only after a new explicit confirmation; there is no implicit deduplication or overwrite.

## Decisions and dependencies

Decisions 1–3 below were decided/verified 2026-11-03 and recorded in spec.md; only the desktop OS matrix stays open. The rest of this section is the original proposal record:

| Open decision | Proposed direction | Blocks | Does not block |
| --- | --- | --- | --- |
| Split, title and Markdown semantics | Whole file by default; author-selected line-boundary splits; Markdown literal; editable filename-derived book title | Parser behavior, preview controls and their acceptance tests | IPC scaffolding and isolated library publication tests |
| Input limits and decoding edges | Explicit byte/line/segment limits; strict UTF-8; no guessing or truncation | Production file reads and parser limit enforcement | Static UI shell and fake-source component tests |
| Atomic directory publication | Stage within the same library and publish with one adapter operation | Import writer and cleanup implementation | Pure parser work and UI copy |
| Desktop OS matrix | macOS is the reference; Windows/Linux only after native behavior is checked | Exposing the capability and platform acceptance | Shared-core parser tests |

Verification 2026-11-03: the desktop adapter publishes with one same-filesystem rename (atomic on the macOS reference target); cross-device moves are refused with `unsupported`; `removeDirectory` was added for staging cleanup. Web copy+delete does not qualify for atomic publication, so the first profile's publisher stays desktop-gated per FR-024. Any hard-to-reverse public architecture choice follows the repository's ADR process. Only the desktop OS matrix remains an open proposal.

## Candidate files

Implementation files are candidates only; no code is changed by this spec-authoring task.

- `packages/core/src/manuscript-import/` (new): text validation, split model, preview mapping and report model.
- `packages/core/src/library/service.ts`, `packages/core/src/library/port.ts`, and matching tests: complete staged-book publication and fault-injected cleanup contract.
- `apps/desktop/src/main/manuscript-import.ts` (new), `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, and the public IPC types: native picker/read orchestration and typed results.
- `packages/app/` and `packages/core/` capability types: desktop-gated preview, mapping, progress, cancel and result surfaces, consistent with the existing shared-app architecture.
- `apps/desktop/tests/` and `packages/core/tests/`: isolated synthetic fixtures, in-memory port failures, UI journey and hidden smoke coverage as appropriate.

## Verification approach

- Pure parser tests use synthetic byte/text fixtures for UTF-8, Markdown, headings, line-boundary splits, Unicode, newlines, empty/invalid input and accepted limits. They verify that nonblank text is neither lost nor duplicated and that canonical blank-line normalization is reported.
- Library tests use the in-memory `LibraryPort` and isolated temporary libraries; inject a failure at every stage and prove the public result is either one complete book or none.
- IPC/UI tests use synthetic fixtures only and assert that no write occurs before confirmation, cancellation remains truthful, and the report matches committed files.
- Desktop adapter conformance tests verify native file selection, main-process-only reads, path safety and atomic directory publication on each accepted platform.
- Do not use real manuscripts, credentials, providers, paid services or devices in feature checks. No implementation, testing or acceptance is claimed by this planned spec.

## Deferred scope

- DOCX import remains public long-term intent from spec 002 and the roadmap, but it is not covered by the TXT/Markdown parser or by DOCX export. It needs a parser/formatting decision, synthetic fixtures and its own acceptance pass before being enabled.
- DOC, RTF and ODT are also deferred, each pending format-specific parser support and synthetic fixtures. A generic extension filter is not evidence that a format is supported.
- Web folder access, browser origin storage, iOS and Android are deferred until those hosts can provide a user-visible source picker, safe source reads and the same complete-publication guarantee. Their availability must be capability-gated, not inferred from desktop behavior.
- Automatic heading detection, preservation/mapping of rich document structures, embedded images and Story Bible enrichment are separate future scope. No provider or enrichment work is part of this feature.
