# ADR 0009: One core, three storage adapters, browser as a second target

- **Status**: Accepted
- **Date**: 2026-10-24
- **Related**: spec 002 FR-071…FR-076, SC-015, SC-016; ADR 0001 (local-first Electron), ADR 0003
  (user-chosen sync folder), ADR 0007 (agent runtime)

## Context

The studio is an Electron application whose main process owns the library on disk. Authors have asked
to use it in a browser, on machines where they cannot install an application, and a browser build also
makes the interface cheaper to review and test.

A browser cannot offer the same storage guarantees as a desktop process, and the platforms differ from
each other:

- The File System Access API (`showDirectoryPicker`, `createWritable`, `FileSystemObserver`) is fully
  supported in Chromium-based desktop browsers from version 105. Safari, Firefox, iOS and Android
  browsers do not support it at all. Directory handles can be stored in IndexedDB, but the author must
  grant permission again after a restart according to the browser's rules.
- Origin-private storage (OPFS) is broadly supported, including Safari and Firefox, and allows
  in-place writes from a dedicated worker. It belongs to one origin and one browser profile, and the
  author or the browser can clear it.
- OpenRouter answers cross-origin requests: `OPTIONS https://openrouter.ai/api/v1/models` returns 204
  with `access-control-allow-origin: *` and permits the `Authorization` header. A browser build can
  call the provider directly with the author's key, with no server of ours in the path.
- A browser has no operating-system keychain, no directory `fsync`, no true atomic rename (the writable
  stream swaps the file when it closes), no background process after the tab is gone, and no system
  speech voices beyond the Web Speech API.

The product promise is that a book is a folder of files the author owns. That promise must hold in
every build, and a browser build must not quietly write a different format.

## Decision

Split the product into **one shared core** and **storage adapters**.

- `src/core/` contains the schemas, the Markdown and front-matter format, the library logic (catalog,
  book and chapter operations, version and hash checks, conflict policy, trash policy) and the agent
  tool definitions. It uses no Node APIs and no DOM APIs; it talks to a `LibraryPort`.
- `LibraryPort` is the only surface the core needs: read and write a file, list a directory, delete and
  restore, stat, watch for external changes, and report a device identity. Everything the product
  promises about conflicts is implemented above this interface, once.
- Three adapters implement it:
  - `fs` — Electron main process: atomic temp-file rename, directory `fsync`, draft buffer, trash,
    single-instance lock, OS keychain. The reference build.
  - `fsa` — Chromium: directory handles in IndexedDB, `createWritable` with a close-time swap, final
    save on `pagehide` and `visibilitychange`, `FileSystemObserver` where available.
  - `opfs` — Safari and Firefox: the library inside origin-private storage, with import and export of
    the portable library archive as the way in and out.
- The agent loop, the key handling and the AI calls stay in the desktop main process for the Electron
  build and in a Web Worker for the browser build, behind the same runtime interface. The browser
  stores the key in IndexedDB with an explicit disclosure; it never sends the key anywhere except the
  provider.
- The web build is specified separately (spec 010) and is held to the same book format and the same
  conflict rules, not to the same durability guarantees. Its weaker guarantees are stated in the
  interface, not only in documentation.

## Implementation status (2026-10-25)

The desktop half of this architecture has landed. `packages/core/src/library/` now owns the library
rules (`LibraryService`), the validated library-relative path type, the `LibraryPort` contract and
typed errors. `apps/desktop/src/main/library/fs-port.ts` is the Node filesystem adapter and
`store.ts` is a thin facade, so the existing IPC contract and tests run through the shared service
unchanged. `packages/core/tests/library-service.test.ts` exercises the same rules against the
in-memory port.

Still open under [spec 010](../../specs/010-web-target/spec.md): the folder and origin-private browser
adapters, the portable archive, and browser credential integration owned by spec 011. No browser
target is implied to work by this status note.

## Consequences

- The implementation plan moves the save protocol out of `apps/desktop/src/main/library/`
  into `packages/core/`. The refactor is not complete yet; spec 010 owns the extraction and
  migration of current tests to an in-memory port before adapters are added.
- Electron stops being the owner of the format and becomes one adapter. The single-instance lock,
  draft buffer and keychain are adapter features, not product invariants, and the specification says so.
- A browser build cannot promise "100% of typing survives a forced quit". It promises a best-effort
  save on hide and unload plus an honest report on the next open. The success criteria distinguish the
  two (SC-002 for desktop, SC-015 for browsers).
- Two browser tabs on one library are two writers. The core's version and hash checks still prevent
  silent overwrites, but the browser adapter must also use a storage lock where the platform offers one
  and warn where it does not (FR-069 applies to the desktop profile).
- An IndexedDB search index is not a prerequisite for the browser target. D-107 remains open
  for a future measured need; spec 010 scans source files and introduces no hidden index.
- Tests gain a second dimension: every core test runs against the in-memory port; each adapter has a
  smaller conformance suite for its own primitives.

## Rejected alternatives

- **Electron only** — simplest, but it excludes authors who cannot install software and keeps the
  interface tied to a desktop process for no product benefit.
- **A server that stores libraries** — contradicts the no-custody principle and turns a local file
  format into a hosted product with accounts, billing and a breach surface.
- **SQLite compiled to WebAssembly as the primary store** — one binary blob in the browser, opaque to
  the author, and it breaks the "your book is a folder" promise. SQLite remains a derived index only.
- **Writing a different, browser-specific format** — two formats means two migrations, two exporters
  and a class of bugs where a book opens in one build and not the other. Rejected outright.
