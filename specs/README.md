# Specs

Each directory is one feature: `spec.md` (why and what), `plan.md` (how), `tasks.md` (ordered work,
`[x]` when done). See ADR 0005 for the process and `.specify/memory/constitution.md` for the rules
every spec must satisfy.

| Spec | Title | State |
| --- | --- | --- |
| [001](001-foundation/spec.md) | Foundation: library, format, editor | Implemented (retroactive) |
| [002](002-studio-v1/spec.md) | AI Book Studio v1: the whole product, white-room | In progress (current) — library, editor, Story Bible, provider connections, a first agent loop, Word export, legacy import and book search |
| [003](003-earlier-studio-import/spec.md) | Earlier studio import: an export into the new library | In progress — backup parser, importer, library import button and tests |
| 004 | Story Bible: returnable planning, cast, outline, memories | Folded into 002 |
| 005 | Writing agent: runtime, keychain, tool edits, checkpoints | Folded into 002 |
| 006 | Index: SQLite cache for search, conversations and usage | Folded into 002 |
| 007 | Export: DOCX, PDF and EPUB with KDP settings | Folded into 002 |
| 008 | Sync surface: conflict review, device names, library health | Folded into 002 |
| [009](009-packaging-release/spec.md) | Packaging and release: signing, notarisation, updates ([plan](009-packaging-release/plan.md), [tasks](009-packaging-release/tasks.md)) | Draft, gated by D-115 — release record and unsigned path specified; signing, notarisation and updates wait on the decision |
| [010](010-web-target/spec.md) | Browser target: local libraries and portable storage ([plan](010-web-target/plan.md), [tasks](010-web-target/tasks.md)) | In progress — shared library service, desktop port, portable archive, browser storage/archive I/O, save-failure tests and web smoke journeys implemented; folder/permission journeys and archive import picker covered by tests; Playwright Chromium passes the real storage harness 16/16, with Firefox/WebKit OPFS findings; native folder-picker matrix and shared UI extraction remain |
| [011](011-model-access/spec.md) | Model access: OpenRouter SSO, provider keys, ChatGPT plan, usage | In progress — Phases 1–4, selection, model picker, transport, usage records, per-turn model override and metadata, credential safety and the first writing-agent loop implemented; browser credential vault, disclosure and OpenRouter sign-in added; live browser-access pass T040/T041 remains; [plan](011-model-access/plan.md), [tasks](011-model-access/tasks.md) |
| [012](012-automated-verification/spec.md) | Automated verification: unit, contract, end-to-end, live provider checks ([plan](012-automated-verification/plan.md), [tasks](012-automated-verification/tasks.md)) | In progress — 560+ Bun tests, `bun run e2e` (7 checks: smoke, web, audit, glasses, ambient, plugins, bridge), the accessibility pass in the audit, the live provider check and `submission:check`; lint, coverage, performance, security, a CI runner and release gates remain |
| [013](013-builds-and-deployment/spec.md) | Builds and deployment: shared core, desktop and web builds, staging | In progress — web shell built and smoke-tested; build metadata, capability table, environments, runbook and CI workflow added; `packages/ui` carries the primitives and stylesheet, `packages/app` the shared shell, and T014's light/dark gallery is measured; [plan](013-builds-and-deployment/plan.md), [tasks](013-builds-and-deployment/tasks.md) |
| [014](014-mobile/spec.md) | Mobile: iPhone and iPad mini layouts, Capacitor shell ([plan](014-mobile/plan.md), [tasks](014-mobile/tasks.md)) | Implemented — responsive layouts, Capacitor shell, touch-target audit, iPad mini rotation and accessibility pass complete; signing/real-device distribution remains; depends on 010/013 |
| [016](016-sync/spec.md) | Sync and device trust: two-device folders, drift detection, local app lock ([plan](016-sync/plan.md), [tasks](016-sync/tasks.md), [research](016-sync/research.md)) | In progress — journal, read-only drift detector, library scan, two-system harness and docs (T001–T005, T013) implemented; drift report and lock wait on D-121–D-124 |
| [017](017-voice-and-background/spec.md) | Voice notes and background runs: Muse Voice Transcribe dictation, WAV conversion, background turns and native notifications ([plan](017-voice-and-background/plan.md), [tasks](017-voice-and-background/tasks.md)) | Implemented — voice service, WAV validation/conversion, editor insertion, background outcome callback, notification copy and tests; the live Meta-key/manual pass (T012) is pending |
| [018](018-agent-toolkit/spec.md) | Agent toolkit: standalone `bookwriter` CLI, MCP server and the loopback backend ([plan](018-agent-toolkit/plan.md), [tasks](018-agent-toolkit/tasks.md)) | Implemented — loopback backend with per-run token, CLI read/write commands, read-only MCP server with opt-in writes and tests; the manual desktop/MCP pass (T011) is pending |
| [019](019-illustrations/spec.md) | Illustrations: `images.json`, the image store and Muse Image generation ([plan](019-illustrations/plan.md), [tasks](019-illustrations/tasks.md)) | In progress — manifest schema, atomic image store, Muse Image service, IPC, editor attachment and DOCX embedding implemented; the cutout and live-key manual passes remain |
| [020](020-sam-cutout/spec.md) | SAM 3.1 character cutouts: concept prompts, mask parsing and transparent PNGs ([plan](020-sam-cutout/plan.md), [tasks](020-sam-cutout/tasks.md)) | **Superseded by D-158** — the implementation and its tests exist, but a live request is accepted and returns nothing, so nothing is built on it |
| [021](021-product-film/spec.md) | Product film and voiceover: three-minute master, social cuts, narration and motion plates ([plan](021-product-film/plan.md), [tasks](021-product-film/tasks.md)) | In progress — brand review, script, storyboard, `film:fixture` generator and the eight Playwright motion plates are done; capture, voice, music and edit remain |
| [022](022-provider-compatibility/spec.md) | Provider compatibility and the Contributor test model: one AI SDK seam, Muse Spark 1.3 Contributor facts and book-level training consent ([plan](022-provider-compatibility/plan.md), [tasks](022-provider-compatibility/tasks.md)) | Implemented — adapter registry, catalogue presets, Contributor guard, picker warning/checkbox and tests; the live Contributor pass waits on a Meta key |
| [023](023-submission/spec.md) | Submission package: sample library, packet, secret scan and readiness check ([plan](023-submission/plan.md), [tasks](023-submission/tasks.md)) | In progress — sample library, `hackathon/SUBMISSION.md`, `submission:check` and sample tests added; clean-clone, public visibility and form submission remain |
| [024](024-agent-tool-parity/spec.md) | Tool parity: the studio's own writing tools over the loopback backend and the MCP server, plus a UI audit ([plan](024-agent-tool-parity/plan.md), [tasks](024-agent-tool-parity/tasks.md)) | In progress — the catalog, the bridge, the backend routes, the MCP mirror, the CLI commands and the end-to-end test are done; two interface dead ends are fixed |
| [025](025-agent-capabilities/spec.md) | Agent capabilities: cacheable prompt prefix and hit rate, per-tool metrics, per-book tool control, `SKILLS.md` and a plugin folder of TypeScript tools ([plan](025-agent-capabilities/plan.md), [tasks](025-agent-capabilities/tasks.md)) | Implemented — the cache prefix, the metrics log, the withdrawn-tool filter across the model, the backend and MCP, the skills file, the plugin loader and the agent panel are done; a live cache hit rate needs a provider that reports one |
| [026](026-glasses/spec.md) | The glasses: the same backbone, a second surface — WebMCP and the Meta AI connector shapes for the studio's tool catalog ([plan](026-glasses/plan.md), [tasks](026-glasses/tasks.md)) | In progress — the WebMCP and connector renderings and the toolkit's `--format` flags are done; the web app, the origin allowance and the real-glasses run remain |
| [028](028-integration-health/spec.md) | Integration health: one derived state per location and per provider, and a single warning component with a severity and a safe action ([plan](028-integration-health/plan.md), [tasks](028-integration-health/tasks.md)) | Planned — the pure derivations, the notice component and the placeholder-save block are specified; nothing is built yet |

