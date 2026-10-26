# Plan: model access

**Spec**: [spec.md](spec.md) · **Status**: In progress (plan and tasks written, no code yet)
**Decisions**: D-104 (OpenRouter redirect, proposed), D-105 (browser key storage, open), D-106 (Bun +
Electron, accepted), D-114 (test boundaries, proposed), D-116 (cost ceilings, proposed)

## Context

The foundation has no model access at all: no provider registry, no credential storage, no connection
UI, no agent runtime. This plan adds the layer every AI feature depends on, in a shape that works for
the Electron build today and the browser build later without a second implementation of the rules.

The centre of gravity is not the HTTP calls. It is the boundary: the renderer must never hold a
credential, the book folder must never contain one, and a missing capability must be visible before a
turn is spent rather than discovered in an error message.

## Technical approach

### Packages and files

```
packages/core/src/providers/
  types.ts            ProviderId, Connection, ModelInfo, Capability, ProviderErrorCode
  registry.ts         static provider descriptions + capability rules (no network)
  models.ts           catalogue merge, cache age, unknown-value handling
  selection.ts        resolve the connection/model for a book and a turn
  errors.ts           normalise provider/SDK errors into author-facing codes
  redact.ts           one redaction function used by every logger
  usage.ts            turn usage record + cost rules (reported vs estimate vs plan)
packages/core/src/ipc.ts        new channels (see Contract)
apps/desktop/src/main/credentials.ts       CredentialVault over safeStorage + userData/credentials.json
apps/desktop/src/main/providers/
  openrouter-oauth.ts loopback PKCE flow
  chatgpt.ts          @siwc/local wrapper, desktop only
  keys.ts             API-key validation per provider, least-cost endpoints
  catalogue.ts        fetch + cache provider model lists
  transport.ts        one place that builds the AI SDK provider instance per connection
apps/desktop/src/renderer/src/views/settings/ConnectionsPanel.tsx
apps/desktop/src/renderer/src/views/settings/ModelsPanel.tsx
apps/desktop/src/renderer/src/components/ModelPicker.tsx
```

Later, the same core files are used by `apps/web`; only the vault and OAuth callback adapters differ
(ADR 0009, spec 010).

### Provider registry

One static table, one runtime catalogue:

- Static: provider id, display name, hosts, auth methods, browser-access status, default base URL,
  whether model listing requires a key, and the documentation links shown in the interface.
- Runtime: models fetched per connection, cached per provider+account with `fetchedAt`. A stale
  catalogue is usable; an absent one shows "Refresh models" rather than inventing values.
- Capability resolution is a pure function `capabilitiesFor(provider, model)`. Unknown context size or
  tool support stays `unknown` and disables the action with a reason (FR-003, FR-004). No defaults are
  guessed from a model name.
- Browser-access status comes from the same registry, so the web build cannot drift from it: `yes`
  (OpenRouter), `no` (OpenAI), `opt-in-header` (Anthropic), `unknown` (Gemini, Meta). `unknown` is
  treated as unavailable in the web build until a test in `tests/providers/browser-access` says
  otherwise (D-101, FR-053…FR-055).

### Credentials

`CredentialVault` interface in core:

```ts
interface CredentialVault {
  list(): Promise<CredentialSummary[]>          // id, provider, label, kind, createdAt — never secret
  set(record: StoredCredential): Promise<void>  // secret is encrypted inside the adapter
  get(id: string): Promise<StoredCredential | null>  // main process only
  remove(id: string): Promise<void>
  isAvailable(): Promise<boolean>
}
```

- Desktop: secrets encrypted with `safeStorage.encryptString` and written atomically to
  `userData/credentials.json` as base64; the file is `0600`. If `safeStorage.isEncryptionAvailable()`
  is false, saving is refused with an explanation (FR-025). The renderer sees only summaries.
- Web: IndexedDB, same interface, with the disclosure required by FR-054; final shape depends on D-105.
  Until D-105 is accepted, the web adapter is not built.
