# Feature Specification: Model access and accounts

**Feature Branch**: `011-model-access`
**Created**: 2026-10-24
**Status**: Draft
**Input**: User description: "support ChatGPT agents SSO, use an agent with a ChatGPT subscription, OpenRouter model provider, OpenAI, Anthropic, Gemini, or Meta API key. OpenRouter will have a SSO that is easy, and same with ChatGPT, we will improve security where possible."

## Overview

The studio does not resell inference. An author brings the access they already pay for: an OpenRouter
account, a ChatGPT plan, or an API key from OpenAI, Anthropic, Google or Meta. This specification defines
how those accounts are connected, what each one can and cannot do, how the choice is explained, and how
credentials are kept away from the manuscript.

Two access methods are one-click sign-ins and must feel like it:

- **OpenRouter** uses OAuth with PKCE. The author approves the studio, and a key tied to their own
  account is issued and billed to their own credits. This works in the desktop application and in the
  web build.
- **ChatGPT plan usage** uses OpenAI's official "Sign in with ChatGPT" flow for local open-source apps.
  The author signs in with their ChatGPT account and can spend their plan allowance inside the studio.
  This is a desktop capability: the flow is defined for apps that run locally, and a remotely hosted
  build needs OpenAI's approval before it may offer it.

Everything else is an API key the author pastes once, validates, and can remove.

## Clarifications

### Session 2026-10-24

- Q: Which access method is the default? → A: OpenRouter. It is the only method that works in every
  build, supports the widest model catalogue with one connection, and reports usage and cost directly.
- Q: Does the web build support every provider? → A: No. Browser access is a per-provider property, not
  a preference. The web build enables a provider only after a browser-access test passes. OpenRouter is
  verified; OpenAI is blocked by CORS; Anthropic needs an explicit opt-in header; Gemini and Meta are
  unverified. Unsupported providers are shown disabled with the reason, never hidden.
- Q: Is there a proxy for providers that block browsers? → A: Not in v1. A proxy would see the author's
  key and prose, which contradicts the no-custody promise. Desktop covers those providers.
- Q: Where are credentials stored? → A: The operating system's protected storage in the desktop build.
  The web build keeps the OpenRouter key in origin storage with an explicit disclosure, because a
  browser has no keychain. Neither build ever writes a credential into the library.
- Q: Can an author use several providers? → A: Yes. Each connection is separate, one is active per turn,
  and the book records which model produced which turn.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect OpenRouter in one click (Priority: P1)

The author chooses "Connect OpenRouter", approves the studio in their browser, and returns to a
connected account. They never copy a key, never see a JSON response, and the key is billed to their own
OpenRouter credits.

**Why this priority**: It is the fastest path from install to a working agent, and it is the only
connection that works in both builds.

**Independent Test**: From a clean profile, connect with a test OpenRouter account, confirm the account
card shows the connection, run one short request, and confirm usage appears on the author's OpenRouter
activity page.

**Acceptance Scenarios**:

1. **Given** no connection, **When** the author chooses Connect OpenRouter, **Then** the system browser
   opens the OpenRouter authorisation page and the studio waits on a loopback callback.
2. **Given** the author approves, **When** the callback returns a code, **Then** the studio exchanges it
   once, stores the issued key in protected storage, and shows the connected account without ever
   displaying the key.
3. **Given** the author denies access, **When** the callback reports it, **Then** the studio shows a
   calm explanation, makes no request, and offers to try again.
4. **Given** the author is in the web build, **When** they connect, **Then** the callback returns to the
   studio's own origin, the code is exchanged, and the key is kept in origin storage with the disclosure
   required by the browser build.

---

### User Story 2 - Use my ChatGPT plan (Priority: P1, desktop)

The author has a ChatGPT Plus or Pro plan and no API key. They choose "Continue with ChatGPT", sign in,
grant plan usage, and the studio shows that requests are using their plan, with a link to manage usage.

**Why this priority**: For a hackathon audience it removes the largest onboarding cost — creating and
funding an API key — and it is an official, supported flow for local open-source apps.

**Independent Test**: In the desktop build with an eligible account, complete the sign-in, list models,
run one short request, and confirm the response completes and the connection card says it is using the
ChatGPT plan.

