# Architecture

AI Book Studio is one Electron application with a hard split between an untrusted interface and a
trusted file owner. The split is the architecture; everything else is detail.

```
┌──────────────────────────── renderer (sandboxed) ────────────────────────────┐
│  React 19 · Tailwind 4 · Liquid Glass tokens                                 │
│  Views: Welcome → Library → Workspace                                        │
│  Knows only window.studio.* (typed, promise-based)                           │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ IPC (contextBridge)
┌───────────────────────────────────┴──────────────────────────────────────────┐
│  preload: the entire surface, ~40 lines, no logic                            │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ ipcRenderer.invoke / webContents.send
┌───────────────────────────────────┴──────────────────────────────────────────┐
│  main process                                                                │
│   ipc.ts        Zod validation, Result envelope, error mapping               │
│   studio.ts     session: settings, current library, draft buffer             │
│   library/      format (markdown), atomic writes, paths, Library store       │
│   settings.ts   userData/studio.json (library root, window bounds)           │
│   drafts.ts     in-memory keystroke buffer, flushed on quit                  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ fs (atomic)
                          the author's chosen folder
```

## Why the renderer owns no files

Electron's renderer is a browser. Giving it `fs` would mean every XSS or compromised dependency can
rewrite the manuscript, and every typo in a path can land outside the library. Instead:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- A strict CSP in `index.html`; no remote scripts, no inline handlers.
- Every mutation is a named IPC channel with a Zod schema. Path segments are joined by `safeJoin`,
  which rejects escapes from the library root.

The renderer says _what_ the author did ("save this chapter with this base version"). The main
process decides _whether_ that is allowed and _how_ it is written.

## The save protocol

The only interesting piece of concurrency in the app. Each chapter carries `version` (integer in
front matter) and the renderer holds the SHA-256 of the exact bytes it loaded.

1. **No-op.** Normalized text equals what is on disk → return the disk chapter unchanged. This makes
   autosave idempotent and stops version inflation from a stray keystroke.
2. **Someone wrote first.** Disk `version > baseVersion` → keep the author's text as a conflict copy
   and report `newer-version`. Never overwrite.
3. **Someone wrote elsewhere.** Disk bytes hash differently from the base hash → same treatment,
   reason `external-edit`. This catches sync providers, a second device, or a text editor.
4. **Clean.** Write the new file atomically, `version + 1`, `updatedAt` now, return the fresh chapter
   and hash. The renderer adopts both as its new base.

Writes are serialized per book (`serializeWrite`) so two rapid IPC calls cannot interleave a
read-modify-write. `writeFileAtomic` writes a sibling temp file, `fsync`s it, renames over the target,
retries once on Windows sharing violations, and best-effort fsyncs the directory.

A conflict is a feature, not an error: the UI keeps the author typing, shows what happened, and
offers "Show the saved copy" and "Load the version on disk".

## Catalog versus truth

`library.json` is a cache of book summaries so the library screen can paint before parsing every
file. It is written best-effort after mutations and never read as a source of truth: `listBooks()`
scans `books/*/book.json` and reads the headers it needs. If the file is deleted, nothing is lost and
the next write recreates it. The same rule will govern the planned SQLite index (search, chat
history, usage): derived, rebuildable, disposable.

Chapters are read fully on demand. A 100k-word book is a few megabytes of Markdown; this is fast
enough, and it keeps the format explainable. The index exists for queries, not for editing.

## Failure behavior

- Every IPC result is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Codes:
  `not-found`, `invalid`, `format`, `newer-schema`, `io`, `internal`. The renderer surfaces
  `message` in a notice; it never sees stack traces.
- A damaged `book.json` is skipped with a warning rather than crashing the library.
- A chapter with no front matter is read using a deterministic fallback identity derived from its
  filename, then healed on the next save. Prose is never rejected for lacking metadata.
- `schemaVersion` newer than the app → refuse with "This library was written by a newer version of
  AI Book Studio. Update the app to open it." Refusing loudly beats corrupting silently.
- Quitting flushes the draft buffer through the normal save path (and therefore through the conflict
  protocol), once, before the window closes.

## Sync without a server

The library is designed to live inside a folder the author already syncs: iCloud Drive, Google Drive,
Dropbox, a NAS, or a USB stick. The app never talks to a provider and never holds OAuth tokens.

- Writes are atomic renames, so a sync client sees either the old file or the new one.
- `version` and the content hash detect concurrent edits that the provider merged badly.
- Provider "conflicted copy" files are detected by name and shown as conflicts instead of being
  treated as chapters.
- `.studio/device.json` gives each machine an id, so a conflict copy says where it came from.

