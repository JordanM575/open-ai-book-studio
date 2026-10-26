# Provider compatibility and the Contributor test model

**Status:** Planned (2026-10-26)
**Number:** 022
**Depends on:** [011](../011-model-access/spec.md) connections and model access, [002](../002-studio-v1/spec.md)
agent runtime, [021](../021-product-film/spec.md) fixture book.

## Why

The agent should not care which provider serves a turn. OpenRouter, OpenAI, Anthropic, Gemini and Meta
must all arrive at the same AI SDK `LanguageModel` interface, with one capability record and one policy
gate. That is the compatibility layer: **one seam, many providers**, not one SDK branch per provider in
the runtime.

For the hackathon build, the test model is **Muse Spark 1.3 Contributor** on the Meta Model API. It is
the same model as Muse Spark 1.3 at a much lower price, but its prompts and completions may be used to
train Meta models. That trade must be explicit, visible and off by default. It is suitable for the
synthetic film fixture and public-domain tests, not for an author's private manuscript.

## Facts recorded from the event documentation

| | |
| --- | --- |
| Model ID | `muse-spark-1.3-contributor` |
| Standard sibling | `muse-spark-1.3` |
| Context | 1,048,576 tokens |
| Input | $0.10 per million |
| Cached input | $0.002 per million |
| Output | $0.20 per million |
| Reasoning | `minimal`–`xhigh`; `max` is not offered on Contributor |
| Training | Inputs and outputs may be used to train Meta models |
| Availability | Select countries; rate-limited by tokens |
| Modalities | Text, image, video, audio and PDF input; text output; tool calling |

Prices and availability are event-time facts. The app reads the provider catalogue at runtime and uses
these presets only to fill facts the catalogue omits; a changed price must not be hard-coded forever.

## User stories

1. **One seam.** I choose a connection and a model. The agent runs the same tools and checkpoint path
   whether the connection is Meta, OpenRouter or OpenAI.
2. **Test cheaply.** With the synthetic fixture book, I enable Contributor mode, run the real agent
   against Muse Spark 1.3 Contributor, and see the provider-reported usage.
3. **Stay safe.** With an ordinary author book, selecting Contributor shows a warning and requires an
   explicit checkbox. If I do not consent, the agent refuses before sending a byte and suggests Standard.
4. **Understand the trade.** The model picker shows the 1M context, the prices, the training warning and
   the reasoning limit, so I am not surprised later.
5. **No protocol leak.** The runtime never imports an SDK type from a provider package; `modelFor` is the
   only translation point.

## Requirements

### Compatibility layer

- **FR-001** `apps/desktop/src/main/agent/transport.ts` MUST expose one `modelFor(credential, modelId)`
  registry that maps every `ProviderId` to an AI SDK `LanguageModel`. The runtime, tools and tests MUST
  NOT branch on a provider.
- **FR-002** The compatibility registry MUST cover every provider in `PROVIDER_IDS`; a missing adapter is
  an `unsupported` error, not a silent fallback.
- **FR-003** Provider keys remain in the main process. The compatibility layer MUST NOT fetch, log,
  serialize or send a key anywhere except the selected provider.
- **FR-004** `ProviderService.models` MUST enrich a provider catalogue with known model facts without
  overwriting facts the provider reported. A provider that omits tools/context/prices still gets the
  known values where the preset is authoritative.
- **FR-005** `ModelInfo` MAY carry cached-input price, training-on-data, reasoning levels and a short
  note. Unknown values stay `null` and are displayed as unknown.

### Contributor policy

- **FR-006** The book record MUST have `allowContributorTraining`, default `false`. It is consent for
  this book only; it is never a global default or a hidden setting.
- **FR-007** The agent MUST refuse a turn on a contributor model when the book has not opted in, before
  making a provider request. The message MUST name the training trade and the Standard alternative.
- **FR-008** The model picker MUST show a Contributor warning, the affected model, the cached/input/output
  prices and a checkbox. “Use this model” MUST stay disabled until the checkbox is selected.
- **FR-009** A per-turn Contributor choice MUST also require the book consent; enabling it from the turn
  picker persists the book flag before the turn starts.
- **FR-010** Contributor mode MUST NOT be the default for a new book or an existing book. It MUST NOT be
  enabled by a silent migration.
- **FR-011** The UI copy MUST say that Meta may use the content to train its models and that the author
  should not use an author manuscript unless they accept that. The copy is not a legal guarantee.
- **FR-012** The test harness MUST use the synthetic fixture from spec 021 for live Contributor runs. A
  live run is opt-in, spend-capped and never uses the author's real library.
- **FR-013** The provider catalogue and the model picker MUST continue to work when the Contributor
  model is unavailable in the account's country or rate limit. The turn fails with the provider's
  normalized error; no fallback silently switches to a training-eligible model.

### Deferred endpoint

- **FR-014** “One endpoint” in v1 means the AI SDK `LanguageModel` seam, not a network proxy. A local
  OpenAI-compatible `/v1/chat/completions` gateway is a separate decision (D-139) because it needs
  request authentication, tool approval and a second tool-execution path.

## Non-goals

- A hosted or remote provider proxy, or a studio-operated model gateway.
- Automatic fallback from Standard to Contributor (or the reverse) based on price or errors.
- Training-consent inheritance across books, devices or connections.
- Changing Meta's account-level Contributor setting; the app only chooses the model ID.
- Sending the author's real manuscript to a Contributor model for “testing”.

## Acceptance scenarios

1. **Enriched catalogue.** A Meta connection lists `muse-spark-1.3-contributor`; the picker shows 1M
   context, $0.10/$0.20, cached $0.002, the Contributor warning and no `max` reasoning claim.
2. **Refusal.** With a fresh book, choose Contributor and send a turn without consent. The agent refuses
   with one sentence; no request reaches Meta.
3. **Consent.** Tick the checkbox, choose the model, send a turn on the fixture. The request reaches
   Meta, usage is recorded, and the book records `allowContributorTraining: true`.
4. **Standard.** Choose `muse-spark-1.3`; no consent checkbox appears and the agent runs normally.
5. **No protocol leak.** A source scan finds provider SDK imports only in `transport.ts` (and the
   provider service), not in the runtime, tools or shared app.
6. **Country/rate limit.** A 404/429 from Meta is shown as the provider error; the app does not switch
   models on its own.

## Open decisions

- **D-138** Contributor consent: book-level, default off, explicit checkbox, agent refusal before the
  request. Accepted by author direction on 2026-10-26; implementation follows this spec.
- **D-139** Network compatibility gateway: deferred. A local OpenAI-compatible endpoint would need its
  own token, tool-approval and streaming design; the AI SDK seam is enough for the app and the tests.
