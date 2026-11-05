# AI Book Studio — hackathon submission packet

**Event:** Meta Global AI Developer Hackathon, October 26 – November 4, 2026

**Track:** Indie Developer · **Theme:** Build for Your World

**Entrant:** Jordan McLaughlin (solo)
**Deadline:** November 4, 2026, 9:00 PM ET

This is the source packet for the submission form. A public repository exists; film upload and
form submission are separate steps. Unchecked items below are still outstanding.

## Submission links

| Field | Value |
| --- | --- |
| Project | **AI Book Studio** |
| Repository | https://github.com/JordanM575/open-ai-book-studio |
| Demo video | Not uploaded yet |
| 30-second film | Not uploaded yet |
| Runnable sample | `samples/the-salt-road` |
| License | Apache-2.0 for code; see the sample's own attribution for its text and images |

## The idea

**The agent works on the actual book, and the author keeps the actual files.**

An author needs more than a chat that produces a page of prose. A book has chapters, a cast, an
outline, continuity, drafts to import, revisions to inspect, and a manuscript to take away. Moving
all of that between a word processor and disconnected chat sessions loses context and creates
copy-and-paste work.

AI Book Studio brings that workflow into a local-first writing workspace. Each book is a folder
of Markdown and JSON, rather than a record locked inside a hosted service. The Story Bible holds
the premise, outline, characters and memories. The writing agent can read that context, create
chapters and revise the manuscript through the same checked storage layer the editor uses.

The author can work manually, use the full agent conversation, or use the compact ambient strip.
Word import, formatting and exports connect the studio to an existing writing practice. The
`bookwriter` CLI and MCP server let other tools work with the same local library through an
authenticated loopback interface.

## Where the project came from

### A fresh implementation of an earlier idea

The author previously had a cloud/web writing prototype. The product idea, design work and
specifications predated this hackathon. The author describes the current studio as a from-scratch
rewrite begun around the hackathon kickoff, using specification-driven development with Spec Kit.
This is the local-first implementation of that idea, rather than a claim that the idea or designs
were invented during the event. The repository's architecture records the earlier prototype as
Next.js/localStorage with a single JSON blob; the current studio uses file-based storage and
separate desktop and browser adapters.

### The dated baseline is still disclosed

