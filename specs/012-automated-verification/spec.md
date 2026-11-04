# Feature Specification: Automated verification

**Feature Branch**: `012-automated-verification`
**Status**: In progress
**Input**: User description: "we will want full automated testing suite, setup the keys we need" and "I want deep specs written iterated over and improved and we will stage."

## Overview

A manuscript application earns trust by not losing text. That promise has to be checked by machines on
every change, not by remembering to try the right thing. This specification defines the verification
suite: what is tested at which layer, what blocks a merge, how provider integrations are kept honest
without spending money on every run, and how a failure is diagnosed without exposing an author's prose
or credentials.

The suite has two speeds. The fast suite runs on every save and pull request, uses no network and no real
credentials, and finishes quickly enough that nobody is tempted to skip it. The full suite adds browser
end-to-end runs, packaged-desktop smoke runs, visual checks and opt-in live provider checks before a
release.

## Clarifications

### Session

- Q: Which runner? → A: Bun's test runner for core, adapters and interface components; Playwright on Node
  for browser and Electron end-to-end runs. Playwright's runner and Electron's packaging are not
  reimplemented on Bun (ADR 0010).
- Q: Do tests call real providers? → A: Not by default. Contract tests replay recorded exchanges. A live
  suite is opt-in, budget-capped and skipped when keys are absent.
- Q: Is coverage a gate? → A: Yes for the core and the storage adapters, which carry the data-loss risk.
  Interface coverage is reported and held to a lower threshold; chasing 100% in presentation code is not
  a goal.
- Q: What happens to flaky tests? → A: A flaky test is quarantined with an owner and a deadline, not
  retried until it passes. The quarantine list is visible and must stay small.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the whole fast suite with one command (Priority: P1)

A contributor runs one command after cloning and sees type errors, lint errors, unit failures, component
failures and contract failures in one pass, with a clear summary and no network access.

**Why this priority**: If the fast path is awkward, it will not be used, and the safety net becomes
decoration.

**Independent Test**: From a clean checkout with no provider keys and no network, run the documented
command; it completes and reports pass or fail for every fast layer.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the contributor runs the fast command, **Then** it installs
   nothing implicitly, uses only committed files, and exits non-zero on the first failing gate.
2. **Given** a failing test, **When** the run ends, **Then** the output names the file, the test and the
   assertion without printing credentials or manuscript text beyond the fixture.
3. **Given** no network, **When** the fast command runs, **Then** no test attempts an external request.

---

### User Story 2 - Prove that saving cannot lose text (Priority: P1)

A change to the store, the format or the save protocol is checked against the failure modes that matter:
interrupted writes, concurrent writers, stale versions, provider conflict copies, deleted chapters and
damaged files.

**Why this priority**: Every other feature is worth less than the manuscript.

**Independent Test**: Introduce a fault at each write step and confirm the original file or the new file
exists intact, never a partial file, and that a conflict preserves both versions.

**Acceptance Scenarios**:

1. **Given** a write interrupted before rename, **When** the operation fails, **Then** the previous file
   is unchanged and the temporary file is removed.
2. **Given** two writers with the same base version, **When** both save, **Then** one saves and the other
   receives a conflict with its text preserved in `conflicts/`.
3. **Given** a chapter renamed outside the studio, **When** the book opens, **Then** the chapter is still
   found or reported, and no other chapter is modified.
4. **Given** a truncated or malformed chapter file, **When** the book opens, **Then** the failure is
   isolated to that chapter and the rest of the book is readable.

---

### User Story 3 - Keep provider integrations from drifting (Priority: P1)

A provider changes a response shape, a model loses tool support, or an OAuth exchange changes. Contract
tests replay recorded exchanges and fail with the exact field that moved, without contacting the provider.

**Why this priority**: Five providers and two sign-in flows are the most externally volatile part of the
product.

**Independent Test**: Change a recorded fixture's field name and confirm the contract test fails with a
message naming the provider and the field.

**Acceptance Scenarios**:

1. **Given** a recorded OpenRouter response, **When** the adapter parses it, **Then** usage, cost and model
   metadata match the recording.
2. **Given** a recorded OAuth callback, **When** the flow runs, **Then** state mismatch, expiry and
   duplicate exchange are each rejected by a dedicated test.
3. **Given** a provider fixture with an unknown field, **When** it is parsed, **Then** the adapter tolerates
   it and records the unknown field rather than crashing.

---

