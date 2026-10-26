# Implementation Plan: Automated verification

**Branch**: `012-automated-verification` · **Date**: 2026-10-26 · **Spec**: [spec.md](spec.md)
**Status**: In progress

## Summary

Build one verification ladder over the existing Bun and Playwright harnesses, with named gates and
failure artifacts. The fast suite runs on every change without network or credentials. The full suite
adds real-browser, packaged-desktop, accessibility, visual, performance and security checks. Live
provider checks are opt-in, budget-capped and run before a release.

The suite already has substantial coverage; this plan closes the gaps rather than inventing a second
test framework. Spec 013 supplies build metadata and staging; spec 010 supplies browser storage and
archive behavior; spec 011 supplies provider credentials and live access.

## Current state

Verified on 2026-10-26:

- `bun test` — 308 passing tests across 45 files in core, desktop main/renderer, storage, archive,
  sync, providers, agent and the shared app.
- `bun run smoke` — 16/16 hidden desktop checks against a throwaway profile and fixture library.
- `bun run smoke:web` — 11/11 browser checks (welcome, origin storage, create, save, reopen, build
  metadata, stale conflict, archive export, and reduced motion/transparency).
- `node scripts/browser-matrix.mjs` — Chromium 16/16 real-browser checks; Firefox/WebKit OPFS failures
  are recorded findings.
- `bun run gallery:build` — shared UI gallery measured at 1280×800, 744×1133 and 393×852 in light/dark;
  no horizontal overflow, no control under 44 px, dialog opens.
- `bun run keys:check` — provider status/latency/model counts without printing key material; `.env.example`
  names the variables.
- `.gitea/workflows/verify.yml` — install, build-info, typecheck, tests, desktop bundle and web bundle.
  **No Gitea runner is registered**, so this is not yet an enforced CI gate.
- Fault-injection coverage exists for storage save failures, stale bases, permission/quota/read-only,
  archive validation and conflict preservation.

Gaps:

- No lint command or lint gate.
- No coverage thresholds or published coverage report.
- No accessibility scan, performance budget or visual regression baseline.
- No secret scan of artifacts, CSP assertion across all served routes, or Electron fuse check.
- No requirement-to-test map, quarantine list or waiver record.
- Provider contract tests exist, but live checks and the manual release pass are not implemented.
- The packaged desktop smoke passes (16/16), but Electron E2E beyond the hidden smoke is not separate.

## Test layers

| Layer | Runner | Network | Gate | Current state |
| --- | --- | --- | --- | --- |
| Core schema/format/library | Bun | No | merge | strong; 308 total suite |
| Storage adapters and archive | Bun + Playwright Chromium | No | merge | strong; fault injection and 16 browser checks |
| Provider contracts | Bun with fixtures | No | merge | present; extend as providers change |
| Browser E2E | Playwright on Node | No external hosts | merge/release | web smoke 11/11, matrix 16/16 |
| Desktop smoke/E2E | Electron hidden window | No | merge/release | 16/16; isolated profile |
| Accessibility | Playwright + axe | No | release | missing |
| Visual | Playwright screenshots | No | release | gallery measured manually; no baseline |
| Performance | Bun/Playwright timings | No | release | missing |
| Security | scripts + Playwright | No | release | CSP test exists; secret/fuse scan missing |
| Live providers | Bun/Node | Opt-in | release | missing; needs keys and spend cap |
| CI | Gitea Actions | Install only | merge/release | workflow ready; no runner |

## Architecture

### Fast command

`bun run verify` is the local source of truth until a runner exists. It currently runs build-info,
typecheck, tests, desktop bundle and web bundle. The plan adds, in order:

1. `lint` (one configured linter, no autofix in CI);
2. the fast Bun suite;
3. the web bundle and the desktop bundle;
4. a coverage report with the thresholds from the spec;
5. a requirement-map check that fails only when a changed requirement has no mapping.

The fast command must not run Playwright, package Electron, call a provider or read an author profile.
The full command adds browser/desktop smoke, accessibility, visual and security. Live checks remain a
separate command.

### Fixtures and isolation

- Every temporary library is created under the test's own temporary root and removed in a `finally`.
- The desktop smoke uses `STUDIO_PROFILE`/`STUDIO_LIBRARY` throwaway paths; the runner never reads the
  author's `userData` or library.
- Provider fixtures carry provider, model, date and a synthetic/redacted exchange. Unknown fields are
  tolerated and asserted, not ignored silently.
- Network is disabled by an HTTP guard in unit/contract runs. A test that tries to reach an external
  host fails with the URL and test name, redacted.

### Coverage

Use Bun's coverage output for core and adapter packages; do not chase component coverage with snapshots.
Publish line and branch numbers for:
- `packages/core/src/library`, `packages/core/src/archive`, `packages/core/src/sync`;
- `apps/web/src/storage`, `apps/desktop/src/main/library`;
- a lower interface threshold for `packages/app` and `packages/ui`.

Thresholds are configuration, not prose: core/adapters 90% lines and branches; interface 70% lines.
A baseline may start below 90% only with a named gap and an expiry; the first task records the actual
numbers instead of inventing a passing score.

### Browser and desktop journeys

Extend `scripts/web-smoke.mjs` and `apps/web/check` rather than creating a parallel suite:

- welcome → browser storage → create → write → save → reopen;
- folder selection, permission loss/recovery and no silent tier switch;
- stale save conflict and archive export/import;
- agent panel with no provider (honest explanation) and with a mock model where feasible;
- keyboard-only journey and visible focus.