This is the weakest link by nature — file sync is not a transaction log. The design goal is not to
prevent divergence but to make it visible and non-destructive.

## Processes and lifecycle

`apps/desktop/src/main/index.ts`:

1. Read test flags (`STUDIO_TEST`, `STUDIO_HEADLESS`, `STUDIO_SMOKE`).
2. Request the single-instance lock (skipped in test mode).
3. `whenReady` → load settings → `Studio.restore()` (reopen last library, remembering failure rather
   than crashing) → register IPC → build the menu → create the window.
4. Window: 1440×900, min 1024×700, `hiddenInset` title bar on macOS with insets for the glass header,
   restored bounds, denied window opens, external links to the system browser.
5. `close` / `before-quit` flush drafts once, then quit.

The menu is deliberately small: File → Open library…, Close window, Quit; standard Edit, View and
Window menus. Features arrive as interface, not as menu items, unless they are genuinely global.

## The writing agent

The writing agent runs in the main process. The boundary is:

- Provider calls happen in the main process (no CORS, no exposed key, streamed to the renderer over
  IPC events). The renderer never sees the key, only connection summaries.
- The key lives in the OS keychain via `safeStorage`, not in `localStorage` (the old app's mistake).
  The browser build uses an origin-scoped IndexedDB vault with an explicit disclosure; it makes no
  keychain or encryption claim. Browser OpenRouter sign-in uses a same-origin popup with PKCE, checked
  state and a single-use code exchange; the verifier stays in the tab's sessionStorage.
  `ProviderService` is the only desktop reader; `transport.ts` is the only module that constructs
  provider SDKs.
  Provider names and connection ids use shared Zod schemas at the IPC boundary. The credential file is
  `0600`, checked and repaired at startup, and a test scans settings and the library for the plaintext secret.
- Each turn records its provider, connection label, model id and provider-reported token/cost totals in
  `.studio/usage/<bookId>.jsonl`. The conversation shows the connection and model when it changes
  between turns.
- Tool calls map onto the same `Library` methods the UI uses, so an agent edit obeys version checks,
  atomic writes, limits and conflict handling exactly like a human edit.
- Every agent turn that changes files records a checkpoint under `books/<id>/checkpoints/` so the
  author can compare and revert.

## Multi-target: core, ports and adapters (in progress)

ADR 0009 turns Electron from the owner of the library into one storage adapter so the same product
can run in a browser. The shared service, the desktop adapter, the browser adapters and the portable
archive have landed; the real-browser folder-picker matrix and the shared UI extraction remain.

- `packages/core/` — schemas, Markdown format, library rules, conflict policy and agent tools. It imports
  no `node:` or DOM APIs. `LibraryService` owns checked saves, conflict copies, trash, search and the
  derived catalog, and is tested against an in-memory port.
- `packages/core/src/agent/` — canonical `AgentMessage`/`AgentPart` schemas and the port-backed
  `ThreadStore`. Conversations live under `books/<bookId>/threads/`; AI SDK `ModelMessage` and
  `UIMessage` conversions stay at the runtime edge (ADR 0013).
- `packages/ui/` — shared primitives, class utilities and the design system stylesheet: `Button`,
  `Dialog`, `Brand`, `Notice`, `cn`, `styles/base.css` and the generated tokens.
  `apps/web/check/gallery.html` is the light/dark visual check.
- `packages/app/` — the shared studio shell: `App`, views, product components, hooks and renderer
  utilities. The desktop renderer keeps a one-line `App` re-export; the web imports the package
  directly, and the `@renderer` alias is gone from both build and typecheck configs.
- `packages/core/src/library/port.ts` defines the target-neutral storage contract; `packages/core/tests/library-service.test.ts`
  is the conformance suite for compare-before-write, byte isolation, safe paths, conflicts, trash and injected failures.
- `apps/desktop/src/main/library/fs-port.ts` — Node filesystem adapter: atomic rename, directory `fsync`,
  device identity, and a recursive watch on `books/` and `.studio/trash/`. `Studio` debounces watch
  events into one `library:event`; the workspace offers a refresh that flushes unsaved text before
  remounting the editor. The save-time hash check remains the final guard. The main process keeps the
  draft buffer, keychain and single-instance lock.
- `apps/desktop/src/main/library/store.ts` is now a thin desktop facade over the shared service; the
  renderer contract and IPC envelope are unchanged.
- `apps/desktop/src/renderer/` — interface through the isolated preload bridge; no Node/filesystem access.
- `apps/web/src/storage/` — the directory-handle port shared by a picked folder and OPFS, folder access,
  IndexedDB handle storage, capability detection and cross-tab Web Locks (spec 010). The adapter writes
  through a swap file, re-checks the target hash before the commit point and verifies the read-back.
  Archive download/upload is in `archive-io.ts`; `apps/web/tests/storage/` covers save failures, picker
  cancellation, permission mapping and draft buffering. The real-browser folder-picker matrix remains.
- `apps/web/` is the static browser shell: Vite builds the real renderer (currently through an `@renderer`
  alias to the desktop app) over the browser storage adapters. The hidden web smoke covers origin storage,
  create/save/reopen, build metadata, a stale-save conflict and a portable archive export. Shared UI
  extraction into `packages/ui` remains.
- `apps/mobile/` is the Capacitor 8 iOS shell. `webDir` is `../web/dist`, so `cap sync` ships exactly the web build; `scripts/run-sim.sh` builds and launches on a simulator. Safe-area padding lives in the shared `base.css` `#root`, not in the shell.

The practical consequence today is to keep new logic independent of `node:fs` and to add any required
filesystem primitive to the port rather than calling Node from a new module.

## Sync journal and drift detection

The sync baseline is device-local at `.studio/sync/<deviceId>.json`; it is excluded from archives and
safe to delete.

- `packages/core/src/sync/scan.ts` enumerates `books/**` and `.studio/trash/**`, probes provider
  placeholders before reading, and reads book schema and chapter identity from the bytes it hashes.
- `packages/core/src/sync/detector.ts` is read-only. It classifies remote changes, both-changed, renames,
  deletions, conflict copies, placeholders, unreadable files and newer schemas. Trash is not a rename
  destination: a chapter moved there is a deletion.
- `packages/core/src/sync/journal.ts` writes atomically and turns a missing file into a tombstone. A
  copied, corrupt or foreign-device journal is treated as no baseline and produces a warning.
- `apps/desktop/tests/sync/` is a two-system harness. Ten scenarios cover clean and concurrent edits,
  offline delivery, deletion, placeholders, torn copies, corrupt journals, repeated scans, provider
  conflict copies and renames. Every one asserts the report and that author bytes survive.

The drift report UI and the app lock are not built. `.studio/device.json` inside a synced folder is the
open D-124 question: a provider can copy the identity, so the authoritative device id should move to the
host profile before the review UI claims the journal is per-device.

## Testing seams

- The current `Library` implementation still uses `node:fs` and is tested directly in
  `apps/desktop/tests/library.test.ts` with temporary directories.
- `packages/core/tests/library-port.test.ts` tests the new port contract and in-memory implementation.
- `smoke.ts` drives the built app in a hidden window: preload surface, fixture library, opening a
  book, typing and autosave to disk, chapter reorder and build metadata. `scripts/smoke.mjs` builds a
  throwaway profile so it never touches the author's library.
- `apps/desktop/tests/manuscript-editor.test.ts` renders the real editor under happy-dom and Testing
  Library for the debounce and conflict states. `apps/desktop/tsconfig.json` declares the `@renderer`
  path so Bun resolves the renderer modules outside Vite.
- `apps/web/tests/storage/` covers the directory-handle port, save failures, folder picker/permission
  mapping and draft buffering with fake handles. `scripts/web-smoke.mjs` drives the built web shell in a
  hidden Chromium window through origin storage, save, reopen, build metadata, a stale-save conflict and
  an archive export.
- `data-testid` hooks exist on the structural nodes the smoke test needs; they are not a general
  invitation to test implementation details.

## Known debts

- No SQLite index yet (spec 002); `listBooks` re-reads every book.
- The real-browser folder-picker/permission matrix and the full Playwright run are not done (spec 010
  T013/T027); the shared shell and stylesheet now live in `packages/app`/`packages/ui`.
- No component tests; UI is covered by the smoke run only.
- Single window, no tabs, no multi-library switching without reopening.
- Autosave debounce is 700 ms with a draft buffer behind it. The editor keeps a per-chapter in-memory
  undo/redo history; it is not persisted across relaunch.

## Voice dictation

Dictation is a desktop capability with one provider path:

- `packages/core/src/providers/speech.ts` owns the Meta contract: `POST /v1/asr/transcribe`, the
  `muse-voice-transcribe-1.0` model, the `request` JSON part plus the `audio` WAV part, the 32 MB and
  ten-minute caps, and the WAV header/duration checks. It is pure and has no key.
- `apps/desktop/src/main/voice.ts` selects a Meta connection, reads the secret in main, posts the form
  and normalizes provider errors. The renderer sends an `ArrayBuffer` over IPC; it never receives the
  secret or the raw provider response.
- `packages/app/src/lib/audio.ts` decodes the `MediaRecorder` blob, mixes to mono, resamples to 16 kHz
  and writes 16-bit PCM WAV in memory. `useDictation` owns the microphone lifecycle and the ten-minute
  cap. `VoiceButton` shows the recording timer and the transcription state.
- The transcript enters `ManuscriptEditor` through the same `applyText` path as typing, so the draft
  buffer, debounce, version check and conflict copy are unchanged. A failed request changes nothing.
- The web build returns a desktop-only refusal until Meta browser access is verified (D-127).

## Background turns and notifications

The Electron main process already owned the turn; `AgentTurnInput.background` makes the author's
intent explicit. `AgentRuntime` calls an outcome callback after `done`, `error`, `stopped` or an
approval pause. `BackgroundNotifier` decides whether the author can see the window, shows a native
notification with the book title and a short preview, sets the dock badge and focuses the existing
window on click. A paused destructive tool is reported but never approved automatically.

A background turn uses the same thread, checkpoint and usage stores as an interactive one. Closing the
window on macOS leaves the process alive; quitting the app stops all work. The web build does not
promise background execution.

## Local backend and agent toolkit

`apps/desktop/src/main/backend.ts` is the studio's local control plane for the standalone toolkit. It
starts after `Studio.restore()` in a normal launch and stops in the `before-quit` chain. It binds
`127.0.0.1:0`, generates a 256-bit token, writes `~/.ai-book-studio/backend.json` with mode `0600`, and
refuses browser origins, non-loopback hosts and requests without the bearer token. It reads and writes
only through `Studio.requireLibrary()`, so the library service remains the single writer.

`apps/toolkit/` is a workspace package with a `bookwriter` bin. `backend-client.ts` resolves the
locator (flags, environment, then the owner-only file) and issues bearer requests. `cli.ts` exposes
`info`, `books`, `read`, `search`, `conflicts`, `create-chapter`, `save` and `mcp`. `mcp.ts` is a
newline-delimited JSON-RPC 2.0 server over stdio with read tools by default; `--allow-writes` adds
`create_chapter` and `save_chapter`, and a save always carries the version and hash from the read.
Writes therefore reach the normal conflict path instead of bypassing it.

The toolkit has no Electron dependency, no provider key and no model calls. Closing the app closes the
backend. Remote access is deferred by D-129.

## Illustrations

`packages/core/src/images/` owns the image format and the only image writer:

- `schema.ts` defines the versioned `images.json`, the image record and real byte inspection for
  PNG, WebP and JPEG. The manifest, not a client MIME header, decides the extension and dimensions.
- `store.ts` writes the image file first and the manifest second through `LibraryPort`, serializes
  writes per book and removes a new file when the manifest commit fails. Attaching a chapter clears the
  previous attachment in the same commit; removing moves the file to the library trash.
- `apps/desktop/src/main/images.ts` calls Meta's OpenAI-compatible
  `POST /v1/images/generations` with `muse-image-1.0`, `b64_json` and PNG output. It returns bytes and
  provenance; the IPC handler writes through `ImageStore`. The flat cost is `$0.01` per successful
  image and is shown before the request.
- `IllustrationDialog` owns the prompt, shape, estimate, preview and saved-image list. The attached
  image is rendered below the chapter and embedded in DOCX with its prompt as the caption.
- The browser build returns a desktop-only refusal until Meta browser access is verified.

The image folder and manifest are ordinary author files, included in the portable archive by the
normal recursive walk. No image is stored in `book.json`, the catalog or the app profile.

## SAM 3.1 cutouts

`apps/desktop/src/main/segmentation.ts` sends one concept prompt and the source image to Meta's
Responses API as `sam-3.1`, with `metadata.mask_encoding = "one_bit"` and confidence on. The official
`@meta-sam/parser` turns the returned token text into box and mask records; the service maps them to
serializable matches with the decoded 0/1 raster. The studio does not reimplement the base85 codec.

The renderer composes the cutout: `applyCutoutMask` copies the source RGBA pixels, maps the mask raster
over its source bounds and clears alpha outside it; `cutoutPng` draws the result to a canvas and
returns a PNG blob. The main process saves it through `ImageStore` as a `character` image with
`cutoutOf` pointing at the source. A cast member can be chosen when saving, or the image can be attached
later with `images:attachCharacter`; the character id is stored on the image record. The source file and record are never modified.

Concept prompts are validated in `packages/core/src/images/segmentation.ts`: one short noun phrase,
no lists, negation, questions or commands. Zero matches is a normal result and writes nothing. The web
build refuses until Meta browser access is verified.