**Acceptance Scenarios**:

1. **Given** an eligible ChatGPT account, **When** the author chooses Continue with ChatGPT, **Then** the
   system browser opens the authorisation page and the studio listens on a loopback address only.
2. **Given** the author grants identity and plan usage, **When** the flow returns, **Then** the studio
   verifies the identity token, stores the issued credentials in protected storage, and lists the models
   available to that plan.
3. **Given** the author grants identity but not plan usage, **When** the connection returns, **Then** the
   studio says plainly that the account is connected but cannot run model requests, and explains how to
   grant plan usage.
4. **Given** the author reaches a plan limit, **When** the request fails, **Then** the error names the
   limit and offers "Manage usage" as the primary action.
5. **Given** the web build, **When** the author looks for this option, **Then** it is absent with a short
   explanation that ChatGPT plan usage is available in the desktop app only.

---

### User Story 3 - Add an API key for another provider (Priority: P1)

The author has an OpenAI, Anthropic, Gemini or Meta key. They paste it, the studio validates it with a
read-only call before saving, shows which models are available, and can remove it in one action.

**Why this priority**: Authors arrive with different accounts; a studio that only speaks OpenRouter is
not actually bring-your-own-model.

**Independent Test**: For each provider, paste a valid key, see the connection card and model list; paste
an invalid key, see a specific error and no saved credential.

**Acceptance Scenarios**:

1. **Given** a key, **When** the author saves it, **Then** the studio validates it with a read-only
   request, stores it in protected storage, and never echoes it back.
2. **Given** an invalid or revoked key, **When** validation runs, **Then** the studio keeps the
   connection unconnected and explains whether the key was rejected, lacked permission, or could not
   reach the provider.
3. **Given** a connected provider, **When** the author removes it, **Then** the credential is deleted,
   cached models are dropped, and no further request is made with it.
4. **Given** a provider that the current build cannot reach from the browser, **When** the author opens
   its card, **Then** the reason is shown and the desktop application is named as the place to use it.

---

### User Story 4 - Know what each provider can do before choosing (Priority: P1)

The author sees, for each model, whether it can call tools, accept images, stream, and how much context
it has, with the source of that information. The agent refuses to run on a model that cannot call tools
and says why.

**Why this priority**: The inherited application promised tool use on models that could not do it, and
guessed context sizes. That produced failures the author could not explain.

**Independent Test**: Open the model picker, filter to tool-capable models, select one, and confirm the
agent runs; select a non-tool model and confirm the action is disabled with a reason.

**Acceptance Scenarios**:

1. **Given** a provider catalogue, **When** the model picker opens, **Then** each model shows context,
   tool support, image support and price source, or says unknown.
2. **Given** a model without tool support, **When** the author selects it for the agent, **Then** the
   studio disables the action and explains that editing requires tools.
3. **Given** the provider does not publish a context size, **When** the model is shown, **Then** the
   studio says "unknown" and does not invent a number.

---

### User Story 5 - See what a turn cost (Priority: P2)

After a request, the author sees tokens and cost from the provider that served it. Where the provider
reports no price, the studio shows "unknown" rather than zero, and estimates are labelled.

**Why this priority**: Cost surprise is a trust failure; the inherited app showed confident but wrong
figures.

**Independent Test**: Run one turn on each connection type; compare the displayed usage with the
provider's own dashboard for the same request.

**Acceptance Scenarios**:

1. **Given** an OpenRouter response, **When** the turn ends, **Then** the studio shows the provider's
   reported cost and token totals for the whole turn, not the last step.
2. **Given** a ChatGPT-plan turn, **When** the turn ends, **Then** the studio shows that the plan was
   used and does not invent a dollar amount.
3. **Given** a provider that reports tokens but not price, **When** the turn ends, **Then** the studio
   shows tokens, labels any computed cost as an estimate, and shows "—" when no price is known.

---

### User Story 6 - Recover from an expired connection (Priority: P2)

A token expires, a key is revoked, or a plan limit is reached mid-session. The author gets one clear
sentence, a way to reconnect, and their unsaved text is untouched.

**Why this priority**: Credentials expire in normal use; losing a paragraph because of it is not
acceptable.

