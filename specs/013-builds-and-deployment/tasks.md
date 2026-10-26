# Tasks: builds and deployment

**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md)

## Phase 1 — Workspace scaffold

- [x] T00[1-9] Create the root workspace `package.json` (`workspaces: ["apps/*", "packages/*"]`,
      `trustedDependencies` for Electron, root scripts that only delegate) and `bunfig.toml`.
- [x] T00[1-9] Move the Electron app to `apps/desktop` (`src/main`, `src/preload`, `src/renderer`,
      `electron.vite.config.ts`, `tsconfig*.json`) and give it its own `package.json` with the runtime
      dependencies.
- [x] T00[1-9] Create `packages/core` exporting `./schema`, `./markdown` and `./ipc` from TypeScript source;
      move `src/shared/schema.ts`, `src/shared/ipc.ts` and `src/main/library/markdown.ts` into it.
- [x] T00[1-9] Replace `@shared/*` imports with `@ai-book-studio/core/*`; keep `@main/*` and `@renderer/*`
      inside the desktop app; update both tsconfigs and the electron-vite aliases.
- [x] T00[1-9] Exclude `@ai-book-studio/core` from `externalizeDepsPlugin` so electron-vite bundles it, and
      verify the built main file contains no unresolved workspace import.
- [x] T00[1-9] Point `scripts/build-tokens.mjs` at `apps/desktop/src/renderer/src/styles` and
      `scripts/smoke.mjs` at `apps/desktop`; add the electron-binary presence check.
- [x] T00[1-9] Migrate `tests/library.test.ts` to `bun:test` (`import { describe, expect, test } from
      "bun:test"`), delete `vitest.config.ts` and the Vitest dependency, and run `bun test` with the same
      13 passing tests.
- [x] T00[1-9] `bun install`, `bun run typecheck`, `bun run build`, `bun run smoke` all pass from a clean
      `node_modules`. Record the install and binary behaviour in D-106.
- [x] T00[1-9] Update README, AGENTS and CHANGELOG for the new commands and layout.

## Phase 2 — Packaging spike

- [x] T01[0-2] Move `electron-builder.yml` under `apps/desktop`, point `files` at the workspace output and add
      `package:dir` / `package` scripts.
- [x] T01[0-2] Run `bun run package:dir`, launch the unpacked app, open a fixture library, and confirm the
      chapter opens and saves.
- [x] T01[0-2] Record packaged-app size, launch result and any dependency-collection surprises in D-106;
      adjust the plan if Bun's layout needs a different `files` list.

## Phase 3 — Shared UI

- [x] T013 Identify components used by both targets and move them to `packages/ui`. `packages/ui` holds the primitives (`Button`, `Dialog`, `Brand`, `Notice`, `cn`), and `packages/app` holds the shared shell, views, product components, hooks and renderer utilities. The desktop renderer keeps a one-line `App` re-export; the web shell imports `@ai-book-studio/app` directly. The `@renderer` alias is removed from the desktop and web build and typecheck configs. The web stylesheet still imports the desktop token/base stylesheet; moving that stylesheet into a shared package is a follow-up.
- [x] T014 Add a visual check page that renders shared components in both apps and compares storage-disclosure states. `apps/web/check/gallery.html` renders `Button`, `Brand`, `Notice` and `Dialog` from `packages/ui` and compares the browser-storage and folder-library disclosures. Measured at 1280×800, 744×1133 and 393×852 in light and dark: no horizontal overflow, 9 controls with none under 44 px, and the dialog opens. The desktop app re-exports the same package and is covered by the hidden smoke.

## Phase 4 — Web target

- [x] T015 Create the `apps/web` Vite entry and package around the storage adapters from spec 010. The spike reuses the desktop renderer through an `@renderer` alias; `bun run build:web` emits `apps/web/dist`.
- [x] T016 Add the capability table and build metadata (target, version, commit, capabilities).
      `packages/core/src/build.ts` owns the shared table; Vite and electron-vite inject
      `__BUILD_VERSION__`/`__BUILD_COMMIT__` from `scripts/build-vars.mjs`; `app:info` feeds
      Settings → About with target, version, commit, schema, platform, storage and every capability,
      including a reason when it is unavailable.
- [x] T017 `bun run build:web` produces static assets that open the web storage welcome and a library, identify the selected tier, and pass `node scripts/web-smoke.mjs` (6/6: welcome, browser storage, create, save, reopen, browser root).

## Phase 5 — Environments and promotion

- [x] T018 Define local, preview and release environments, artifact names and version derivation from one
      source. `scripts/build-info.mjs` (root `bun run build:info`) reads the root version, the commit and
      the schema, and fails when the workspace package versions disagree. `electron-builder.yml` names
      artifacts from product, version, OS and architecture. `docs/DEPLOYMENT.md` defines the stages.
- [x] T019 Write the promotion and rollback runbook, including keeping the previous artifact addressable.
      `docs/DEPLOYMENT.md` has the gates, the eight promotion steps, the five-minute rollback path and the
      manual checklist.

## Phase 6 — CI

- [x] T020 Add `.gitea/workflows/verify.yml` running `bun install --frozen-lockfile`, version agreement,
      typecheck, tests, desktop bundle and web bundle; Electron packaging stays out until a runner has a
      display or `xvfb`.
- [x] T021 Add a badge or status note to README that is honest when no runner is registered. The README
      names local `bun run verify` as the source of truth and says no runner is registered, so no passing
      badge is claimed.
