# Plan: provider compatibility and Contributor

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
packages/core/src/providers/compatibility.ts   provider-neutral model presets, Contributor policy
packages/core/src/providers/types.ts           optional cached price, training flag, reasoning levels
packages/core/src/schema.ts                    book.allowContributorTraining (default false)
apps/desktop/src/main/agent/transport.ts       one AI SDK adapter registry
apps/desktop/src/main/providers.ts             catalogue enrichment
apps/desktop/src/main/agent/runtime.ts         consent guard before any provider call
packages/app/src/components/ModelPickerDialog.tsx  warning, prices, checkbox, consent persistence
```

## The seam

`modelFor(credential, modelId)` is the only place that imports a provider SDK factory. It returns the AI
SDK `LanguageModel` interface, so the runtime, tools and tests see one shape. The registry is keyed by
`ProviderId`, and a missing key is an `unsupported` error. The Meta adapter remains OpenAI-compatible
with the base URL from the connection.

This is not a network endpoint. A network gateway would have to authenticate callers, stream OpenAI
chunks, decide which process executes tools and handle approvals. That is deferred by D-139.

## Catalogue enrichment

`META_MODEL_PRESETS` records the known facts for `muse-spark-1.3-contributor` and `muse-spark-1.3`.
`ProviderService.models` applies them after parsing the provider list, only for Meta, and only where the
provider did not supply a better value. The Contributor preset includes:

- 1,048,576 context, tools and images;
- $0.10 input, $0.002 cached input, $0.20 output per million;
- `trainingOnData: true`;
- reasoning `minimal`–`xhigh` (no `max`);
- the warning note shown in the picker.

## Consent

`BookMeta.allowContributorTraining` defaults to `false` and is written only by an explicit model-picker
action. `AgentRuntime.start` checks the model ID before it reads a credential or builds a model:

```ts
if (isContributorModelId(modelId) && !book.allowContributorTraining) {
  throw new ProviderError("invalid-request", "…Contributor training…");
}
```

The picker disables “Use this model” until the checkbox is selected. In book mode it saves the flag with
the model choice; in per-turn mode it persists the flag first, then starts the turn. The warning names
the training trade and suggests Muse Spark 1.3 Standard.

## Test plan

- Core: preset enrichment, cached price, training flag, no `max`, contributor helpers.
- Agent: contributor refusal without consent; consent path in the picker writes the field.
- Picker: warning visible, button disabled before consent, enabled after.
- Live: fixture book + Muse Spark 1.3 Contributor, opt-in only, record usage and no author data.

## Verification

`bun run typecheck`, `bun test`, `bun run build`, `bun run build:web`. No toolkit change. Source scan:
provider SDK imports only in the adapter and provider service.