### User Story 4 - See the interface work for a real person (Priority: P2)

The primary journeys run in a real browser and in the packaged desktop application: welcome, create a
book, write, autosave, reload, ask the agent, undo, export. Keyboard and screen-reader checks run on the
same journeys.

**Why this priority**: A correct store behind a broken screen is still a broken product.

**Independent Test**: Run the end-to-end suite against the web build and the desktop build; both complete
the same journey script.

**Acceptance Scenarios**:

1. **Given** the web build, **When** the end-to-end suite runs, **Then** the journey completes with no
   console error and no failed request other than intentional error-path tests.
2. **Given** the desktop build, **When** the hidden smoke run executes, **Then** it uses an isolated
   profile and library and never touches the author's data.
3. **Given** the accessibility scan, **When** it runs on the main screens, **Then** there are no critical
   violations, and focus order is asserted for the composer and editor.

---

### User Story 5 - Diagnose a failure without asking the contributor to reproduce it (Priority: P2)

A failed CI run leaves a trace, a screenshot, the server log and the failing fixture, with secrets
redacted, so the cause is visible from the run page.

**Why this priority**: Hackathon velocity depends on not spending an hour reproducing a red build.

**Independent Test**: Force a failure in each suite and confirm the artifacts identify the failing step
and contain no secrets.

**Acceptance Scenarios**:

1. **Given** a failing browser test, **When** the run ends, **Then** a trace and screenshot are attached.
2. **Given** a failing provider test, **When** the run ends, **Then** the request shape is shown with
   authorization redacted.

---

### User Story 6 - Check real providers on purpose (Priority: P2)

Before a release, a maintainer runs a live suite with real keys. It makes one cheap request per provider,
respects a spend cap, never prints a key, and skips cleanly when a key is absent.

**Why this priority**: Fixtures cannot prove that a key works today, and a hackathon demo should not fail
on stage because a provider changed something.

**Independent Test**: Run the live suite with one key present and the others absent; the present provider
is checked, the absent ones are skipped with a reason, and the process exits successfully.

**Acceptance Scenarios**:

1. **Given** a live key, **When** the check runs, **Then** it performs a read-only or minimal request and
   reports latency and model count.
2. **Given** no keys, **When** the live command runs, **Then** it skips every provider and says how to
   configure them.
3. **Given** a failing provider, **When** the live check ends, **Then** the exit code is non-zero and the
   message distinguishes auth, quota, network and provider error.

---

### User Story 7 - Keep the suite fast enough to use (Priority: P2)

The fast suite stays under a few minutes on a laptop, and parallelism is used where it is safe. Slow tests
are marked and run in the full suite rather than removed.

**Why this priority**: A suite that takes twenty minutes will be bypassed during a hackathon.

**Independent Test**: Time the fast suite on the reference machine and confirm the budget; add a slow test
and confirm it is excluded from the fast command by its marker.

---

### User Story 8 - Ship only when every gate passes (Priority: P1)

A merge and a release both require the same named gates. A red gate blocks the release; a waiver is
recorded with a reason and an expiry, not granted by silence.

**Why this priority**: A test suite without gates is advice.

**Independent Test**: Open a merge request with a failing core test and confirm it cannot merge; then
simulate a release with a failing gate and confirm packaging stops.

**Acceptance Scenarios**:

1. **Given** a pull request, **When** any required gate fails, **Then** the merge is blocked.
2. **Given** a release, **When** the full suite passes, **Then** artifacts are produced and the version is
   stamped into both builds.
3. **Given** a waived gate, **When** the release runs, **Then** the waiver is printed in the log and in the
   release notes.

## Edge Cases

- The CI runner lacks a display for Electron; the smoke run must work headless.
- The test machine has no provider keys, or has a key for a provider whose account is empty.
- A provider rate-limits the live suite.
- Two test files write to the same temporary directory by accident.
- A test depends on the local timezone, locale or clock.
- A snapshot changes only because a font is missing on the runner.
- A browser test leaves a service worker or cached credential behind between tests.
- The packaged application cannot find its preload script in the test harness.
- A flaky test is quarantined and then forgotten.
- Coverage is high while a critical branch is untested.
- A fixture contains real prose or a real key by accident.
- The disk fills during a fault-injection test.

## Requirements *(mandatory)*

### Layers and scope

- **FR-001**: The suite MUST include unit tests for the core (schema, format, line model, counters,
  conflict policy), runnable without a filesystem or a browser.