Rewrite provenance and event eligibility are different questions. The public tag
[`meta-base-2026-10-26`](https://github.com/JordanM575/open-ai-book-studio/tree/meta-base-2026-10-26)
preserves the implementation already present at the recorded cut. Its original source commit is
dated October 26 at 09:25 ET, before the documented noon event start. It already contains the
library format, editor, atomic saves, conflict copies, Story Bible, provider connections, first
writing-agent loop, Word export, earlier-studio import, browser storage, sync detector and test
foundation. Those capabilities are disclosed as baseline work even though they belong to the
rewrite. We do not describe every line in this repository as event-only code.

The public history starts with a labelled baseline snapshot and then replays the retained event
commits in order. Private planning-only material is excluded. That public history is the reviewable
record; a fresh rewrite does not erase the baseline or change commit dates. The event additions
below should be evaluated separately from the earlier product concept, design assets and baseline.

## How specification-driven development shaped the build

Spec Kit organizes each capability into a specification, technical plan and task list under
`specs/`. The process used here is:

1. **Specify the author's experience.** Define the problem, acceptance criteria, refusal states and
   what happens to a manuscript when an operation fails.
2. **Record decisions.** Architecture decisions and open questions live in `docs/adr/` and
   `docs/DECISIONS.md`; an unfinished decision is not treated as a shipped capability.
3. **Plan and implement a bounded slice.** Shared behavior goes into the core or shared UI; platform
   services stay behind their adapters. Only the desktop main process writes local manuscript files.
4. **Verify the contract.** Storage and agent tests exercise conflicts, approvals, failed writes and
   recovery; hidden-app checks exercise the real preload bridge, renderer and disk saves.
5. **Record what is proven.** The changelog, requirement mapping and test evidence distinguish
   implementation, automated verification and live-provider demonstrations.

See [`specs/README.md`](../specs/README.md), [`docs/FORMAT.md`](../docs/FORMAT.md),
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and
[`docs/DECISIONS.md`](../docs/DECISIONS.md). A spec or unchecked task describes intent, not proof
that a feature works. Existing design tokens and third-party UI components are credited separately
from application code.

## What the event work adds

| Author need | Implementation added or extended | Evidence entry point |
| --- | --- | --- |
| Work directly with Meta models | Provider compatibility, model capabilities and Contributor-consent handling | Specs 011, 022; provider and agent tests |
| Speak a draft or request | Muse Voice Transcribe, audio conversion and insertion; compact voice workflow | Spec 017; `docs/VOICE.md` |
| Keep writing while a turn finishes | Background execution, approval pauses, notifications and reopening the right conversation | Spec 017; background/reopen tests |
| Bring an existing manuscript | TXT, Markdown and macOS DOCX import, preview, heading-based chapters and loss report | Spec 029; manuscript-import tests |
| Illustrate and take the work away | Muse Image, stored illustrations and Word embedding; local formatting and Markdown/PDF/EPUB export | Specs 019, 035; export tests |
| Use another writing agent | `bookwriter` CLI/MCP and authenticated loopback backend | Specs 018, 024; toolkit e2e |
| Control the agent's tools | Per-book tool controls, house rules, metrics, plugin seam, approvals and turn undo | Spec 025; ADR 0014 |
| Understand what happened | Named answering model, whole-turn usage, spending warnings, offline/rate-limit messages, tone and length settings | Specs 011, 031 |
| Review local changes | Sync-drift review and evidence-linked manuscript review; both remain scoped, in-progress features | Specs 016, 034 |
| Trust the implementation | Verification command, coverage floor, accessibility/visual checks, license inventory, offline e2e and single-profile enforcement | Spec 012; D-184, D-186 |

The shared interface uses shadcn/ui and AI Elements patterns themed with the existing Liquid Glass
tokens (D-185). Full chat and the ambient strip are distinct surfaces; they are not evidence of an
implemented Discuss/Edit mode selector.

## How Meta is used

| Task | Model/service | Boundary |
| --- | --- | --- |
| Planning, drafting and revision | Muse Spark 1.3 via the direct Meta Model API | The selected provider/model is recorded with the turn; tools write the manuscript |
| Optional Contributor testing | Muse Spark 1.3 Contributor | Requires explicit book-level consent; prompts and outputs may be used for training |
| Illustration | Muse Image 1.0 | Generation is a separate author action; a sample illustration is not proof of a live generation |
| Speech recognition | Muse Voice Transcribe 1.0 | Transcription is distinct from writing and from speech synthesis |
| Spoken replies | TTS provider seam / device voice | Not presented as Meta text-to-speech |

The current successful film capture uses standard **Muse Spark 1.3**, not Contributor. A future
Muse Wonder demonstration must select and actually run that model; changing an on-screen label
does not establish a Wonder response.

SAM 3.1 cutouts were explored and retired (D-158) after accepted requests returned no usable records.
The shipped build does not claim that feature. Meta open weights are not used in this demonstration.

## The author journey shown in the demo

The central story is **The Cartographer's Tide**: a coastal mapmaker finds a vanished street and a
letter from her missing brother. The demo follows work on the manuscript, rather than a sequence
of unrelated settings screens:

1. Connect to Meta with a masked key and choose the writing model on desktop.
2. Give the story a premise and outline, then submit the opening prompt.
3. Inspect the model's saved chapter, request a continuation and compare the result.
4. Make an ordinary author edit and confirm it reaches the manuscript on disk.
5. Browse the library and export the manuscript.
6. Show Word import, formatting, the full chat/ambient strip and voice only with matching evidence
   for the exact operation shown.

The successful November 4 capture records four drafts and one revision using Muse Spark 1.3,
an author edit and a Markdown export. It was an isolated Electron run with a disposable library
and capture-only in-memory credentials; it does not demonstrate keychain persistence. The source
is timestamped screenshot sampling, not an uninterrupted high-frame-rate screen recording.

Additional authored stories and the five-book browsing library are sample/fixture content, not
additional in-product Meta turns. Fixture planning conversations must remain labelled as fixtures.
Blender books and device shells are presentation assets. Phone/tablet-sized Electron or web views
are responsive layouts, not proof of native iOS execution or automatic cross-device synchronization.

## Verification and limits

Record results against the **exact public commit** used for submission. Results from another
checkout, an earlier commit or a draft film are not interchangeable.

| Check | Reproduction command | Submission status |
| --- | --- | --- |
| Lint, types, tests, ledgers and desktop/web builds | `bun run verify` | Final public-head result to record |
| Real hidden desktop workflow | `bun run smoke` | Final public-head result to record |
| Toolkit and offline workflows | `bun run e2e` | Final public-head result to record |
| Accessibility and UI checks | `bun run ui:audit` / `bun run a11y` / `bun run visual` | Final public-head result to record |
| Coverage and performance | `bun run coverage` / `bun run perf` | Record measured results without changing floors/baselines |
| Submission artifacts and licenses | `bun run submission:check` | Final public-head result to record |
| Live Meta | Prompt, model identity, tool result and saved manuscript | Successful November 4 capture exists; retain evidence with final film |

Important boundaries:

- Checked saves and conflict copies reduce lost-work risk; they are not universal compare-and-swap
  protection against every external writer or a guarantee against every crash.
- Formatting previews are approximate. PDF/EPUB/DOCX export is not Amazon KDP acceptance,
  EPUBCheck certification or PDF/UA validation.
- Native device execution, glasses hardware, mobile agent execution and automatic handoff are not
  established by responsive screenshots. The 600×600 glasses surface is a software view.
- A historical synthetic-audio transcription check is not a fresh human-microphone test.
- Source builds and passing tests do not establish a signed/notarized installer or a published release.
- The current film cuts are drafts. Temporary synthetic narration is identified as such and still
  needs the author's final narration/approval under the production plan.

## Why this fits Build for Your World

The intended user is an author who wants assistance without giving up ownership of the manuscript.
The practical result is editable, inspectable book files. Meta supplies language, image and speech
capabilities; the studio supplies the context, editing tools and storage boundaries that make those
capabilities useful in an actual writing workflow.

Technical depth comes from checked file writes, tool approvals and undo, platform adapters,
provider reporting, and a shared local interface for the built-in agent and external tools. The
demonstration should make those benefits visible through a story being written and revised.

## Final checklist

- [x] Public repository URL exists.
- [ ] Exact submission commit recorded; its clean-clone checks attached.
- [ ] Baseline, earlier idea/designs, third-party assets and event additions disclosed accurately.
- [ ] Final film reviewed for privacy, captions, model identity and responsive/fixture labels.
- [ ] Final narration and music approved; music credit/license evidence retained.
- [ ] Final video links uploaded and checked without authentication.
- [ ] `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` and sample attribution checked at submission head.
- [ ] No credentials, private libraries or internal planning material in submitted tree/history.
- [ ] Official portal requirements checked; form submitted and confirmation retained.
