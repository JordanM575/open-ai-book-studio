# AI Book Studio

A quiet, local-first writing studio for long-form fiction. Your manuscript is a folder of ordinary
files on your own disk — in iCloud Drive, Google Drive, Dropbox, or anywhere else you like. There is
no account, no server, and no database that can quietly disagree with your prose.

AI Book Studio began on 2026-10-24, two days before the Meta Global AI Developer Hackathon opened.
This repository is the event edition: the studio as it stood at submission.

Status: v0.1.0 development. The library, manuscript editor, autosave, conflict handling, Story Bible,
provider connections, writing agent, Word export, legacy import, browser storage, read-only sync
drift detection, Muse Voice Transcribe dictation, background agent turns and the standalone CLI/MCP
toolkit are working. Remaining work is deployment, mobile device verification and the sync review
interface.

**Verification:** local `bun run verify` is the source of truth. A Gitea workflow is ready at
[`.gitea/workflows/verify.yml`](.gitea/workflows/verify.yml), but no runner is registered yet, so this
project does not claim a passing CI badge.

## What exists today

- **Library** — choose a folder once; every book inside it is a folder with `book.json` and
  `chapters/*.md`.
- **Workspace** — chapter rail, solid manuscript sheet, autosave with a visible save state.
- **Honest conflicts** — if a file changed elsewhere (another device, a sync provider, an editor),
  your text is kept as a copy in `conflicts/` instead of overwriting the other version.
- **Recovery** — a draft buffer in the main process flushes unfinished typing on quit; deleted
  chapters go to `.studio/trash`, not into the void.
- **Voice dictation** — record with Muse Voice Transcribe, convert to WAV in the browser, and insert
  the transcript at the caret through the normal save path.
- **Background turns** — let the agent finish after the window closes and notify you on macOS; a
  destructive tool still waits for approval.
- **Agent toolkit** — `bookwriter` exposes the open library through a CLI and an MCP server. It
  serves the *same* writing tools the built-in agent uses, so another agent gets the same verbs;
  read-only by default, with writes and destructive changes behind their own flags. See
  [docs/TOOLKIT.md](docs/TOOLKIT.md).
- **Sample and submission** — [`samples/the-salt-road`](samples/README.md) is an original, complete
  library with two chapters, a Story Bible, an illustration and a cutout. The submission packet and
  readiness check are in [`hackathon/SUBMISSION.md`](hackathon/SUBMISSION.md) and
  `bun run submission:check`.
- **Liquid Glass interface** — the AI Book Studio design kit compiled into tokens, with
  light, dark, reduced-transparency and reduced-motion support.

## Running it

```bash
bun install
bun run dev        # Vite + Electron with hot reload
```

Other commands:

```bash
bun run typecheck  # both TypeScript projects (main/preload and renderer)
bun test           # Bun test: library, format, conflicts, path safety
bun run smoke      # build, then drive a hidden window through the real UI
bun run smoke:packaged # package the app, then run the hidden suite against the packaged binary
bun run ui:audit   # drive the real app through the main flows and report any dead end
bun run build      # typecheck + production bundle into apps/desktop/out
bun run build:web  # static web bundle in apps/web/dist
bun run toolkit:build # compiled `bookwriter` CLI/MCP binary in apps/toolkit/dist
bun run toolkit    # run the CLI from source
bun run submission:check # branch/tree, required files, secret scan and sample integrity
bun run smoke:web  # build the web bundle and drive the browser shell
bun run gallery:build # shared-component light/dark gallery in apps/web/check/gallery-dist
bun run package    # unpacked app in release/
bun run dist       # installers for the current platform
bun run build:info # version, commit, schema and target; fails if versions disagree
bun run tokens     # regenerate renderer tokens from design/tokens.json
bun run verify     # version check, typecheck, tests and both builds
```

If Electron's binary was skipped, the install prints the exact command:
`node apps/desktop/node_modules/electron/install.js`.

### Testing without a window

`bun run smoke` never puts anything on screen. It launches a second instance with its own throwaway
profile (`STUDIO_USER_DATA`), parks the window off-screen, hides the Dock icon, points the app at a
fixture library, then checks the preload bridge, the library view, opening a book, and an autosave
reaching the disk. It prints one line per check and exits non-zero on failure.

`bun run ui:audit` is the companion: it opens the same fixture library in a throwaway profile and
walks the main flows — library, manuscript, model picker, agent panel, Story Bible, Settings, search
and the illustration dialog — then prints what worked and what an author would get stuck on. It
exits non-zero when it finds a dead end.

Useful while developing:

```bash
STUDIO_TEST=1 STUDIO_HEADLESS=1 \
  STUDIO_USER_DATA=/tmp/abs-profile bun run dev   # hidden window, isolated profile

STUDIO_TEST=1 STUDIO_VISIBLE=1 \
  STUDIO_USER_DATA=/tmp/abs-keychain-profile bun run dev
  # visible isolated profile for a manual provider/keychain test
```

