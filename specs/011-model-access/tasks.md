# Tasks: model access

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **State**: in progress — Phases 1–4, selection, model picker, transport, the first writing-agent loop, usage records, hand-entered model ids and the OpenRouter revocation link implemented
Tasks are ordered. `[P]` means it can run in parallel with the other `[P]` tasks in the same phase.
A task that depends on an open decision is marked and must not start until the decision is accepted.

**Implemented channel names**: `providers:list`, `providers:models`, `connections:list`,
`connections:available`, `connections:addKey`, `connections:startOpenRouter`, `connections:cancelOpenRouter`,
`connections:remove`, `connections:test`, `usage:summary`, `providers:addModel` and `app:openLink`. T006 is complete. T007 stays open
for handler-level malformed-input tests. T011 has the `0600` write and startup availability warning but
no permission repair; T012 has a credential-file plaintext test but does not yet scan `studio.json` or a
fixture library. T032 is complete: every agent turn appends its total across steps. T033 and T034 are
implemented as contracts with tests and the agent adopts them. T035a and T035b are complete; T035c stays
blocked until a refresh-token provider is accepted. T036 has the threshold helper but no settings
defaults yet.

## Phase 1 — Contract and registry

- [x] T001 Define provider types in `packages/core/src/providers/types.ts`: `ProviderId`, `AuthKind`,
  `BrowserAccess`, `Connection`, `ModelInfo`, `Capabilities`, `ProviderErrorCode`.
- [x] T002 Build the static registry in `registry.ts` for OpenRouter, OpenAI, Anthropic, Gemini and
  Meta: hosts, auth methods, browser-access status, default base URLs, catalogue endpoint, docs URL.
- [x] T003 Implement `capabilitiesFor(provider, model)` with explicit `unknown`; add table-driven tests
  for unknown context size, missing tool support and unsupported image input.
- [x] T004 Implement catalogue merge and cache-age rules in `models.ts` (fresh, stale, absent) with
  tests, including a model that disappears between fetches.
- [x] T005 Add the provider and connection fields to the book schema as optional fields, with a
  migration test proving an older `book.json` still parses and opens.
- [x] T006 Extend `packages/core/src/ipc.ts` with channels: `providers:list`, `providers:models`,
  `connections:list`, `connections:addKey`, `connections:remove`, `connections:test`,
  `connections:startOpenRouter`, `connections:cancelOpenRouter`, `usage:summary`. The final names are
  recorded in `IPC`.
- [x] T007 Implement the IPC handlers with Zod validation and the `Result` envelope; add a test for
  rejected unknown providers and malformed ids. The handlers use the shared `providerIdSchema` and
  `connectionIdSchema`; tests reject an unknown provider and a malformed connection id.

## Phase 2 — Credentials and redaction

- [x] T008 Define `CredentialVault` in core and an in-memory implementation for tests.
- [x] T009 Implement the desktop vault: `safeStorage` encryption, `userData/credentials.json`, atomic
  write, `0600`, summaries without secrets. Tests: round-trip, tampered ciphertext, missing key,
  unavailable encryption refuses to save.
- [x] T010 Implement `redact()` and route every main-process logger and IPC error through it. Tests
  cover `sk-`, `sk-or-`, bearer headers, query-string keys and token-shaped strings.
- [x] T011 Add a startup check that the vault file permissions are owner-only, correcting them where
  the platform allows and warning where it does not. `FileCredentialVault.repairPermissions()` checks
  the mode, chmods `0600` when needed, returns `corrected`/`owner-only`/`unavailable`, and the app calls
  it at startup.
- [x] T012 Add a test that scans `studio.json` and a fixture library after connecting and using a
  provider, asserting no credential material is present. The credentials test stores and touches a
  connection, writes settings and a fixture library, and scans every file for the plaintext secret.

## Phase 3 — OpenRouter connection

- [x] T013 Implement the loopback OAuth flow (`openrouter-oauth.ts`): verifier, S256 challenge, state,
  ephemeral port, 10-minute timeout, cancel.
- [x] T014 Exchange the code at `/api/v1/auth/keys`, store the key as a labelled connection, and return
  only the connection id and summary to the renderer.
- [x] T015 Implement catalogue fetch and cache for OpenRouter, including price and context parsing.
- [x] T016 Build the "Connected" state in the Connections panel: label, model count, last refresh,
  remove. Copy follows `docs/DESIGN.md`.
- [x] T017 Mocked-flow tests: happy path, wrong state, expired code, provider error, cancel closes the
  listener and writes nothing.

## Phase 4 — API keys

- [x] T018 Build the key form and per-provider validation for OpenAI, Anthropic, Gemini and Meta,
  using the endpoints in the plan and never a query-string key.
- [x] T019 Distinguish rejected, unreachable and unsupported in validation results; never save a
  rejected key.
- [x] T020 Support multiple labelled accounts per provider and removing one account's secret, refresh
  token and cached models in one action.
- [x] T021 Tests with mocked fetch for each provider, including a 401, a 429 with retry-after, a
  network failure and a model listing that omits capabilities.