- Multiple accounts per provider are separate records with labels (FR-026). Removing a record deletes
  the secret, any refresh token and cached models for that account in one operation (FR-027, FR-050).
- No credential is ever written to `studio.json`, the library, exports or logs. The redaction function
  is applied in the main-process logger and the IPC error mapper, and has its own tests (FR-044…FR-046).

### OpenRouter OAuth (desktop)

1. Generate `code_verifier` (43–128 chars), `code_challenge` S256, and `state`.
2. Start an HTTP listener on `127.0.0.1` with an ephemeral port; the callback path is `/callback`.
3. Open `https://openrouter.ai/auth?callback_url=http://127.0.0.1:<port>/callback&code_challenge=…&code_challenge_method=S256&state=…`
   in the system browser.
4. On callback: reject wrong state, exchange the single-use code within its 10-minute life at
   `POST https://openrouter.ai/api/v1/auth/keys`, close the listener, store the returned key as a
   connection labelled by the author, and return the connection id.
5. Every failure path closes the listener and returns a typed error; cancel from the UI aborts it.

The listener accepts only the expected path, binds to loopback, and times out after 10 minutes.
The web flow uses the same PKCE exchange with a same-origin callback and the verifier in
`sessionStorage`, never in `localStorage` (D-104, FR-010).

### ChatGPT plan (desktop)

`@siwc/local` runs in the main process only. A `ChatGptConnection` stores the host id, profile id,
tokens and expiry through the vault. `signIn()` opens the system browser; the SDK handles the loopback
callback, PKCE, state and nonce. The connection state distinguishes `connected` from `canUsePlan` and
surfaces the active profile and model list (FR-017). Turns that use the plan are marked in the
composer and never priced in dollars (FR-019, FR-036).

This whole phase is blocked on D-102 (devkit eligibility and licence). Until it is accepted, the UI
shows the option as unavailable with the reason, not a broken button.

### API keys

One form: provider, label, key. Validation before saving, using the cheapest read-only call:

| Provider | Check | Notes |
| --- | --- | --- |
| OpenRouter | `GET /api/v1/key` | also returns limits |
| OpenAI | `GET /v1/models` | |
| Anthropic | `GET /v1/models` | `anthropic-version` header |
| Gemini | `GET /v1beta/models` | `x-goog-api-key` header, never a query key |
| Meta | `GET {base}/models` | base URL is required configuration (D-103) |

A rejected key is not saved and is reported as rejected, distinct from unreachable (FR-023). A saved
key is re-validated only when the author asks or when a turn fails with an auth error.

### Model selection and the runtime seam

- `Book` gains `defaultConnectionId` and `defaultModelId` (optional fields; older books stay valid).
- Per-turn override is passed with the request and never persisted as the book default (FR-029).
- `transport.ts` maps `connection.kind` to an AI SDK provider instance
  (`@openrouter/ai-sdk-provider`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, or
  `@ai-sdk/openai-compatible` for Meta). This is the only module that constructs providers.
- The agent runtime (ADR 0007) asks core `selection.ts` for a resolved target and receives a model
  handle plus the metadata to record on the turn. It never sees credential material.
- Every turn stores provider, model and connection label in the conversation, so changing models
  mid-conversation is visible (FR-030, FR-031). A missing saved model marks the book's default as
  unavailable and offers the picker (FR-032).

### Errors, usage and limits

- `normalizeError()` maps SDK/provider failures to codes: `auth`, `rate-limit`, `quota`, `context`,
  `refusal`, `offline`, `invalid-request`, `unknown`, with retry-after where given.
- Usage is recorded once per turn from the result's total across steps (FR-034). Cost shows reported
  cost when present, "estimated" when computed, "included in plan" for ChatGPT, and "unknown" when the
  provider supplies neither (FR-035, FR-036). A local append-only usage log lives at
  `.studio/usage/<bookId>.jsonl` in the library; it is never uploaded and is safe to delete.