`STUDIO_TEST=1` gives the run its own settings file, and with `STUDIO_USER_DATA` its single-instance
lock lives in that throwaway profile too. A hidden run can sit beside your real window without
touching it, and a second copy on the same throwaway profile is refused, as a second copy of the real
app is. `STUDIO_VISIBLE=1` keeps that isolation but shows the window. The macOS keychain process is
in [docs/KEYCHAIN.md](docs/KEYCHAIN.md).
`SMOKE_KEEP=1 bun run smoke:run` keeps the temp library for inspection.

To see the real renderer at a device size, capture it without showing a window:

```bash
bun run build
bun scripts/capture.mjs 393x852 /tmp/iphone.png
bun scripts/capture.mjs 393x852 /tmp/iphone-workspace.png '[data-testid="book-card"]'
bun scripts/capture.mjs 744x1133 /tmp/ipad-mini.png
```

`STUDIO_WINDOW_SIZE` sets the window size and `STUDIO_CAPTURE` writes a PNG before the app exits.
The optional third argument is a selector, or several joined with `||`, to open a book or panel first.
Examples are in [docs/research/mobile-layouts.md](docs/research/mobile-layouts.md).


> `ELECTRON_RUN_AS_NODE=1` in your shell makes `electron` start as plain Node. If you see
> `Cannot read properties of undefined (reading 'isPackaged')`, launch with
> `env -u ELECTRON_RUN_AS_NODE bun run dev`.

## How it is put together

```
apps/desktop/        Electron application (Node main, sandboxed renderer)
  src/main/          owns the files, the only writer
    library/         atomic writes, paths, the Library store
    ipc.ts           typed IPC, Zod validation, Result envelopes
  src/preload/       contextBridge surface (window.studio)
  src/renderer/      React 19 + Tailwind 4 interface
packages/core/       schemas, Markdown format and IPC contract — no Node, no DOM
design/              vendored design tokens, compiled by scripts/build-tokens.mjs
docs/                format, architecture, design rules, decisions, ADRs
specs/               spec-driven feature history and plans
.specify/            the constitution every spec is measured against
```

Bun installs and runs the scripts; Electron itself runs on Node. `packages/core` is imported by both
sides of the app and ships TypeScript source, so electron-vite bundles it instead of externalising it.

The renderer never touches the filesystem. It asks the main process, which validates input, writes
atomically, and returns either data or a typed error.

## Where your book lives

```
<your library folder>/
  library.json                      derived catalog, safe to delete
  books/
    book_…/
      book.json                     idea, outline, cast, memories, settings
      chapters/0001-the-door.md     YAML front matter + Markdown prose
      conflicts/                    versions kept when two writers disagreed
      threads/  checkpoints/        reserved for the agent
  .studio/
    device.json                     identity of this machine
    trash/                          deleted chapters, recoverable
```

See [docs/FORMAT.md](docs/FORMAT.md) for the exact schema and the conflict protocol.

## Documentation

- [docs/FORMAT.md](docs/FORMAT.md) — the library format, normative
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — processes, save protocol, sync model
- [docs/DESIGN.md](docs/DESIGN.md) — Liquid Glass rules, type, voice, accessibility
- [docs/DECISIONS.md](docs/DECISIONS.md) — the decision register: what is settled, what is open, what
  each open question blocks
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environments, artifact names, promotion, rollback and CI
- [hackathon/](hackathon/) — Meta Global AI Developer Hackathon brief and 10-day plan
- [docs/adr/](docs/adr/) — decisions and the alternatives rejected
- [specs/002-studio-v1/spec.md](specs/002-studio-v1/spec.md) — what version 1 is, in full
- [specs/003-earlier-studio-import/spec.md](specs/003-earlier-studio-import/spec.md) — importing an earlier studio's export
- [specs/](specs/README.md) — the index, and the foundation's record
- [.specify/memory/constitution.md](.specify/memory/constitution.md) — the seven principles

## Privacy

Your manuscript, your key, your machine. The studio never sends prose anywhere unless you ask an
agent to work on it, and there is no telemetry. Provider keys live in the operating system's protected
storage, never in the library, logs or archives. The browser build has no provider credentials yet.

## Repository

The public repository is on GitHub:

```bash
git clone https://github.com/JordanM575/open-ai-book-studio.git
```

The repository starts fresh; it
replaces an earlier local prototype and shares no history, no Next.js server and no localStorage
library with it.

Read [AGENTS.md](AGENTS.md) before changing code, [docs/DECISIONS.md](docs/DECISIONS.md) before
choosing an approach, and [CHANGELOG.md](CHANGELOG.md) before committing.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). You may use, modify and distribute
the application under those terms. The license covers the code; the books you write with it remain
yours.
