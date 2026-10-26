# Tasks: automated verification

**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md)

Tasks are ordered. `[x]` means the behavior exists and has been exercised; it does not mean every
future test case in that row is complete. The current counts are the 2026-10-26 baseline: 308 Bun
tests, 16/16 desktop smoke, 11/11 web smoke and Chromium 16/16 browser matrix.

## Phase 1 — Inventory and fast truth

- [ ] T001 Record the actual test inventory, layer owners, commands and known gaps in
      `tests/requirement-map.md`; map every current spec FR in 002, 010–014 and 016 to a test, a manual
      check or an explicit open gap. Start with the current 308 tests and the smoke/matrix runs.
- [ ] T002 Make one fast command the local source of truth: build-info, lint, typecheck, Bun tests,
      desktop bundle and web bundle. Add the chosen linter and fail on lint errors without autofixing
      in CI. Keep Playwright, packaging and provider calls out of the fast path.
- [ ] T003 Add a coverage report and thresholds: 90% lines/branches for core, library, archive, sync
      and browser storage; 70% lines for the interface. Publish the actual numbers; do not invent a
      passing baseline.
- [ ] T004 Add the fast result summary (passed/failed/skipped/quarantined) and a non-zero exit on any
      failed gate. Keep output redacted for credentials and manuscript text.

## Phase 2 — Data-loss and format boundaries

- [x] T005 Core/format/library tests cover schema parsing, Markdown/front matter round-trips, version
      and hash conflicts, trash/restore, path traversal and search. Current evidence: `bun test` — 308
      passing across 45 files, including `packages/core/tests/library-service.test.ts`.
- [x] T006 Storage and archive fault injection covers stale bases, interrupted writes, permission loss,
      read-only folders, quota exhaustion, external edits, bad hashes, traversal and failed cleanup.
      Current evidence: `apps/web/tests/storage/save-failures.test.ts` and `packages/core/tests/archive.test.ts`.
- [ ] T007 Add property-based tests for Markdown/front-matter round-trips, slug generation, version
      increments and conflict decisions. Keep generated inputs synthetic and deterministic.
- [ ] T008 Add a damaged-file isolation test: a truncated/malformed chapter fails alone, the rest of
      the book remains readable, and the app explains the affected file.
- [ ] T009 Add a failed-write/rename/disk-full test at the desktop adapter boundary with a real
      temporary library, proving the previous complete file remains and temp files are removed.

## Phase 3 — Contracts and interfaces

- [x] T010 Provider contract tests replay committed fixtures for OpenRouter and the other registered
      providers, including usage/cost metadata and unknown fields. Current evidence:
      `packages/core/tests/providers-contract.test.ts` and `apps/desktop/tests/providers-service.test.ts`.
- [ ] T011 Add OAuth state, expiry, duplicate-exchange and cancellation tests for every sign-in flow,
      with no network and no real account identifier.
- [ ] T012 Add component tests for the composer, editor, chapter rail, connection cards and conflict
      banner, including keyboard and focus behavior. Current renderer tests cover editor history and
      debounce; the rest remain open.
- [ ] T013 Add browser E2E for welcome → storage → create → write → save → reload → conflict → archive,
      plus folder permission loss/recovery and no silent tier switch. Current evidence: web smoke 11/11
      and Chromium matrix 16/16; agent edit/undo/export journeys remain.
- [ ] T014 Add packaged desktop E2E for launch → fixture library → write → save → reopen → agent panel,
      using throwaway paths. Current evidence: hidden desktop smoke 16/16; packaged smoke 16/16 exists
      but the broader journey remains.
- [ ] T015 Add a CSP test per served route and an Electron fuse check for production builds; assert the
      renderer cannot access Node or arbitrary filesystem paths.

## Phase 4 — Human-facing checks

- [ ] T016 Add axe-core accessibility checks on welcome, library, workspace, chat, Story Bible, settings
      and conflict views at 393×852, 744×1133, 1024×700 and 1440×900. Fail critical/serious findings and
      assert focus order for composer/editor.
- [ ] T017 Add visual baselines for the same screens in light/dark, reduced motion and reduced
      transparency. Update baselines only with an explicit command; no retries to hide a diff.
- [ ] T018 Add performance checks: open a 120-chapter/250,000-word book, switch chapters, save, and
      measure initial web bundle size/time-to-interactive. Fail only at the spec's regression thresholds.
- [ ] T019 Add a repository/artifact secret scan, source-map check and manuscript-like text scan. Fail
      without printing the matching value.

## Phase 5 — CI and release gates

- [x] T020 Add the Gitea verify workflow file (install, build-info, typecheck, tests, desktop/web
      bundles). Current evidence: `.gitea/workflows/verify.yml` exists. No runner is registered, so the
      gate is not yet enforced.
- [ ] T021 Register a Gitea runner, enforce the named gates on merge requests and upload failure traces,
      screenshots, logs and fixtures with redaction. Until this lands, local `bun run verify` is the
      source of truth and the README makes no passing-badge claim.
- [ ] T022 Add lint, coverage, browser E2E, desktop smoke, accessibility, visual and security to the
      required merge/release gate list; make a waiver name a reason, owner and expiry.
- [ ] T023 Add the release job that runs the full suite, packaged E2E and artifact checks; block on any
      failing gate or unexpired waiver.

## Phase 6 — Live providers

- [ ] T024 Add opt-in live checks behind `LIVE_PROVIDER_TESTS`, one cheapest read-only call per
      configured provider, with `LIVE_SPEND_CAP_CENTS` as a hard stop. Skip absent keys with a reason;
      classify auth, quota, network and provider errors separately.
- [ ] T025 Record the manual ChatGPT plan pass and the release-day provider checklist; do not automate a
      browser session or store a real account identifier.
- [ ] T026 Add a live-test failure artifact showing the provider, model, request shape with authorization
      redacted, latency and error class.

## Phase 7 — Diagnostics, quarantine and budgets

- [ ] T027 Add Playwright traces/screenshots/console logs and Electron main/renderer logs to failing
      runs, with the existing redaction helper.
- [ ] T028 Add a quarantine ledger with owner, reason and removal date; no retry-based fixes. Fail when
      an entry is past its removal date.
- [ ] T029 Enforce the fast budget under 5 minutes and the full suite under 20 minutes on the reference
      machine; keep slow checks marked and excluded from the fast command.
- [ ] T030 Add the single passed/failed/skipped/quarantined summary to every suite and release run.

## Completion condition

The spec is complete when the fast command is green without network or keys, every required gate is
enforced by a registered runner or an explicit manual waiver, the browser/desktop journeys cover the
primary author path, and a release produces artifacts plus redacted failure evidence and a requirement
map with no unmapped FR.