Desktop:
- hidden smoke remains the first gate (welcome, library, chapter, save, reopen, agent panel);
- add a packaged-app journey that saves to a fixture folder and reopens it;
- assert the renderer has no Node access and the preload surface is the expected allow-list.

### Accessibility, visual and performance

- axe-core on welcome, library, workspace, chat, story bible, settings and conflict views; fail on
  critical/serious findings and assert focus order on the composer/editor.
- Visual baselines at 393×852, 744×1133, 1024×700 and 1440×900 in light, dark, reduced motion and
  reduced transparency. Baselines are updated only by an explicit command and reviewed as code.
- Performance budgets:
  - open a 120-chapter/250,000-word book under the reference threshold;
  - chapter switch and save timings;
  - initial web bundle compressed size and time-to-interactive.
  Report the actuals; fail only on the spec's regression thresholds.

### Security

- Scan the repository and built artifacts for key-shaped strings and `.env`/credential files.
- Assert the web CSP on every served route and that provider hosts are the only allowed external
  connects.
- Check Electron fuses (`RunAsNode`, `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar`, cookie
  encryption where used) and fail on unsafe production values.
- Scan release notes and test artifacts for manuscript text and authorization headers.

### CI and release gates

The required gates are named once and used by both merge and release:

```text
build-info, lint, typecheck, fast-tests, coverage, desktop-build, web-build,
browser-e2e, desktop-smoke, accessibility, visual, security
```

`release` adds `packaged-e2e` and opt-in `live-providers`. A waiver record names the gate, reason,
owner and expiry; it is printed in the run and release notes.

The workflow is already present. No runner is registered; until one is, the same commands run locally
and the README must not claim a passing badge. A CI task is complete only when a real run is visible.

### Failure artifacts and diagnostics

- Playwright: trace, screenshot, console log and the failing fixture path.
- Electron: main-process log plus renderer console, both through the existing redaction helper.
- Bun: file, test, assertion and the synthetic fixture under test; no key material or real prose.
- Live checks: provider, model, status class (auth/quota/network/provider), latency and request shape
  with authorization redacted.
- Every command ends with passed/failed/skipped/quarantined counts.

### Live providers

- `bun run keys:check` stays the no-spend status command.
- A separate `LIVE_PROVIDER_TESTS=1` command performs one cheapest read-only call per configured key.
- `LIVE_SPEND_CAP_CENTS` is a hard stop; the command refuses to start a request that could exceed it.
- Skips are explicit: a missing key is skipped, not failed. A configured but rejected key fails with
  auth/quota/network/provider classification.
- ChatGPT plan access remains a documented manual check; it is not automated through a browser session.

## Phases

1. **Inventory and truth** — record actual layer coverage, test counts, commands and gaps; add the
   requirement map skeleton. No thresholds yet.
2. **Fast gate** — lint, coverage report, typecheck/tests/builds and the single fast command.
3. **Boundary suites** — close fault-injection/property/contract gaps; add browser and packaged
   desktop journeys; no provider network.
4. **Human-facing checks** — accessibility, visual baselines, performance and security scans.
5. **CI** — register the runner, enforce gates, upload artifacts, add waiver/quarantine records.
6. **Live checks** — opt-in provider suite and release manual pass; depends on D-101/D-102/D-116.
7. **Release** — same gates, checksums, release notes and evidence per spec 009/013.

## Files

```text
package.json, bunfig.toml              scripts and coverage
.gitea/workflows/verify.yml            fast and browser gates
.gitea/workflows/release.yml           release gates, after D-115
scripts/verify.mjs                     one fast command, clear summary
scripts/check-secrets.mjs              artifact/repo scan
scripts/check-requirement-map.mjs      spec-to-test mapping
tests/requirement-map.md               mapping ledger
tests/quarantine.md                    owner/reason/removal date
apps/desktop/tests/                    Bun unit/adapter tests
apps/web/tests/storage/                Bun adapter tests
packages/core/tests/                   core/contract/property tests
apps/web/check/                        real-browser harness
playwright.config.*                    browser/desktop E2E, traces
```

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Suite becomes slow and gets skipped | Fast command budget under 5 minutes; Playwright/visual/package in the full command |
| Coverage number hides an untested branch | Branch threshold plus a requirement map and fault-injection tests, not coverage alone |
| Flaky visual/browser tests | Explicit baseline update, no retries, quarantine with owner/expiry |
| CI runner absent | Local `bun run verify` remains authoritative; no badge; task stays open |
| Live checks spend money or leak keys | Opt-in, cheapest call, hard cap, redacted output, skip without key |
| Test fixture leaks author text | Synthetic fixtures; secret/manuscript scan; temp libraries under test root |
| Accessibility scan only runs on placeholders | Run on real views at the supported widths and themes |

## Verification

- Fast command passes from a clean checkout with no keys and no network.
- A deliberately broken save, archive, provider fixture, CSP header or accessibility label fails the
  named gate with a useful message.
- A failing browser test leaves a trace/screenshot; a failing live check leaves a redacted request
  shape.
- A release runs the full gate list and stops on a failure or prints the waiver.
- The packaged app opens a fixture library and leaves the author's profile untouched.

## Out of scope

Replacing Bun or Playwright, load testing, fuzzing for days, 100% coverage, hosted monitoring, real
author data in fixtures, and a live ChatGPT web-session automation.

## Dependencies

- D-101/D-102/D-116 gate browser provider access and spend caps.
- D-115 gates the release job that signs/updates the desktop app.
- Spec 013 supplies build metadata, artifact names and staging.
- Spec 010 supplies browser storage and archive checks; spec 011 supplies provider contracts.
