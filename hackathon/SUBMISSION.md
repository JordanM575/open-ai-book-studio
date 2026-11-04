# Hackathon submission packet

**Event:** Meta Global AI Developer Hackathon, October 26 – November 4, 2026
**Track:** Indie Developer
**Theme:** Build for Your World
**Entrant:** Jordan McLaughlin (solo)
**Deadline:** November 4, 2026, 9:00 PM ET

> Fill the bracketed fields after the repository and film links exist. Do not submit a placeholder.

## Form fields

| Field | Value |
| --- | --- |
| Project name | **AI Book Studio** |
| Track | **Indie Developer** |
| Theme | **Build for Your World** |
| Representative | Jordan McLaughlin |
| Team | Solo |
| Repository | `<public repository URL>` |
| Demo video | `<3:00 master URL>` |
| Short video | `<0:30 cut URL>` |
| Sample library | `samples/the-salt-road` in the repository |
| Licence | Apache-2.0 (code); sample text/images CC0 |

## What it is

AI Book Studio is a local-first writing studio for long-form fiction. The book is a folder of Markdown
and JSON the author owns; the agent reads the Story Bible and chapters, edits through tools, makes
checked saves with undo checkpoints, can keep working after the window closes, and returns a native
notification. Illustrations are generated with Muse Image and carried into the Word export. The same
library is available to other agents through the `bookwriter` CLI and MCP server, over a
loopback-only backend with a per-run token.

**One line:** the agent works on the actual book, and the author keeps the actual files.

## What existed before the event

The local-first library format, manuscript editor, atomic saves, conflict copies, Story Bible, provider
connections, the first writing-agent loop, Word export, legacy import, browser storage, sync detector
and the desktop/web test foundation existed on `015-web-target` at the October 26 cut
(`meta-base-2026-10-26`, `bb9af11`).

## What was built during the event

- Muse Voice Transcribe dictation with WAV conversion and caret insertion (spec 017).
- Background agent turns, native notifications, dock badge and approval-pause handling (spec 017).
- `bookwriter` CLI, MCP server and the loopback backend with per-run token (spec 018).
- Image storage (`images.json`), Muse Image generation, illustration UI and DOCX embedding (spec 019).
- ~~SAM 3.1 cutouts~~ — built, then retired (D-158). The request reaches Meta and is accepted, but
  returns no records and no usage on real and synthetic images alike, so nothing is built on it and
  this packet does not claim a cutout.
- Product film plan, timed script, storyboard, deterministic fixture and motion plates (spec 021).
- Provider compatibility seam, Muse Spark 1.3 Contributor presets and book-level training consent
  (spec 022).
- The sample library, submission packet and readiness check (spec 023).
- The studio's own writing tools served over the loopback backend and mirrored in the MCP server, so
  a third-party agent gets the built-in agent's verbs (spec 024).
- The agent's own capabilities: a cacheable prompt prefix with its hit rate, per-tool call and success
  metrics, a per-book switch that withdraws a tool from the model, the backend and the MCP server
  alike, an optional `SKILLS.md` that gives the agent the author's own house rules, and a folder of
  TypeScript plugins the author points the app at (spec 025).
- The ambient agent and the minimal mode: a status the studio keeps whether or not anyone is looking
  — where the author is, what changed, what it would do next — spoken through the voice pipeline and
  rendered on three surfaces from one pure contract: the desktop strip, the 600×600 glasses page, and
  the browser build.
- The voice pipeline (D-159): listening through Muse Voice Transcribe, speaking through a
  text-to-speech seam, with OpenRouter's free TTS model behind it so a check that runs on every
  change costs nothing.
- A bridge from the studio to a phone on the local network, which is the Mac half of the glasses app,
  proven from a separate process.
- The sync drift review over the existing detector: a scan when the library opens and when the window
  regains focus, a review dialog with keep-disk, keep-mine, open-both and export actions, and a
  Settings section (spec 016, in progress).
- Integration health: one derived state for each library location and each provider, with
  plain-language warnings and safe actions (spec 028, in progress).
- Manuscript import: plain text, Markdown and Word documents into a new book, through a preview and
  a staged atomic publication. Word documents get heading chapters and a report of what could not
  come across (spec 029, D-183; Word on macOS).
- Manuscript review: an evidence-linked report on saved text (spec 034, desktop, in progress).
- Book formatting: a target selector, typography settings, an approximate preview, and a Markdown
  export beside the Word export (spec 035 and 002 FR-051; PDF and EPUB are not built).
- Agent and provider reporting:
  - the answering model named in plain words, and capabilities on each model card;
  - the whole-turn usage line;
  - offline and rate-limit notes;
  - checkpoints for a failed turn;
  - per-turn and monthly spending warnings;
  - tone and answer-length settings (specs 011 and 031).
- Verification added during the event (spec 012), on top of the existing tests and desktop smoke:
  - one `verify` gate covering lint, typecheck, tests, the quarantine and waiver ledgers and both
    builds;
  - component tests;
  - the coverage ratchet;
  - the accessibility and visual gates;
  - end-to-end checks of the `bookwriter` CLI and MCP server against the running app, and of
    writing, importing and exporting with every outbound connection denied by the operating system.
- Open-source licenses generated from the build: Settings → About lists every package each build
  ships with its license text, `THIRD_PARTY_NOTICES.md` is generated from the same data, and the
  readiness check fails on a package with no license or an unknown one (D-186).

