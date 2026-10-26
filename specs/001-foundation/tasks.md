# 001 — Tasks

All tasks complete. Requirement references point at `spec.md`.

## Phase 1 — Contract and format

- [x] T001 Scaffold the repository: electron-vite, React 19, Tailwind 4, TypeScript 7, Vitest. (FR-017)
- [x] T002 Define domain schemas and types in `src/shared/schema.ts`: book, chapter, character, memory,
      manuscript settings, `SaveChapterResult`. (FR-005, FR-010)
- [x] T003 Define the IPC contract in `src/shared/ipc.ts`: channel map, `StudioApi`, `Result`. (FR-017)
- [x] T004 Implement Markdown front matter parse/serialise with filename fallback and slug rules.
      (FR-006, FR-007)
- [x] T005 Implement `writeFileAtomic` (temp, fsync, rename, retry). (FR-014)
- [x] T006 Implement path safety, layout constants, id generation and schema-version assertions.
      (FR-015, FR-017)

## Phase 2 — Store

- [x] T007 `Library.open`: layout creation, device identity, catalog rebuild. (FR-003, FR-016)
- [x] T008 `listBooks` / `readBook` / `createBook` / `updateBook`. (FR-003, FR-004, FR-005)
- [x] T009 `createChapter` with ordering, unique filenames and default title. (FR-004)
- [x] T010 `saveChapter` with no-op, newer-version and external-edit branches, conflict copy writer and
      per-book serialization. (FR-009, FR-010, FR-014)
- [x] T011 `updateChapterMeta`, `deleteChapter` to trash, `listConflicts`. (FR-012)
- [x] T012 Derived `library.json` catalog, written best-effort. (FR-016)
- [x] T013 Unit tests for every store branch against temp directories. (Acceptance)

## Phase 3 — Main process

- [x] T014 `SettingsStore` for library root and window bounds. (FR-002)
- [x] T015 `DraftBuffer` with flush-through-save. (FR-013)
- [x] T016 `Studio` session: restore, open, current, flush, bounds memory. (FR-002)
- [x] T017 IPC handlers with Zod validation, error mapping and a typed envelope. (FR-017)
- [x] T018 Window creation, menu, single-instance lock, flush on close and quit. (FR-013)
- [x] T019 Test flags `STUDIO_TEST`, `STUDIO_HEADLESS`, `STUDIO_SMOKE`. (Acceptance)

## Phase 4 — Renderer

- [x] T020 Token generator and `tokens.generated.css`; glass and wash classes in `base.css`. (FR-018)
- [x] T021 Welcome screen with folder choice and remembered-failure explanation. (FR-001, FR-002)
- [x] T022 Library screen: cards, counts, empty state, new book dialog, reveal and change folder.
      (FR-003, FR-004)
- [x] T023 Workspace: chapter rail, header totals, add and delete chapters. (FR-004, FR-012)
- [x] T024 Manuscript editor: autosave, save status, title editing, keyboard save, unmount flush.
      (FR-008, FR-009, FR-013)
- [x] T025 Conflict banner with reveal and reload actions; earlier-conflicts hint. (FR-011)
- [x] T026 Theme control with system/light/dark and reduced-motion/transparency support. (FR-018)

## Phase 5 — Verification

- [x] T027 `pnpm typecheck` clean for both projects.
- [x] T028 `pnpm test`: 13 tests green.
- [x] T029 `pnpm build` produces main, preload and renderer bundles.
- [x] T030 Hidden-window smoke: preload surface, library, open book, typing, autosave version bump.
- [x] T031 Remove the smoke-test library path from the real profile.
- [x] T032 `data-testid` hooks for the smoke test only.

## Phase 6 — Governance

- [x] T033 README with commands, layout, library tree, privacy, testing.
- [x] T034 `docs/FORMAT.md` as the normative format specification.
- [x] T035 `docs/ARCHITECTURE.md`, `docs/DESIGN.md`.
- [x] T036 ADRs 0001–0006.
- [x] T037 `AGENTS.md`, `.specify/memory/constitution.md`, this spec set.
- [x] T038 `CHANGELOG.md` 0.1.0 and `.gitattributes`; first commits pushed to Gitea.

## Discovered, deferred

- [x] Editor undo history survives a chapter switch. The editor keeps a per-chapter in-memory history,
      coalesces typing bursts, handles Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, and clears the history when the
      disk version is refreshed. The hidden smoke run switches chapters and undoes the typed marker.
- [x] Chapter reordering from the rail. Up/down controls and ⌘⌥↑/⌘⌥↓ (Ctrl+Alt on Windows) swap
      `order` metadata through `chapters:reorder`; dragging to a position uses `chapters:move`, renumbers
      only the affected orders, checks versions/hashes and rolls back a conflicting write. The hidden
      smoke run covers the buttons, the keyboard and a drag.
- [x] Disk watch: surface changes made outside the app without waiting for a save attempt. The desktop
      port watches `books/**` and `.studio/trash/**`; `Studio` debounces into a `library:event`; the
      workspace shows a refresh banner that flushes unsaved text before remounting the editor. The hidden
      smoke run edits a chapter behind the app and refreshes it.
- [x] Import of the previous app's JSON export. `legacy-import.ts`, the IPC bridge and the library button are
      covered by four parser/importer tests, including a manuscript-only backup and an unrelated backup
      that must be refused.
- [x] Component tests for the editor's debounce and conflict handling. `apps/desktop/tests/manuscript-editor.test.ts`
      renders the real editor under happy-dom + Testing Library; it proves the 700 ms debounce before the
      save call and that a conflict keeps the typed text and reports the conflict.