## Phase 5 — ChatGPT plan (blocked)

- [ ] T022 **Blocked on D-102.** Wrap `@siwc/local` in `chatgpt.ts`: host id persistence, sign-in,
  profile list and selection, token refresh, sign-out.
- [ ] T023 **Blocked on D-102.** Model the connection state (`connected`, `canUsePlan`, profile) and
  show it in the panel with the active profile and model list.
- [ ] T024 **Blocked on D-102.** Mark turns that use the plan near the composer and in the usage line;
  never show a dollar cost for them.
- [ ] T025 **Blocked on D-102.** Hide the option entirely in any hosted or paid distribution, per
  FR-020.

## Phase 6 — Selection and runtime wiring

- [x] T026 Implement `selection.ts`: book default → per-turn override → first usable connection, with
  tests for each precedence step and for a missing default.
- [x] T026a Wire the one-off override through `AgentTurnInput`, IPC validation, the runtime, the chat
  composer and the model picker. The turn records the override; the book default is unchanged.
- [x] T027 Implement `transport.ts`, the only module that constructs AI SDK provider instances for
  OpenRouter, OpenAI, Anthropic, Gemini and Meta.
- [x] T028 Persist provider, model and connection label on each turn and render a model change between
  turns visibly in the conversation. The `done` event carries the turn model; usage records keep the
  optional connection label; the chat shows the connection and model when it changes.
- [x] T029 Mark a saved model that vanished from the catalogue as unavailable and offer the picker
  without closing the book. The picker names the missing model and clears the selection.
- [x] T030 Build the model picker with price, context and capabilities in author terms; disable actions
  a model cannot perform with a one-sentence reason.
- [x] T031 Keep provider hosts out of the renderer: the content security policy allows only local
  connections, model traffic stays in the main process, and `apps/desktop/tests/csp.test.ts` fails when
  a registered provider host appears or the policy goes missing.

## Phase 7 — Usage, cost and errors

- [x] T032 Implement turn usage records from the result total across steps; append to
  `.studio/usage/<bookId>.jsonl`; never upload.
- [x] T033 Implement cost labelling: reported, estimated, included in plan, unknown. Tests cover all
  four and the "never show $0.00 for unknown" rule.
- [x] T034 Implement `normalizeProviderError()` for auth, rate limit, quota, context, refusal, offline and
  unknown, with retry-after surfaced where provided.
- [x] T035a Preserve a failed request's prompt and prior history for retry. Persist partial-write
  checkpoints before reporting failure, require undo before retry, and withhold retry when undo could not
  be saved. Cover the no-model failure path in the hidden smoke run. The runtime now checkpoints before
  `error`, `stopped`, and `done`; the smoke run sends a prompt without a model, retries it, and confirms
  the prompt survives.
- [x] T035b Offer Reconnect for authentication failures and open the provider-connections section without
  clearing the failed request. Auth errors show Reconnect beside Retry; Reconnect opens Settings scrolled
  to Provider connections, and closing it returns to the failed turn. Verified in the browser build with a
  stubbed auth failure.
- [ ] T035c Refresh an expired credential once in the background, then mark it as needing attention if
  refresh fails. This stays blocked until a refresh-token provider is accepted; ChatGPT access is gated by D-102.
- [x] T036 Add the D-116 hooks: per-turn cost ceiling and monthly warning, with the defaults read from
  settings and left unset until the decision is accepted.
  Implemented: `perTurnCeilingUsd` and `monthlyWarningUsd` on the per-book agent settings (both
  null by default; old books still open), pure `turnCostWarning`/`monthlySpend`/`monthlyWarning`
  evaluators in `providers/usage.ts`, a `spending` block on `AgentStatus`, and a Spending section
  in the agent dialog with dollar inputs, the month-to-date line (lower-bound qualified when turns
  went unpriced) and both warnings. Informational only per 036 T004: nothing blocks, refuses or
  retries a turn. November 7 D-116 accepts two separate cost modes; these saved thresholds remain
  informational until explicitly converted. Monthly values remain per book; studio-wide accounting
  and qualified strict-money enforcement still need implementation.

## Phase 8 — Web enablement

The spec 010 storage boundary and spec 013 web shell have landed, so T037 and T038 are implementation
tasks rather than interface-blocked. T039 remains blocked on D-101.

- [x] T037 Implement the IndexedDB vault per accepted D-105 using the spec 010 storage boundary, with
  visible origin-scoped disclosure and the same credential-redaction contract tests as the desktop vault.
  No studio proxy; no credential in the library, logs or archive. `BrowserCredentialVault` stores
  origin-scoped records and returns summaries without secrets; Settings → About shows the disclosure;
  tests cover round-trip, touch, removal, re-open and redaction. The connection flow itself is T038.
- [x] T038 Implement the same-origin OpenRouter callback per accepted D-104 and browser capability gating.
  OpenRouter may ship after its browser-access check; Anthropic, Gemini and Meta remain gated by D-101.
  The browser build starts a same-origin popup with PKCE and state, exchanges the single-use code,
  stores the key in the browser vault, lists/removes it in Settings, and reports a blocked popup or
  offline exchange honestly. Unit tests cover callback exchange, opener messaging, popup completion and
  cancellation; the live browser-access pass remains T040/T041.