Spec numbers 004–008 were reserved in the foundation roadmap and are now requirements inside
[002](002-studio-v1/spec.md) rather than separate specs, because the white-room specification covers
them as one product. Numbers are not reused.

The browser build is 010 on purpose: it depends on the core/port split in ADR 0009, which is a refactor
of 001, and on the storage-tier requirements added to 002 as FR-071…FR-076. Specs 011–013 are the
hackathon delivery track: model access, the verification suite and the two build targets. They refine
002 rather than replace it; where they disagree, the newer spec wins and 002 is amended. The agent harness runtimes
(`@ai-sdk/harness`) are deferred in ADR 0007 rather than given a spec number; no work is planned until a
local sandbox and a stable API exist.

Agent coverage is audited in [`docs/AGENTIC-COVERAGE.md`](../docs/AGENTIC-COVERAGE.md): 002 and 011
cover a v1 writing assistant, not the full agentic suite. The audit lists the implemented requirements,
the specified-but-missing ones and the behaviour no spec has decided. The harness and interface phases are in the specification set.

## Status vocabulary

- **Planned** — spec exists, not started.
- **In progress** — tasks being executed; `tasks.md` shows what remains.
- **Implemented** — tasks complete, tests pass, changelog updated.
- **Superseded** — replaced by another spec; keep the file, link the replacement.

## Retroactive specs

`001-foundation` was written after the code, to give the repository a complete record from its first
commit. It is held to the same standard as any other spec: requirements, acceptance criteria,
non-goals, and tasks that actually correspond to the code.

## Beyond the event

The Meta hackathon has a fixed scope, and four capabilities with real demand are deliberately
outside it. They are listed here so the gap is recorded rather than discovered: the design work
is not part of this repository yet.

| Capability | Why it is not here | What exists today |
| --- | --- | --- |
| **Import wizard** — DOCX, DOC, TXT, RTF, ODT with a detected-chapter preview, a cancellable job and Story Bible enrichment | The event demo starts from a book that is already in the library | The legacy importer (003) and a DOCX export |
| **Review engine** — deterministic prose metrics plus opt-in model critique, reader personas, series analysis | A report surface is a product of its own, and a half-built one would be worse than none | Word counts, the agent's chat answers, and the checkpoints that make a critique reversible |
| **Formatting and KDP export** — trim sizes, templates, front and back matter, EPUB and print PDF, device previews | Spec 007 folded this into 002 before the event; only the Word export was built | `002` for the manuscript path, `019` for illustrations in the Word file |
| **Task-aware model routing** — choose a model per task from cost, context and capability, with a recorded decision | The event needs one honest, overrideable book default (D-116 remains open) | The provider registry, the per-turn override and the usage record |

Spec 007's row above still says it was folded into 002. That is true of the *intent* and not of the
*implementation*: the manuscript export is DOCX only. Anyone reading the index should treat EPUB and
print PDF as unbuilt rather than as a regression.