- **FR-002**: The suite MUST include conformance tests for every storage adapter against one shared
  contract: read, write, list, delete, restore, stat, watch and atomic replacement.
- **FR-003**: The suite MUST include fault-injection tests for interrupted writes, failed renames, full
  disks, read-only folders and unplugged volumes.
- **FR-004**: The suite MUST include property-based tests for Markdown and front-matter round-trips, slug
  generation, version increments and conflict decisions.
- **FR-005**: The suite MUST include component tests for the composer, editor, chapter rail, connection
  cards and conflict banner, including keyboard and focus behaviour.
- **FR-006**: The suite MUST include contract tests for each provider adapter and each sign-in flow, using
  committed fixtures and no network.
- **FR-007**: The suite MUST include browser end-to-end tests for the primary journeys and the web
  storage tiers.
- **FR-008**: The suite MUST include a packaged-desktop smoke run that uses an isolated profile and
  library, and an Electron end-to-end journey for save, reload and agent-visible edits.
- **FR-009**: The suite MUST include accessibility checks on the primary screens: no critical axe
  violations, visible focus, and keyboard completion of the main journeys.
- **FR-010**: The suite MUST include visual checks for the main screens at the supported widths and in
  light, dark, reduced-transparency and reduced-motion modes.
- **FR-011**: The suite MUST include performance checks for opening a 120-chapter, 250,000-word book,
  switching chapters, saving and the initial web bundle size.
- **FR-012**: The suite MUST include security checks: secret scanning of the repository and build
  artifacts, content-security-policy assertions, and Electron fuse checks.

### Determinism and data

- **FR-013**: Tests MUST NOT depend on the current time, the machine timezone, the locale or real random
  identifiers; these MUST be injected or frozen.
- **FR-014**: Temporary libraries MUST be created per test and removed afterwards, including on failure,
  and MUST never point at a real library.
- **FR-015**: All fixtures MUST be synthetic. Importing a real author's manuscript, a real key or a real
  account identifier into the repository is forbidden.
- **FR-016**: Network access MUST be disabled by default in unit, component and contract tests, and a test
  that makes an unintended request MUST fail rather than silently pass.
- **FR-017**: Provider fixtures MUST be recorded from real exchanges with secrets and account identifiers
  removed, and MUST state the date and provider version they came from.
- **FR-018**: The earlier-studio import suite MUST generate its own old-format exports, including malformed, huge
  and partial examples, rather than committing a real export.

### Live providers

- **FR-019**: Live provider checks MUST be opt-in, MUST skip cleanly without keys, and MUST never print or
  persist a key.
- **FR-020**: Live checks MUST use the cheapest available read-only call, MUST enforce a configurable
  spend cap, and MUST stop before exceeding it.
- **FR-021**: Live checks MUST report auth, quota, network and provider errors distinctly.

### Coverage and quality gates

- **FR-022**: Core and adapter line and branch coverage MUST be at least 90%; interface coverage MUST be
  at least 70%; thresholds MUST fail the run when they regress.
- **FR-023**: Every functional requirement in specs 002, 011, 012 and 013 MUST be mapped to at least one
  automated test or a documented manual check with a reason.
- **FR-024**: The fast suite MUST complete within 5 minutes on the reference laptop and MUST be the
  default local command.
- **FR-025**: The full suite MUST complete within 20 minutes on CI, excluding opt-in live checks.
- **FR-026**: A failing test MUST NOT be fixed by adding a retry. Flaky tests MUST be quarantined with an
  owner, a reason and a removal date, and the list MUST be reviewed weekly.
- **FR-027**: Snapshots and visual baselines MUST be reviewed like code; updating them MUST require an
  explicit command and MUST appear in the diff.

### Continuous integration

- **FR-028**: CI MUST run on the project's Gitea instance for every push and merge request, with Bun and
  Node installed at pinned versions.
- **FR-029**: CI MUST run the fast suite on Linux and macOS, and the desktop smoke run on macOS.
- **FR-030**: CI MUST cache dependencies and browser binaries keyed by lockfile and tool versions.
- **FR-031**: CI MUST upload traces, screenshots, logs and failing fixtures on failure, with secrets
  redacted.
- **FR-032**: The required gates MUST be named and identical for merge requests and releases: typecheck,
  lint, fast tests, build, browser end-to-end, desktop smoke, accessibility, visual, security.
