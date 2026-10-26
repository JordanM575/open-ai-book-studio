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
notification. Illustrations are generated with Muse Image and characters are cut out with SAM 3.1.
The same library is available to other agents through the `bookwriter` CLI and MCP server, over a
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

The event branch is `meta-hackathon`; the cut tag is `meta-base-2026-10-26`. The Gitea history is
canonical. The GitHub clean replay is a separate publication step and must not be used to hide
pre-event work.

## Meta models and partners

| Need | Surface |
| --- | --- |
| Planning, drafting, revision | Muse Spark 1.3 / Muse Wonder via Meta Model API |
| Cheap agent testing | Muse Spark 1.3 Contributor, only on the synthetic fixture and only with book consent |
| Illustration | Muse Image 1.0 |
| Character cutout | SAM 3.1 |
| Dictation and captions | Muse Voice Transcribe 1.0 |
| Open-weight fallback | Muse Spark Open / Muse Glimmer through Baseten, Modal or Fireworks, if used |

Contributor mode may train on prompts and outputs. The app defaults it off and refuses a contributor
turn until the book opts in; the sample and film fixture are the only intended Contributor data.

## Verification evidence

| Check | Command | Result at submission |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | Pass (desktop, web, toolkit) |
| Tests | `bun test` | **567 pass, 0 fail** |
| Desktop build | `bun run build` | Pass |
| Web build | `bun run build:web` | Pass |
| Toolkit | `bun run toolkit:build` | Pass, 15 KB `bookwriter` binary |
| Smoke | `bun run smoke` | **18/18** |
| End to end | `bun run e2e` | **7/7** — app, web, audit, glasses, ambient, plugins, bridge |
| UI audit | `bun run ui:audit` | **no dead ends**; every control named, every image with an `alt`, one `h1`, keyboard focus visible |
| Coverage | `bun run coverage` | **81.4% functions, 88.3% lines**, floor 80/87 |
| Plugin probe | `bun run plugin:probe` | **ok** — the plugin's tool listed, run, and a broken plugin left the others working |
| Submission check | `bun run submission:check` | **ready** · 143 commits · 515 tracked files |
| Clean clone | `bun install && bun run verify && bun run smoke` | **Pass** · 487 packages · verify pass · smoke 16/16 |

**Code verified at:** `dfc54f9` on 2026-10-26, cloned fresh from Gitea at the pushed branch head.
The clean clone installed 487 packages, `bun run verify` passed the typecheck, 475 tests, the
desktop and web builds, `bun run smoke` passed 16/16 and `bun run plugin:probe` passed. The only
commit after it is this documentation, so the app code did not change after the clean-clone pass.
**Clean-clone path:** a fresh temporary directory
(temporary; deleted after evidence was recorded).

## Demo runbook

1. Open `samples/the-salt-road` in the desktop app with a throwaway profile.
2. Show the library and the Finder folder: `book.json`, chapters, `images.json`.
3. Open the Story Bible: outline, cast, memory.
4. Ask the agent for the next scene; show tool calls, the checked save and the undo checkpoint.
5. Open **Agent** (the bot icon in the header): the tool metrics, the cache hit rate, the switch that
   withdraws a tool, and the plugin folder. Turn a tool off and show the toolkit refusing it.
6. Dictate a sentence; show the transcript at the caret.
7. Tick Background, close the window, show the notification, reopen and show the stored thread.
8. Open the illustration: generate with Muse Image, then cut out Mara with SAM 3.1 and attach her.
9. Run `bookwriter books` and show the MCP tool list against the same open book.
10. Export DOCX and show the illustration; close on the folder and the tagline.

**Offline fallback:** open the sample, edit and save a chapter, and play the recorded film for model
features. Never fake a provider response or a save.

## Judge rubric map

| Criterion | Evidence |
| --- | --- |
| Impact (30%) | A real author workflow: files, chapters, Story Bible, agent edits, export. The sample opens without an account. |
| Meta AI tooling (25%) | Muse text, Muse Image, SAM 3.1, Muse Voice Transcribe and Contributor mode, each behind a capability and consent boundary. |
| Technical depth (20%) | Atomic library writes, conflict copies, checkpoints, provider adapter seam, loopback toolkit token, a cacheable prompt prefix with its hit rate, per-tool metrics, a plugin seam, tests and smoke. |
| Demo (25%) | One continuous story from prompt to illustration to a file in Finder; the film and live demo show the app, not a mock. |

## Links and final checklist

- [ ] Repository public and links checked in a private window.
- [ ] `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` present.
- [ ] No secret, `.env`, credential file or real library in the tree or history.
- [ ] Sample opens; two chapters, Story Bible, illustration and cutout present.
- [ ] Film master, 0:30 cut, 0:15 vertical and SRT uploaded; links work privately.
- [ ] `bun run submission:check` passes.
- [ ] Clean clone passes install, verify and smoke.
- [ ] Form submitted before November 4, 9:00 PM ET; confirmation saved.
