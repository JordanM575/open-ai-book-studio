# ADR 0010: Bun for tooling, Electron for the desktop runtime, workspaces for the split

- **Status**: Accepted
- **Related**: ADR 0001 (Electron), ADR 0009 (multi-target storage), spec 011 (model access),
  spec 012 (automated verification), spec 013 (builds and deployment)

## Context

The repository currently uses pnpm, Vitest, electron-vite and a single package. The product is about to
split into a desktop application and a web application that share a core and an interface, and the
hackathon timeline rewards a toolchain that installs and runs quickly.

The author prefers Bun throughout. Bun 1.4.3 is installed. Electron 45 is not Bun: its main and preload
processes run on Electron's bundled Node, and its renderer is Chromium. Bun cannot replace that runtime
without replacing Electron.

Electrobun 2.0 was evaluated as a Bun-native alternative: it runs a Bun-compatible TypeScript main
process (Cottontail), uses the system webview by default, optionally bundles Chromium, produces much
smaller downloads, and has built-in signing and differential updates. It is a credible future target
but a poor fit for this product today, because the interface depends on Chromium's `backdrop-filter`
and compositing behaviour for Liquid Glass, and because the desktop test and packaging path
(Playwright Electron, electron-builder, `safeStorage`) is mature and already working.

## Decision

1. **Bun is the package manager and task runner.** `bun install`, `bun run`, `bunx`. The pnpm lockfile is
   replaced by `bun.lock`; pnpm-specific settings are removed.
2. **Bun is the test runner for core, adapters and interface components** (`bun test`), with coverage,
   mocks, snapshots and a DOM via happy-dom.
3. **Electron remains the desktop runtime.** Main and preload run on Electron's Node. No Bun API is
   imported in `apps/desktop/src/main` or `apps/desktop/src/preload`, and no Bun binary is shipped.
4. **Bun serves the web build in development and can serve it in production** (`Bun.serve` against the
   built assets). The web application is a static bundle; there is no required application server in
   v1.
5. **Playwright and electron-builder run on Node**, invoked from Bun scripts. CI installs Node 22 and
   Bun; Playwright's runner and Electron's packaging are not reimplemented on Bun.
6. **The repository becomes Bun workspaces**:

   ```
   apps/desktop      Electron main, preload and renderer entry
   apps/web          web entry, router and web-only adapters
   packages/core     schema, format, library logic, agent tools — no Node or DOM APIs
   packages/ui       React components, screens, styles, generated tokens
   packages/config   shared TypeScript, test and build configuration
   ```

   Applications import packages by name, never by reaching into another package's `src`.

7. **Electrobun stays an evaluated option**, recorded here so it is not re-litigated from memory.
   Revisit after the hackathon, when the webview risk can be tested against the real interface.

## Consequences

- The lockfile changes once, and every contributor installs with Bun. `pnpm` commands in the README and
  AGENTS.md are replaced.
- Electron's install script must run under Bun's trusted-dependencies setting, or it is run explicitly
  as it is today (`node node_modules/electron/install.js`).
- Vitest tests are rewritten to `bun:test`. The assertions are compatible; mocking and DOM setup are
  not identical and need a small shim per test file. The existing library tests are the acceptance
  gate for the migration.
- Playwright and electron-builder remain Node processes, so the "one runtime" preference is satisfied
  everywhere it can be, and stated honestly where it cannot.
- A future Electrobun port reuses `packages/core` and `packages/ui` unchanged; only the desktop shell
  changes. That is the insurance policy for this decision.