**Independent Test**: Revoke a key at the provider, send a message, and confirm the draft survives, the
error names the connection, and reconnecting resumes work.

**Acceptance Scenarios**:

1. **Given** a revoked key, **When** a request is made, **Then** the studio keeps the draft, marks the
   connection as needing attention, and offers Reconnect.
2. **Given** a rate limit, **When** the provider returns a retry delay, **Then** the studio explains the
   wait and does not spin.
3. **Given** a reconnect, **When** it succeeds, **Then** the same turn can be sent again without retyping.
4. **Given** an agent turn changed one or more chapters before failing, **When** the error is shown,
   **Then** its undo checkpoint is already saved and retry is unavailable until the author undoes those changes.

---

### User Story 7 - Keep credentials out of my book (Priority: P1)

The author can inspect the library, the exports and the logs and find no key, token or account secret.
Removing a connection removes the credential everywhere the studio controls.

**Why this priority**: The inherited app stored a premium voice key in plain browser storage. That is
the failure this specification exists to prevent.

**Independent Test**: Connect every provider, use the app, then grep the library, exports, logs, crash
dumps and built bundles for the credential strings and for authorization headers.

**Acceptance Scenarios**:

1. **Given** a connected provider, **When** the library folder is searched, **Then** no credential
   material is present in `book.json`, chapter files, `.studio` or exports.
2. **Given** an error, **When** it is shown or logged, **Then** authorization headers and key query
   parameters are redacted.
3. **Given** the author removes a connection, **When** removal completes, **Then** the credential and
   refresh token are gone from protected storage and the model cache.

---

### User Story 8 - Use the web build without pretending (Priority: P2)

The author opens the web build, sees which connections work there, and is never offered a button that
cannot succeed. OpenRouter works end to end. Providers that require a desktop process say so.

**Why this priority**: A hackathon judge may only open the link. The web build must demonstrate the
product honestly rather than fail at the first click.

**Independent Test**: In a browser, connect OpenRouter and run a turn; confirm every other provider is
either working or disabled with a reason, and that no request is attempted to a blocked endpoint.

**Acceptance Scenarios**:

1. **Given** the web build, **When** the author opens model access, **Then** OpenRouter is offered and
   each other provider states whether it works here and why.
2. **Given** a provider disabled in the browser, **When** the author selects it, **Then** no network
   request is made and the card points to the desktop application.
3. **Given** a browser that clears origin storage, **When** the studio next opens, **Then** it explains
   that the connection must be made again and does not silently lose manuscript files.

---

### Edge Cases

- The author closes the browser during OAuth, or the code expires after ten minutes.
- The callback reaches the studio twice, or with a missing or mismatched state value.
- A second instance of the studio starts a second loopback listener on the same machine.
- The provider returns a model list containing models the key cannot use.
- A provider retires a model that a book has saved as its default.
- The key is valid but the account has no credit, or the plan has no remaining allowance.
- The provider refuses a request for content-policy reasons.
- The author switches provider mid-book, or switches model mid-conversation.
- The author connects the same provider twice with different accounts.
- The operating system's protected storage is unavailable, as can happen on some Linux setups.
- The web build runs in a private window where storage is cleared on close.
- A proxy or corporate network intercepts TLS.
- The provider changes its OAuth response or model catalogue shape.
- The author pastes a key with leading or trailing whitespace, or a key for the wrong provider.
- The author's clock is wrong, making token expiry calculations unreliable.

## Requirements *(mandatory)*

### Provider registry and capabilities

- **FR-001**: The studio MUST maintain one provider registry describing, for each provider, its name, its
  supported connection methods, its model catalogue source, and whether it works in the desktop build,
  the web build, or both.
- **FR-002**: The registry MUST record per model: identifier, display name, context size, tool support,
  image input support, streaming support, and the source of each fact (provider catalogue, documented
  default, or unknown).
- **FR-003**: The studio MUST NOT guess a context size or a tool capability. Unknown values MUST be shown
  as unknown and treated conservatively.
- **FR-004**: The studio MUST disable any action that a model cannot perform, with a one-sentence reason
  beside it.
- **FR-005**: The studio MUST require tool support for the writing agent, and MUST explain the
  requirement when a model lacks it.