The commit history after the cut tag is the complete record of event work.

The event branch is `meta-hackathon`; the cut tag is `meta-base-2026-10-26`. The Gitea history is
canonical. The GitHub clean replay is a separate publication step and must not be used to hide
pre-event work.

## Meta models and partners

| Need | Surface |
| --- | --- |
| Planning, drafting, revision | Muse Spark 1.3 through the author's own Meta connection (Meta Model API) |
| Cheap agent testing | Muse Spark 1.3 Contributor, only on the synthetic fixture and only with book consent |
| Illustration | Muse Image 1.0 |
| Dictation and captions | Muse Voice Transcribe 1.0 |
| Spoken replies in the hands-free strip | OpenRouter's text-to-speech model (a partner service, not a Meta model) |

SAM 3.1 is not used: its request returned no records (D-158), so the studio ships no cutout feature.

Contributor mode may train on prompts and outputs. The app defaults it off and refuses a contributor
turn until the book opts in; the sample and film fixture are the only intended Contributor data.

## Verification evidence

Fill every bracketed result from the final clean clone of the submitted commit. Do not submit a
placeholder.

| Check | Command | Result at submission |
| --- | --- | --- |
| Verify | `bun run verify` | `<lint, typecheck, tests, ledgers, desktop and web builds>` |
| Toolkit | `bun run toolkit:build` | `<result>` |
| Smoke | `bun run smoke` | `<n/n>` |
| End to end | `bun run e2e` | `<n/n>` |
| UI audit | `bun run ui:audit` | `<result>` |
| Accessibility | `bun run a11y` | `<result>` |
| Visual | `bun run visual` | `<n/n baselines>` |
| Coverage | `bun run coverage` | `<functions / lines, against the floor>` |
| Submission check | `bun run submission:check` | `<ready · commits · tracked files>` |
| Clean clone | `bun install && bun run verify && bun run e2e && bun run coverage` | `<commit, packages, results>` |

**Latest re-check (2026-11-04, commit `9babe12`):**

| Check | Result |
| --- | --- |
| `bun run verify` | Pass: 1,567 tests, 0 failures; lint, typecheck, the quarantine and waiver ledgers, and both builds |
| Smoke | 34/34 |
| e2e | 10/10 |
| `ui:audit` | Pass |
| Accessibility | No critical or serious findings, and focus order held |
| Visual | 112/112 baselines |
| Coverage | 90.70% of functions and 93.27% of lines over the repository's own files, above the 85/92 floor, which is unchanged |

An earlier clean-clone pass on 2026-10-26 (`8a42620`, 568 tests) is superseded by the event commits.

## Demo runbook

This runbook follows the film. Step 1 is context from before the event; every later step shows event
work.

1. **Built before the event.** Open `samples/the-salt-road` in the desktop app with a throwaway
   profile, and show the book's folder in Finder.
2. Choose **Muse Spark 1.3 Contributor**. The picker warns that it may train on what you send and
   refuses until the book opts in. Opt the sample in, ask for the next scene, and the conversation
   names the model that answered.
3. Open **Agent** (the bot icon in the header) to show calls and successes per tool. Turn a tool off,
   and show `bookwriter call` refusing it.
4. Dictate a sentence; the transcript lands at the caret.
5. In the strip at the bottom of the workspace, press **Say where you are**, then ask a question out
   loud. The reply is spoken with OpenRouter's voice.
6. Tick Background, close the window, show the notification, then reopen on the stored conversation.
7. Illustrate a chapter with Muse Image (**Generate · $0.01**) and attach the image. Export the Word
   document, and show the illustration in it.
8. Run `bookwriter books`, `bookwriter tools` and `bookwriter read` against the same open book, then
   start `bookwriter mcp`.
9. Optional:
   - With Wi-Fi off, show the plain offline note.
   - Show the 600×600 glasses page at its real size, labelled as not run on glasses.
10. Close on the book folder (`images/` and `images.json`) and the tagline.

**Offline fallback:** open the sample, edit and save a chapter, and play the recorded film for model
features. Never fake a provider response or a save.

## Judge rubric map

| Criterion | Evidence |
| --- | --- |
| Impact (30%) | An author's own book, worked on by Meta models, by voice, in the background and by other agents, while the files stay the author's. The sample opens without an account. |
| Meta AI tooling (25%) | Muse Spark 1.3 with its Contributor consent guard, Muse Image and Muse Voice Transcribe, each behind a capability and consent boundary. |
| Technical depth (20%) | Provider adapter seam, loopback toolkit token, per-book tool control across the model, the CLI and MCP, per-tool metrics, a cacheable prompt prefix that measures its hit rate when the provider reports one, a plugin seam, and the verification gates. |
| Demo (25%) | One continuous story from prompt to illustration to a file in Finder; the film and live demo show the app, not a mock. |

## Links and final checklist

- [ ] Repository public and links checked in a private window.
- [ ] `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` present.
- [ ] No secret, `.env`, credential file or real library in the tree or history.
- [ ] Sample opens; two chapters, the Story Bible and the illustration present.
- [ ] Film: the opening is labelled “Built before the event” and every later segment shows event work.
- [ ] Film master, 0:30 cut, 0:15 vertical and SRT uploaded; links work privately.
- [ ] `bun run submission:check` passes.
- [ ] Clean clone passes install, verify and smoke.
- [ ] Form submitted before November 4, 9:00 PM ET; confirmation saved.