- **FR-033**: A release MUST be blocked by any failing gate; a waiver MUST be recorded with a reason, an
  owner and an expiry.
- **FR-034**: CI MUST fail if a required provider key is expected but missing for a release build, and MUST
  pass when keys are absent for ordinary pull requests.

### Diagnostics

- **FR-035**: Failure output MUST name the layer, file, test and assertion, and MUST redact credentials,
  authorization headers and manuscript text outside the fixture under test.
- **FR-036**: Browser failures MUST produce a trace, a screenshot and the console log.
- **FR-037**: Desktop failures MUST produce the main-process log and the renderer console with the same
  redaction rules.
- **FR-038**: The suite MUST print a single summary of passed, failed, skipped and quarantined tests at the
  end of every run.

### Key setup

- **FR-039**: The repository MUST document every key and account needed for development, CI and release,
  where to obtain it, and which tests it unlocks.
- **FR-040**: The repository MUST provide an environment template with variable names and no values, and
  MUST ignore the real environment file.
- **FR-041**: A key-check command MUST report, per provider, whether a key is configured, valid, and what
  it can access, without printing the key or its length.
- **FR-042**: CI secrets MUST be scoped to the jobs that need them; pull requests from forks MUST NOT
  receive them.

### Key Entities

- **Test layer**: a named group with an owner, a runtime, a time budget and a gate.
- **Fixture**: a committed, synthetic input, or a recorded provider exchange with secrets removed.
- **Contract**: the shared expectations every adapter or provider must satisfy.
- **Gate**: a named CI check that blocks merge or release.
- **Waiver**: a recorded exception with a reason, an owner and an expiry.
- **Quarantine entry**: a flaky test with an owner and a removal date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contributor can run the fast suite with one documented command and get a result in under
  5 minutes on the reference laptop.
- **SC-002**: CI returns a merge verdict in under 10 minutes for a typical change.
- **SC-003**: Core and adapter coverage is at least 90% lines and branches; interface coverage is at least
  70%; the numbers are published on every run.
- **SC-004**: The flaky-test rate stays below 1% of runs over a month, and no quarantined test stays
  quarantined past its removal date.
- **SC-005**: Every release runs the full suite and produces both builds from the same commit.
- **SC-006**: A secret scan of the repository, build artifacts and test reports finds zero credentials in
  100% of release runs.
- **SC-007**: The browser and desktop end-to-end journeys cover welcome, create, write, save, reload, agent
  edit, undo and export, and pass on every supported platform in the matrix.
- **SC-008**: Accessibility scans report zero critical violations on the primary screens.
- **SC-009**: Performance checks catch a regression that doubles book-open time or increases the initial web
  bundle by more than 20%.
- **SC-010**: Every functional requirement in the current specs has a test mapping or an approved manual
  check, with no unmapped requirement at release.
- **SC-011**: A failed CI run contains enough artifacts to identify the failing step without a local
  reproduction in 90% of cases.
- **SC-012**: The live provider check completes in under 2 minutes per provider and respects the configured
  spend cap in 100% of runs.

## Assumptions

- **Runners**: Gitea Actions is available with at least one macOS and one Linux runner. If no runner is
  registered, the same commands run locally and the workflow file is ready; the gate is then manual until
  a runner exists.
- **Runtimes**: Bun runs unit, component and contract tests. Node runs Playwright and electron-builder.
  Both are pinned and installed in CI.
- **Providers**: live checks need keys for OpenRouter, OpenAI, Anthropic, Gemini and Meta. ChatGPT plan
  usage cannot be checked headlessly and is covered by a documented manual release check.
- **Budget**: live checks use the smallest available request and a configurable per-run cap, defaulting to
  a few cents.
- **Design**: visual baselines are captured after the design kit panels for connections, models and usage
  are implemented, not against the current placeholder screens.
- **Known issue **: in the current Electron 45 build on macOS, the hidden smoke app prints its
  result and closes its window, but the main process does not terminate. `scripts/smoke.mjs` therefore
  treats a reported `ok: true` result as success and stops the process after a short grace period. The
  shutdown path still needs investigation, and this fallback must never turn a failed check into a pass.

## Non-Goals (v1)

- Load testing with thousands of concurrent users; this is a local-first application.
- Fuzzing every parser for days; targeted property tests cover the format.
- 100% coverage as a target.
- Recording real manuscript text or real account identifiers in fixtures.
- Replacing provider status pages or monitoring; live checks are release gates, not uptime monitoring.