- **FR-006**: A provider catalogue MUST be cached locally with a timestamp, refreshed on demand, and
  usable offline for models already seen.
- **FR-007**: The studio MUST allow a manual model identifier for providers whose catalogue cannot be
  listed, and MUST validate it with a minimal request before saving.

### OpenRouter connection

- **FR-008**: The studio MUST offer OpenRouter as a one-click connection using OAuth with PKCE (S256), a
  random state value, and no client secret.
- **FR-009**: In the desktop build, the callback MUST be received on a loopback address bound to
  `127.0.0.1` on an arbitrary free port, and the listener MUST close after the exchange or a timeout.
- **FR-010**: In the web build, the callback MUST return to the studio's own origin and the PKCE verifier
  MUST live only for the duration of the flow.
- **FR-011**: The studio MUST reject a callback whose state does not match, MUST exchange a code only
  once, and MUST explain an expired code without asking the author to paste anything.
- **FR-012**: The issued key MUST be labelled for the studio, MUST be stored in protected storage, and
  MUST never be displayed after issuance.
- **FR-013**: Removing the connection MUST delete the stored key. The studio MUST tell the author that
  the key also exists in their OpenRouter account and can be revoked there, with a link.

### ChatGPT plan connection (desktop)

- **FR-014**: The studio MUST offer "Continue with ChatGPT" in the desktop build using OpenAI's official
  sign-in flow for local applications, and MUST NOT offer it in the web build.
- **FR-015**: The flow MUST generate and persist a per-installation host identifier, MUST use PKCE and a
  nonce, and MUST verify the returned identity token before accepting the connection.
- **FR-016**: The connection MUST request only identity, offline access and the plan-usage permission;
  the studio MUST NOT request conversation access.
- **FR-017**: The studio MUST distinguish "connected" from "can use the plan", and MUST show which
  permission is missing when the second is not granted.
- **FR-018**: Credentials and refresh tokens MUST be stored by the desktop main process in protected
  storage, never exposed to the interface, and refreshed there before expiry.
- **FR-019**: When a request uses the author's plan, the interface MUST say so near the composer and MUST
  offer a "Manage usage" action that opens the author's ChatGPT usage settings.
- **FR-020**: If the build is distributed as a hosted or paid service, the studio MUST NOT offer plan
  usage until OpenAI has approved that distribution; the capability MUST be disableable by configuration
  without a code change.

### API keys

- **FR-021**: The studio MUST support API keys for OpenAI, Anthropic, Google Gemini and Meta through one
  connection pattern: paste, validate, name, save, test, remove.
- **FR-022**: Validation MUST use the least expensive read-only request available, MUST NOT create
  content, and MUST complete or fail within a short, visible wait.
- **FR-023**: The studio MUST NOT save a key that fails validation, and MUST distinguish rejected
  credentials, missing permission, exhausted quota, and unreachable provider.
- **FR-024**: Keys MUST be stored in the operating system's protected storage in the desktop build. The
  web build MUST state that it has no keychain and MUST keep the OpenRouter key in origin storage with a
  visible explanation; other providers are not available there in v1.
- **FR-025**: If protected storage is unavailable, the desktop build MUST refuse to store the key rather
  than write it in clear text, and MUST explain the limitation.
- **FR-026**: The studio MUST allow more than one account per provider, each with a display label, and
  MUST show which one is active.
- **FR-027**: Removing an account MUST delete its credential, refresh token and cached models, and MUST
  NOT delete manuscript data or conversation history.

### Model selection

- **FR-028**: Each book MUST have a default connection and model, changeable at any time.
- **FR-029**: Each turn MUST allow a one-off model override without changing the book default.
- **FR-030**: The studio MUST record, for every turn, the provider, model and connection label used, so a
  past answer can be explained.
- **FR-031**: A model change mid-conversation MUST be allowed and MUST be visible in the conversation in
  plain words, not as an internal identifier.
- **FR-032**: If a saved model disappears from the catalogue, the studio MUST keep the book open, mark the
  default as unavailable, and ask for a replacement before the next agent turn.
- **FR-033**: The model picker MUST show price, context and capabilities in the author's terms, with
  "unknown" where the provider does not say.