- A failed request retains the exact prompt and prior turn history for an explicit retry. Partial chapter
  writes are checkpointed before the error reaches the renderer; retry stays unavailable until undo
  succeeds (FR-039). Auth failures offer the provider connection settings without discarding the request.
- Background refresh is limited to credentials that actually provide a refresh token. The current desktop
  key/OAuth flows do not expose one; ChatGPT plan refresh remains gated by D-102 (FR-040).
- D-116 proposes a per-turn cost ceiling and a monthly budget warning; the plan implements the hooks
  (record + check) but the exact defaults wait for that decision.

### Security

- CSP `connect-src` is generated from the registry hosts, so adding a provider is a registry change and
  a test change, not a hand-edited string (FR-049).
- OAuth uses PKCE S256, state, loopback binding, single-use codes, and a nonce where supported
  (FR-047). Minimum scopes only (FR-048).
- All provider calls happen in the main process (desktop) or a worker (web). The renderer receives
  connection summaries, model lists and usage; never secrets (FR-045).
- Logging passes through `redact()`; tests assert no `sk-`, `sk-or-`, bearer tokens or query keys reach
  output (FR-046).

## Phases

1. **Contract and registry** — provider types, static registry, capability rules, IPC channels,
   book fields. No network. Ends with unit tests for capability resolution and unknown handling.
2. **Vault and redaction** — desktop vault over safeStorage, in-memory vault for tests, redaction,
   logging. Ends with a contract test suite both adapters must pass.
3. **OpenRouter** — PKCE loopback flow, exchange, connection storage, model catalogue, delete.
   Ends with a mocked-flow test and a manual live check.
4. **API keys** — form, validation for four providers, account labels, removal. Ends with mocked
   validation tests and opt-in live checks.
5. **ChatGPT plan** — blocked on D-102; wrapper, state model, composer marking.
6. **Selection and runtime** — book defaults, override, transport module, conversation metadata.
7. **Usage and errors** — turn records, cost rules, error normalisation, retry-after, usage log.
8. **Web enablement** — depends on spec 010, D-101 and D-105; vault adapter, same-origin callback,
   capability gating. Not in this implementation pass.
9. **Verification** — Bun tests per D-114, opt-in live provider checks with `LIVE_SPEND_CAP_CENTS`,
   a redaction audit, and a manual pass of connect → pick model → send a turn → disconnect.

## Verification

- `bun test` — registry, capability rules, selection precedence, cost labelling, error mapping,
  redaction, vault contract (in-memory + a temp-file safeStorage double).
- `bun run typecheck` and `bun run verify`.
- Mocked OAuth server test: wrong state rejected, expired code rejected, listener closed on cancel.
- Opt-in live checks: one connection per provider, one model listing, one tiny turn with the spend cap.
- Manual: connect OpenRouter, restart, confirm connection survives; remove it and confirm the vault
  file no longer contains the secret; confirm no key material in `studio.json` or the library.

## Risks

| Risk | Mitigation |
| --- | --- |
| Provider APIs and model catalogues change | registry + cached catalogue + manual model id + typed errors |
| ChatGPT devkit is not eligible or licensed for distribution | phase 5 blocked on D-102, feature hidden rather than broken |
| Browser provider access differs from today's findings | browser-access tests gate each provider; unknown means unavailable |
| OAuth loopback blocked by a firewall or another app | ephemeral port, clear error, manual key as documented fallback |
| safeStorage unavailable (Linux without a keyring) | refuse to save, explain, do not fall back to plaintext |
| Cost accounting wrong for a provider | prefer reported cost; label estimates; show unknown |
| Credentials leak through logs or errors | single redaction path, tests, no secrets in renderer |

## Out of scope

Local model servers, provider accounts we host, usage-based billing, team libraries, and a proxy that
would see keys or prose. Also out: image and voice providers, which have their own decisions
(D-109, D-110).