- [ ] T039 **Blocked on D-101.** Add browser-access tests for Anthropic, Gemini and Meta; update the
  registry only from their results.

## Phase 9 — Verification and documentation

- [ ] T040 Add opt-in live checks behind `LIVE_PROVIDER_TESTS` and `LIVE_SPEND_CAP_CENTS`, one per
  provider, printing status and model count only.
- [ ] T041 Run the manual pass: connect OpenRouter, restart, send a turn, check usage, remove the
  connection, confirm the secret is gone and the library contains nothing.
- [x] T042 Update `docs/DECISIONS.md` (D-104, D-105, D-116 status and evidence), `docs/FORMAT.md` for
  the new optional book fields, `AGENTS.md` for the provider boundary, `CHANGELOG.md`, and the
  provider section of `docs/ARCHITECTURE.md`. D-105 no longer blocks T037. D-116 is now accepted as
  a two-mode contract; enforcement/qualified adapters remain unimplemented, distinct from this row.
- [x] T043 Add a non-secret credential-vault status probe (`connections:status`) and a **Check keychain**
  action in Settings. The desktop probe performs an in-memory `safeStorage` encrypt/decrypt round-trip so
  a locked login keychain reports “Locked or unavailable”; the web build reports browser origin storage.
  `FileCredentialVault`, `DesktopCredentialVault`, `MemoryVault` and `BrowserCredentialVault` expose
  status; tests cover the status shape and connection count without a secret.
- [x] T044 Document the macOS unlock and manual-test runbook in [`docs/KEYCHAIN.md`](../../docs/KEYCHAIN.md)
  and add `STUDIO_VISIBLE=1` for a visible throwaway profile. The doc covers the ciphertext file, the
  `<app name> Safe Storage` item, `security unlock-keychain` without a password argument, locked-state
  testing, dev/packaged identity differences, recovery and the legacy-keychain limits.

## Phase 10 — Hand-entered model ids and key revocation

FR-007 and FR-013 had no tasks. Stated assumption, recorded here rather than as a new store: a
hand-entered id belongs to one connection, so it lives in that connection's credential metadata beside
its base URL. It is not a secret, survives a restart, and goes with the record when the connection is
removed (FR-027).

- [x] T045 Check a model id the connection does not list before keeping it (FR-007). `providers:addModel`
  validates sizes with Zod and the id's shape in `ProviderService` (one token, no `.` or `..` segment),
  then `checkModel` in `apps/desktop/src/main/agent/transport.ts` sends one request through the adapter a
  turn uses: a fixed prompt with no book text, a 16-token limit (the smallest OpenAI's Responses API
  accepts), no retries, and only the connection's own endpoint and base URL. The id is saved only if the
  model answers; `normalizeModelCheckError` maps a refusal to not found, no access, rate limited or
  unreachable, and the record is re-read after the check so a connection removed meanwhile stays removed.
  The browser build refuses plainly, because it cannot run the writing agent. Tests:
  `apps/desktop/tests/manual-models.test.ts`, `apps/desktop/tests/ipc-provider-links.test.ts`,
  `packages/core/tests/manual-models.test.ts`, `apps/web/tests/provider-links.test.ts`.
- [x] T046 List kept ids like catalogue models. `providers.models()` adds them behind the listed models
  (a listed model keeps the provider's facts) and still returns them, with `listError`, when the list
  cannot be read, so a turn on that connection runs. The picker offers Enter a model id as a secondary
  footer action, opens the path by itself when the list fails, marks kept ids "Entered by hand" and says
  "not reported" for unknown price, context and capabilities; unknown tool support keeps a model from the
  writing agent as before, and Meta's Muse Spark presets and the Contributor opt-in still apply. Tests:
  a restart over `FileCredentialVault`, an unlisted connection and a turn in
  `apps/desktop/tests/manual-models.test.ts`, and `apps/desktop/tests/model-picker-manual.test.tsx`.
- [x] T047 Tell the author, in the OpenRouter removal confirmation, that the key also exists in their
  OpenRouter account and can be revoked there, with Open OpenRouter keys (FR-013). `app:openLink` opens
  only `https://openrouter.ai/settings/keys`, compared as a whole string in the main process; the
  browser build opens the same allow-list in a new tab with no opener. The hidden smoke run checks that
  the bridge refuses an unlisted page and a model id for a missing connection. Tests:
  `apps/desktop/tests/connection-cards.test.tsx`, `apps/desktop/tests/ipc-provider-links.test.ts`,
  `apps/web/tests/provider-links.test.ts`.
- [ ] T048 Run the live pass: enter a model id that a real connection does not list, confirm one short
  request reaches only that connection's endpoint and the id survives a restart, then remove an OpenRouter
  connection and follow Open OpenRouter keys in the system browser. Not run yet: automated checks use
  mocked fetch only and never open a browser.