### Usage, cost and limits

- **FR-034**: Usage MUST be reported per turn as a total across all steps, never as the last step alone.
- **FR-035**: Where the provider reports cost, the studio MUST display that cost. Where it does not, the
  studio MUST show tokens, label computed cost as an estimate, or show "—" when no price is known.
- **FR-036**: A ChatGPT-plan turn MUST NOT display a dollar cost; it MUST display that plan usage was used
  and link to usage management.
- **FR-037**: The studio MUST keep a local usage record per book and per provider, and MUST NOT upload it.
- **FR-038**: When a provider reports a rate limit or a quota, the studio MUST show the provider's wait
  time or limit in plain language and MUST NOT retry in a loop.

### Errors and recovery

- **FR-039**: A credential failure MUST NOT lose the author's draft or current turn text, and MUST offer
  Reconnect for the connection that failed. A failed request MUST remain available with its original
  prompt and prior conversation history, so the author can retry without retyping. If the failed attempt
  changed chapters, the studio MUST save its undo checkpoint before showing the error and MUST withhold
  retry until the author has undone those changes. If the checkpoint cannot be saved, the studio MUST
  explain that the changed chapters need review and MUST NOT offer retry.
- **FR-040**: An expired token MUST be refreshed in the background once; if refresh fails, the studio MUST
  mark the connection as needing attention without interrupting typing.
- **FR-041**: A content-policy refusal MUST be reported as the provider's refusal, with a suggestion to
  try another model, and MUST NOT be presented as a studio bug.
- **FR-042**: A context overflow MUST be reported with the model's limit and an offered remedy (condense,
  shorten history, or choose a larger model).
- **FR-043**: An unreachable provider MUST produce an offline-aware message and MUST leave the studio fully
  usable for writing, planning and exporting.

### Security and privacy

- **FR-044**: Credentials MUST never be written to the library, exports, logs, crash reports, analytics,
  error messages, URLs or built interface bundles.
- **FR-045**: The interface MUST receive only connection status, account labels and model data; it MUST
  NOT receive a key or refresh token.
- **FR-046**: Authorization headers, key query parameters and token-shaped strings MUST be redacted from
  every log and diagnostic surface, and a test MUST fail if redaction regresses.
- **FR-047**: OAuth flows MUST use PKCE, state and, where the provider supports it, a nonce; loopback
  listeners MUST bind to `127.0.0.1` only and MUST time out.
- **FR-048**: The studio MUST request the minimum scopes each provider allows and MUST show what it is
  asking for before the browser opens.
- **FR-049**: The content security policy MUST allow connections only to registered provider hosts and
  the studio's own origin.
- **FR-050**: Removing a connection MUST be immediate, confirmed once, and verified by a test that no
  subsequent request is attempted.
- **FR-051**: The studio MUST NOT send prose or credentials anywhere except the provider selected for the
  turn, and MUST NOT operate a proxy that receives either in v1.

### Desktop and web differences

- **FR-052**: The desktop build MUST support every connection method in this specification.
- **FR-053**: The web build MUST enable a provider only after a browser-access test passes for that
  provider, and MUST disable the rest with the reason and the alternative.
- **FR-054**: The web build MUST disclose that its credentials live in origin storage, can be cleared by
  the browser, and are less protected than an operating-system keychain.
- **FR-055**: The web build MUST NOT attempt a request to a provider known to block browser origins.
- **FR-056**: Connection availability MUST be derived from one capability description used by both builds,
  so documentation and interface cannot disagree.
- **FR-057**: The desktop build MUST expose a non-secret credential-vault status: available/locked,
  backend label, connection count and one actionable sentence. The status probe MUST exercise an
  in-memory encrypt/decrypt round-trip so a locked macOS login keychain is reported, not assumed healthy.
  It MUST NOT return a key, keychain password or host path.
- **FR-058**: The macOS keychain unlock and manual-test process MUST be documented in
  [`docs/KEYCHAIN.md`](../../docs/KEYCHAIN.md): how to add a key, unlock the login keychain without
  passing a password on a command line, test the locked state, use a throwaway visible profile, recover
  from a lost keychain item, and the limits of the legacy keychain. The app copy MUST point the author
  to the status check, not ask for a keychain password.

