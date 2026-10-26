# 001 — Plan

## Shape

Electron main owns the files; a sandboxed React renderer owns the pixels; `src/shared` is the contract
both compile against. Decisions recorded in ADR 0001 (Electron, no server), 0002 (Markdown source of
truth), 0003 (user-chosen sync folder), 0004 (tokens pipeline).

```
src/shared/schema.ts     Zod schemas, domain types, SaveChapterResult
src/shared/ipc.ts        channel map, StudioApi, Result envelope
src/main/library/        markdown · atomic · paths · errors · store
src/main/                studio (session) · settings · drafts · ipc · index
src/preload/             contextBridge surface + d.ts
src/renderer/src/        views, components, hooks, styles
tests/library.test.ts    store behaviour against temp directories
scripts/smoke.mjs        throwaway profile + hidden window run
```

## Key decisions

- **Format.** Front matter for identity, Markdown for prose, `0001-slug.md` for stable ordering. A
  file without front matter is read with a filename-derived identity so imported prose is never
  rejected.
- **Concurrency.** `version` + `hash` per chapter, checked in the main process. Conflicts are written
  to `conflicts/<name>.conflict-<reason>.<deviceId>.<stamp>.md`; the disk file is never replaced.
- **Serialization.** A per-book promise chain (`serializeWrite`) makes read-modify-write atomic with
  respect to concurrent IPC calls.
- **Durability.** Temp file in the same directory → `fsync` → `rename`, with one retry for Windows
  sharing violations, then a best-effort directory fsync.
- **Session.** `SettingsStore` in `userData/studio.json` remembers the library root and window bounds.
  `Studio.restore()` never throws: a broken path becomes a remembered error shown on the welcome
  screen.
- **Draft safety.** The renderer debounces saves (700 ms) and pushes drafts (300 ms) to a main-process
  `DraftBuffer`; close and quit flush it through `Library.saveChapter`.
- **Build.** electron-vite; main and preload emitted as CommonJS (`[name].cjs`), renderer as an ES
  bundle. TypeScript 7 (no `baseUrl`, `paths` only).
- **Design.** `design/tokens.json` → `scripts/build-tokens.mjs` → `tokens.generated.css` + Tailwind
  `@theme inline`. Structural glass classes live in `base.css`.
- **Testing.** Unit tests against a real temp library (no fs mocks); one smoke run of the built app in
  a hidden window with `STUDIO_TEST`/`STUDIO_HEADLESS`/`STUDIO_SMOKE`, so testing never touches the
  author's profile or library.

## Phases

1. Contract and format: schemas, IPC types, markdown parse/serialise, atomic write, paths.
2. Store: open/create/read/update books and chapters, version and hash protocol, conflicts, trash,
   catalog.
3. Main process: settings, drafts, session, IPC with validation and error mapping, window, menu.
4. Renderer: tokens, base styles, welcome, library, workspace, editor with autosave, conflicts UI.
5. Verification: typecheck, 13 unit tests, hidden-window smoke, stale-profile cleanup.
6. Governance: README, AGENTS, FORMAT, ARCHITECTURE, DESIGN, ADRs, constitution, this spec set.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sync provider writes a conflict copy that looks like a chapter | Detect by name, report as conflict, never list as a chapter |
| Autosave races a manual save | Per-book write serialization; no-op detection by normalised text |
| A crash between temp write and rename | Leftover temp files are ignored; target stays valid |
| Schema drift | `schemaVersion` stamped in `book.json`; newer versions refused loudly |
| Electron main bundling ESM | Explicit CJS output for main and preload |

## Verification strategy

`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm smoke`. Manual: choose a folder, create a book, type,
quit, reopen, edit the chapter file externally, reopen and observe the conflict path.
