# Implementation plan: builds and deployment

**Spec**: [spec.md](spec.md) · **Decision record**: [D-106](../docs/DECISIONS.md), ADR 0010 · **Status**: In progress

## Shape

A Bun workspace with a desktop app, a future web app, and shared packages. The desktop app keeps
Electron's Node runtime; Bun owns installation, scripts and unit tests. Each target has one command that
produces an artifact, and one command that proves the artifact still opens a real book.

```
package.json                 workspaces, top-level commands
bunfig.toml                  test roots and coverage (when needed)
apps/
  desktop/
    package.json             Electron app, electron-vite, electron-builder
    electron.vite.config.ts
    tsconfig*.json
    src/main/                files, IPC, agent host (Node)
    src/preload/
    src/renderer/            React interface
packages/
  core/                      schemas, Markdown format, IPC contract (no Node, no DOM)
  ui/                        shared components (created when the web build needs them)
  config/                    shared TypeScript and lint configuration (created when needed)
scripts/                     repository-level tools (tokens, key checks, smoke launcher)
tests/                       cross-package tests that need a real filesystem
design/                      vendored tokens
```

Packages are created when they have a consumer, not before. `ui` and `config` appear with the web build.

## Key decisions in this plan

- **Bun installs, Node runs Electron.** `bun install` links workspaces and installs Electron; the
  `electron` binary is still started by Node (Electron's own runtime). `electron-vite` and
  `electron-builder` are invoked from the `apps/desktop` package.
- **Workspace packages ship TypeScript source.** `packages/core` exports `./schema`, `./markdown` and
  `./ipc` pointing at `.ts` files. electron-vite must bundle the package rather than externalise it:
  `externalizeDepsPlugin({ exclude: ["@ai-book-studio/core"] })`. This keeps one source of truth and no
  build step for the shared package.
- **Path aliases disappear where a package boundary exists.** `@shared/*` becomes
  `@ai-book-studio/core/*`; `@main/*` and `@renderer/*` stay inside the desktop app.
- **Tests move to `bun test`** in the same change as the workspace move, so there is never a period with
  two runners. The test file keeps its behaviour; only the imports change (`bun:test`).
- **Electron binary installation is explicit.** Bun may skip lifecycle scripts; the README documents
  `node node_modules/electron/install.js` and the root `postinstall` check prints a clear message when
  the binary is missing.
- **Packaged output is verified, not assumed.** A build is not "done" until `electron-builder --dir`
  produces an app that launches and passes the smoke run against the packaged main file.
- **Capability honesty.** The About screen and build metadata state which target this is (desktop or
  web) and which capabilities are unavailable, generated from one capability table rather than written
  twice.

## Phases

1. **Workspace scaffold** — move the desktop app and shared contract, root scripts, Bun install,
   typecheck, `bun test`, build, hidden smoke. No behaviour change.
2. **Packaging spike** — electron-builder `--dir` against the workspace, launch the packaged app, record
   the result in D-106.
3. **Shared UI** — extract the components the web build will reuse; keep desktop-only components in the
   app. Blocked by the web build starting.
4. **Web target** — `apps/web` with Vite, the core package and shared UI; static build. Blocked by 010.
5. **Environments and promotion** — local, preview, release; artifact naming, version source, rollback.
6. **CI** — Gitea workflow, gated on a registered runner; local `bun run verify` remains the source of
   truth.

## Verification

- `bun run typecheck` — both TypeScript projects.
- `bun test` — the library suite, unchanged in behaviour.
- `bun run build` — electron-vite output in `apps/desktop/out`.
- `bun run smoke` — hidden window against the fresh build.
- `bun run package:dir` — unpacked app; launch it once and open a fixture library.
- A clean clone check: `bun install && bun run verify` on a machine with no prior `node_modules`.

## Risks

| Risk | Mitigation |
| --- | --- |
| electron-vite externalises the workspace package and the app crashes on `require` of `.ts` | exclude the package from externalisation; assert in the smoke run that a schema import resolved |
| Bun's install layout confuses electron-builder's dependency collection | `--dir` spike before any other packaging work; keep runtime deps in the desktop package |
| Electron binary missing after install | explicit postinstall check with the documented fix |
| Two runners during migration | migrate tests in the same commit as the move |
| Root scripts drift from package scripts | root scripts only call workspace scripts; no build logic at the root |

## Out of scope

Signing, notarisation, auto-update, app-store distribution, and a hosted web deployment (spec 009 and
010 respectively).