### Key Entities

- **Provider**: identity, display name, connection methods, catalogue source, browser availability,
  documentation links.
- **Connection**: provider, method (OpenRouter OAuth, ChatGPT plan, API key), account label, status
  (connected, needs attention, disconnected), scopes granted, created and last-used times.
- **Credential**: the secret material and refresh token, held only in protected storage; never a library
  entity and never exported.
- **Model**: provider, identifier, display name, context size, tool/vision/streaming support, price
  information and its source.
- **Usage record**: book, conversation, turn, provider, model, token totals, reported or estimated cost.
- **Capability**: a build-level statement that a provider or model can perform an action here, with a
  reason when it cannot.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new author connects OpenRouter in under 30 seconds from a clean profile, without copying a
  key, in 95% of attempts on the tested browsers.
- **SC-002**: An eligible author connects ChatGPT plan usage in under 60 seconds, and a completed request
  is visibly attributed to their plan.
- **SC-003**: An invalid key is rejected within 5 seconds with a message naming the cause, and no
  credential is saved.
- **SC-004**: Across a 30-day use trial, no credential, token or authorization header is discoverable in
  the library, exports, logs, crash reports or built bundles.
- **SC-005**: Removing a connection stops all requests with it in 100% of tested cases, including
  in-flight retries.
- **SC-006**: Displayed usage matches the provider's own figures within 1% when reported, and is labelled
  unknown or estimated otherwise, in 100% of audited turns.
- **SC-007**: Every provider unavailable in the web build is visibly disabled with a reason, and zero
  requests are attempted to it, in 100% of tested cases.
- **SC-008**: An expired or revoked credential never loses accepted text; the draft survives and the turn
  can be retried after reconnecting in 100% of drills.
- **SC-009**: A model without tool support can never start an agent turn; the refusal is visible before
  the request in 100% of attempts.
- **SC-010**: Switching provider or model mid-book preserves all manuscript text and makes the change
  visible in the conversation in 100% of tests.
- **SC-011**: The connection cards pass a keyboard-only and screen-reader review, with status announced
  without relying on colour alone.
- **SC-012**: A contributor can determine every provider's supported connection methods and browser
  availability from one screen and one document, and the two agree.

## Assumptions

- **OpenRouter**: OAuth PKCE is available at `https://openrouter.ai/auth` with a loopback callback on any
  port; codes expire after ten minutes and are exchanged once at `/api/v1/auth/keys`. The issued key is
  controlled by the author's account and billed there.
- **ChatGPT plan usage**: OpenAI's "Sign in with ChatGPT" devkit supports local open-source applications
  and selected private apps; hosted or paid distribution requires approval. Plan usage is subject to
  ChatGPT plan eligibility and limits, and the studio must not describe it as an API key.
- **OpenAI API**: browser requests are blocked by CORS, so this connection is desktop-only in v1.
- **Anthropic API**: browser requests require an explicit direct-browser-access header; the web build
  treats this as unverified until a browser-access test passes.
- **Google Gemini**: browser behaviour is unverified; the web build treats it as unavailable until tested.
- **Meta**: the provider is reached through its current OpenAI-compatible endpoint, whose base URL is
  configuration rather than a hard-coded assumption, because Meta has changed and retired endpoints
  before. A key is required; browser access is unverified.
- **No proxy**: the web build does not route requests through a server we operate. This keeps keys and
  prose out of our infrastructure and is a deliberate limitation of v1.
- **Secrets in development and CI**: provider keys for tests live in environment variables or CI secrets,
  never in the repository, fixtures or screenshots. Live provider tests are opt-in and budget-capped.
- **Sign-in UI**: new panels for connections, accounts, model choice and usage are added to the design
  kit before implementation, following `docs/DESIGN.md`.

## Non-Goals (v1)

- Reselling inference, hosting accounts, team billing, or an OpenRouter marketplace listing.
- Local model runtimes (Ollama, LM Studio) — a candidate for a later adapter.
- OAuth identity sign-in for the studio itself; the studio has no accounts.
- Using a ChatGPT subscription through an undocumented endpoint or a coding harness.
- A server-side proxy for providers that block browsers.
