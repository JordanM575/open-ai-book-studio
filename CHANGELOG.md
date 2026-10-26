# Changelog

All notable changes to AI Book Studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Update the `Unreleased` section before every commit.

## [Unreleased]

### Changed

- Archived the inherited repository (private, read-only) instead of forking its history. This repository
  starts from a clean initial commit and contains none of its fixtures, exports or branding.
- Moved to Bun workspaces: `apps/desktop` holds the Electron app and `packages/core` holds the schemas,
  the IPC contract and the Markdown format, imported by both sides as `@ai-book-studio/core/*`. Root
  scripts delegate with `bun --filter`; `bun.lock` replaces `pnpm-lock.yaml`.
- Migrated the library tests from Vitest to `bun:test` with the same 13 cases and assertions, and removed
  the Vitest configuration and dependency.
- Repointed the token generator, the smoke runner and the packaging configuration at the workspace
  layout. The smoke runner resolves Electron from the desktop workspace.
- Scrubbed the inherited product's name and design-kit paths from the docs, the changelog and the
  vendored tokens. The one remaining reference is the legacy export's wire marker
  `moms-ai-book-studio`, which the port must recognise; it is documented as a format constant, not as
  the product name. The type specimen in `tokens.json` no longer uses a personal book title.
- The book's `settings` now carry the agent's own settings, and every setting is defaulted on the
  *input*, so a book written before a setting existed still opens. The committed sample library
  proves it, and a test guards it.
- The usage log now records whether the provider reported its cache at all, so a measured cache of
  zero is never shown as a provider that measures no cache.

### Added

- Added the studio's tool catalog in Meta's two interchange shapes (spec 026): a WebMCP tool list,
  which a page on Meta's Ray-Ban Display glasses registers so the wearer can ask for it by voice,
  and a Meta AI connector manifest, with every tool classified Read or Write and the destructive
  ones marked sensitive. `bookwriter tools --format webmcp` and `--format connector` produce them
  from a live studio. The studio's own tier was already the classification Meta asks for, so this
  is a renaming rather than a translation.
- Added a minimal mode to the workspace: a strip that knows where you are in the book, says it
  out loud when you ask, offers to read the prose, and takes a sentence when you have something to
  say. The speech is the browser's own, through the system voices, so it needs no voice service,
  and every word it says is also on the screen.
- Added the agent's own capabilities (spec 025): a cacheable prompt prefix where the provider
  supports one, with the hit rate, the cached and fresh token counts and the turns that hit it
  shown per book, and a switch to turn the prefix off; per-tool call, success and failure counts; a
  switch per built-in tool, per book, that withdraws the tool from the model, the backend and the
  MCP server alike; an optional `SKILLS.md` in the book folder, given to the agent as the author's
  own instructions; and a plugin folder of TypeScript tools the author points the app at.
  Documented in [`docs/AGENT-CAPABILITIES.md`](docs/AGENT-CAPABILITIES.md), and proved in the built
  app by `bun run plugin:probe`.
- A plugin's arguments are a JSON Schema, or a Zod schema when the plugin's own folder can resolve
  it: a plugin folder usually sits outside the app, where the app's packages cannot be resolved, so
  a plugin that needed an import would simply fail to load.
- Recorded the toolkit manual pass in `docs/research/toolkit-2026-10-26.md`: the compiled
  `bookwriter` binary and a separate MCP client process against a real backend over a real library,
  with every change read back from the file.
- Recorded the glasses assessment in `docs/research/glasses-2026-10-26.md`: Meta's three surfaces
  for the Ray-Ban Display, the Web App's documented constraints, the one constraint that decides
  the design, and the live check that rendered the studio's 22 tools into both the WebMCP and the
  connector shapes.
- Made the ambient status say the truth about `working`. It was always `false`, so the minimal
  mode never offered Stop, and a phone would have shown a Stop it could not honour. The status now
  asks the runtime, and the control plane and the bridge both grew `POST /v1/books/:bookId/stop`.
- Fixed the minimal mode in the browser build. It showed an error on every book because the ambient
  status was a desktop-only stub, but the status is a pure function over the book, so this build now
  computes it from the library it already has. The web smoke proves the line and the six actions.
- Added undo to the control plane and the bridge, and `bookwriter undo`. The ambient status offers
  the action whenever a checkpoint exists, so a client that shows the status must be able to perform
  it; a route that offers an action it cannot do is a dead end in a pair of glasses. The bridge probe
  and the ambient check both drive the refusal that says there is nothing to undo.
- Added one end-to-end gate, `bun run e2e`, which builds the app, the web build and the toolkit and
  then runs seven checks against them: the built app through its own renderer, the browser build over
  its own storage, the real window for dead ends, the 600×600 glasses page, the ambient agent and the
  toolkit, a folder of plugins, and the phone's bridge **from a separate process**. Documented in
  [`docs/TESTING.md`](docs/TESTING.md).
- Added an accessibility pass to the UI audit: every control has an accessible name, is at least
  20 px to hit, every image has an `alt`, the view has exactly one `h1`, and one Tab reaches a control
  with a visible focus ring. The app passes all of them (33 controls).
- Added a real Word-export check to the smoke run, which needed a way to export without a save
  dialog: `STUDIO_EXPORT_PATH` names a folder for a headless run. The check unzips the file it
  produced and looks for the text and the picture, because the thing that goes wrong is never the
  writer's opinion of what it wrote. The fixture now carries an illustration.
- Added the voice pipeline (spec D-159): a text-to-speech seam in `packages/core/src/providers/tts.ts`
  with two services behind it, both using OpenAI's `audio/speech` shape — OpenAI directly for the
  studio's voice, and OpenRouter, whose free `fish-audio/s2.1-pro-free:free` makes a check that runs
  on every change cost nothing. OpenRouter has fifteen dedicated TTS models, discoverable with
  `GET /api/v1/models?output_modalities=speech`; they are listed under `"speech"`, not `"audio"`,
  which is easy to miss. A provider that answers with raw `audio/pcm` is wrapped in a WAV. A chapter
  is longer than one request, so the text is split at sentence boundaries and the audio is joined
  back into one sound. The minimal mode speaks through it, offers the voices, and falls back to the
  device's own voice when no service is connected. Documented in [`docs/VOICE.md`](docs/VOICE.md).
- Retired the SAM cutout (D-158): the request reaches Meta and is accepted, but returns no records
  and no usage on real and synthetic images alike, so nothing is built on it and spec 020 is marked
  superseded. The implementation and its tests stay where they are.
- Recorded the live Meta pass in `docs/research/live-meta-2026-10-26.md`: the model catalogue, a real
  writing turn with a Contributor model on a temporary copy of the sample (the pass condition was that
  the file on disk changed), dictation scored against a spoken phrase (all nine words), and a live
  Muse Image. SAM 3.1 answers `200 completed` with no records and no usage on every image and prompt
  tried, so it is recorded as blocked on the model's availability rather than on the studio.
- The check scripts now clear `NODE_OPTIONS` and the `HEADROOM_*` variables before spawning the app.
  A coding agent's shell can install a `fetch` shim that routes requests through a proxy that
  authorises only the agent, and an app that inherits it sees `{"error":"unauthorized"}` from every
  provider — an error indistinguishable from a bad key. The checks must measure the product, not the
  agent's proxy.
- Added the ambient agent: a status the studio keeps whether or not anyone is looking, and two
  ways to reach it. `GET /v1/books/:bookId/ambient` says where the author is, what changed last
  and what can be said or done; `POST /v1/books/:bookId/turn` runs a turn and waits for the
  answer, through the same runtime the app uses. The toolkit gained `bookwriter where` and
  `bookwriter ask`. The glasses' phone app needs exactly these two routes.
- Added the glasses page (spec 026): a 600×600 interface for Meta Ray-Ban Display glasses, served
  by the studio itself so it is the same origin as the API. It is dark because the display is an
  additive waveguide, it never scrolls because there is no scrollbar the wearer can see, it moves
  focus with the D-pad, it speaks through `speechSynthesis` while keeping the text visible, it
  registers the studio's own read tools with the browser's model context so an assistant on the
  glasses can call them by voice, it asks the wearer before every write, and it says plainly when
  the device cannot do something. `bun run glasses:check` drives it in a real browser at 600×600
  against the real studio: twelve checks, no dead ends.
- Recorded the plugin manual pass in `docs/research/plugins-2026-10-26.md`: the built app pointed at
  a folder of TypeScript plugins, the plugin's tool listed in the backend's catalog, the tool run
  against the open book, and a plugin that cannot resolve its imports left the others working.
  `bun run plugin:probe` repeats it.
- Added the studio's own writing tools to the loopback backend and the MCP server (spec 024): the
  backend serves `GET /v1/tools` and `POST /v1/books/:bookId/tools/:tool`, and `bookwriter mcp`
  mirrors the built-in agent's tools with a `bookId` argument, so a third-party agent gets the same
  verbs. Read tools are always available, write tools need `--allow-writes` and destructive tools
  need `--allow-destructive` on both the client and the request.
- Added `bookwriter tools` and `bookwriter call`, so a script can run one studio tool against the
  open book.
- Fixed two dead ends in the interface: the model picker without a connection pointed at a
  "Connections window" that does not exist and offered no way to add a key, and a failed turn in the
  writing agent offered only "Retry request", stranding the author's prompt when no model was
  chosen. Both now offer the action that resolves them.
- Added `bun run ui:audit`, which drives the real app through the main flows and reports any dead
  end, missing control or console error it finds.
- Added the submission package (spec 023): a committed original sample library at
  `samples/the-salt-road`, `hackathon/SUBMISSION.md` with the form fields, event-built disclosure, model
  list, demo runbook and judge map, and `bun run submission:check` for branch/tree, required files,
  forbidden paths, secret patterns and sample integrity.
- Added the film motion plates (spec 021 T007): eight HTML/CSS scenes using the studio tokens, a
  deterministic `window.renderAt(ms)` timeline, and a Playwright renderer for 1920×1080 preview stills or
  30 fps PNG sequences. Previews checked for problem, files, trust, background, visuals, voice, interop
  and close.
- Added a credential-vault health check and macOS runbook: `connections:status`, a non-secret
  `safeStorage` encrypt/decrypt probe, a **Check keychain** action in Settings, `STUDIO_VISIBLE=1` for a
  visible throwaway profile, and [`docs/KEYCHAIN.md`](docs/KEYCHAIN.md) covering unlock, locked-state
  testing, recovery and the legacy-keychain limits.
- Added the provider compatibility layer (spec 022): one `modelFor` AI SDK adapter registry, Meta model
  presets for Muse Spark 1.3 Contributor/Standard, cached prices and reasoning facts, and a per-book
  Contributor training consent with a model-picker warning and an agent guard.
- Added the film fixture generator (spec 021 T004): `bun run film:fixture` builds an original short
  book with a Story Bible, two chapters, a deterministic 1024×1024 illustration and a 512×512
  transparent character cutout through the real library and image store. The fixture is ignored by git;
  the generator and its test are committed.
- Added the product-film plan (spec 021): a positioning review of the category, a positioned script,
  a shot-by-shot storyboard and the voice, music
  and motion-plate production plan. Added the brand-positioning paragraph to `docs/DESIGN.md`.
- Added SAM 3.1 character cutouts (spec 020): prompt validation, the official `@meta-sam/parser` for the
  mask grammar, a `segmentation:segment` IPC route, the renderer `applyCutoutMask`/PNG compositor and
  cutout mode in the Illustration dialog. Cutouts save as `character` images with `cutoutOf`; a cutout
  can be attached to a cast member at save time or from the image list, and the character id is stored on
  the image record.
- Added the illustration pipeline (spec 019): a versioned `images.json`, an atomic image store over
  `LibraryPort`, PNG/WebP/JPEG inspection, Muse Image generation through Meta at a visible `$0.01`
  per-image estimate, IPC, an Illustration dialog, an attached image below the chapter and DOCX
  embedding with the prompt as a caption. The dialog’s missing-connection, attached-image, generation,
  attach and SAM-match states are covered under happy-dom.
- Added specs 019 and 020 for illustrations and SAM 3.1 cutouts, including the documented Meta
  endpoints, the mask grammar and the renderer-side compositor plan.
- Added the standalone `bookwriter` toolkit (spec 018): a loopback-only desktop backend with a per-run
  token, a CLI for info/books/read/search/conflicts/create/save, and an MCP stdio server whose read
  tools are on by default and whose write tools require `--allow-writes`. Saves carry the version and
  hash from the read and use the existing conflict path.
- Added Muse Voice Transcribe dictation (spec 017): a Meta ASR service in the main process, strict
  mono 16-bit PCM WAV validation, browser-side decode/resample/encode, a microphone button with a
  ten-minute cap, and insertion at the editor caret through the normal save path.
- Added background agent turns: an opt-in per-turn flag, an outcome callback after finish, failure,
  stop or approval pause, native notifications with a short preview, a dock badge and focus-on-click.
  Destructive approvals still wait for the author.
- Recorded the Meta participant guide in `hackathon/EVENT.md`: the full schedule and Discord channels,
  the four-person team cap, the open-source and event-only-work rules, the anti-project list, the $150
  credit and partner offers, the three-stage judging rubric, both prize tracks and the bonus prizes, and
  the submission requirements including the three-minute demo video.
- Added spec 009 for desktop packaging, signing, notarisation, release provenance and the gated
  update path; D-115 keeps signing and updates deferred.
- Added the automated-verification plan and task ledger for spec 012, covering the existing Bun,
  smoke, browser-matrix, gallery and key-check evidence and the remaining lint, coverage,
  accessibility, performance, security, CI and live-provider gaps.
- The browser storage harness reloads a saved OPFS library in the same tab and verifies the chapter,
  alongside the picker and two-tab checks. Chromium passes 16/16 real-browser checks.
- The browser storage harness now covers picker cancellation, a denied folder re-grant that keeps the
  pending folder, and two-tab Web Lock serialization. Chromium passes 15/15 real-browser checks; the
  native picker and real Safari/Firefox remain open.
- The writing agent now treats manuscript, Story Bible and tool text as untrusted data: the prompt
  wraps it in a labelled block and tool descriptions mark returned text as data.
- The chat composer can choose a model for the next message only. The runtime validates it, records
  it on the turn, and leaves the book default unchanged.
- A turn that pauses for approval stores the request on its assistant message. Reloading the
  conversation shows the same Allow/Deny card; allow, deny and stop update the stored decision, and a
  request left by a closed app reports that it expired when answered.
- A context-overflow error now names the model's context limit and offers **Choose a larger model** and
  **Start a new conversation** instead of a dead-end retry.
- The assistant message stores a per-section estimated context breakdown (instructions, book, outline,
  characters, memories, chapters, active chapter and conversation) and the chat shows it in a closed
  Context disclosure.
- The turn usage line now shows input tokens as a percentage of the selected model's context window
  when the catalogue reports one; the context length is stored with the assistant message and usage.
- The chat can start a new conversation and list stored conversations in a history dialog; choosing
  one reloads its messages and checkpoints. Conversations can be renamed inline, branched from an
  assistant turn into a new thread, or deleted behind an explicit confirmation. The smoke run now
  covers the new/history controls (16/16).
- OpenRouter's reported final-step cost is read from provider metadata and shown per turn; a missing,
  negative or non-numeric value stays unknown instead of becoming zero. Other providers stay unknown.
- Tool activity now carries its input and output, and the chat keeps the main line plain while a
  closed Details disclosure shows the raw call and result. The stored-message conversion moved to
  `packages/app/src/lib/chat-view.ts` with tests.
- Added a provider-registry contract suite: every provider has a complete entry and unique hosts,
  keys stay in headers, base URLs are normalized, provider catalogue payloads parse consistently, and
  model capabilities and selection never guess an unreported field.
- Moved the studio shell into `packages/app`: `App`, views, product components, hooks and renderer
  utilities. The desktop renderer keeps a one-line re-export; the web imports `@ai-book-studio/app`
  directly, and the `@renderer` alias is gone from the build and typecheck configs.
- Moved the Liquid Glass stylesheet and generated tokens into `packages/ui/src/styles/`; both build
  entry points import `@ai-book-studio/ui/styles/base.css`. `build:info` now checks the app, core and
  UI package versions too.
- Added `merge_chapters`: merges adjacent chapters into the first, pauses for approval, and records the
  deleted chapter in the checkpoint so undo recreates it in its original position.
- Added `split_chapter`: splits a chapter at a 1-based line into two ordered chapters. It pauses for
  approval and records the created chapter in the turn checkpoint, so undo removes it as well.
- Added `insert_at_line`, `delete_lines_in_chapter` and `move_chapter` to the writing agent. Line
  delete and chapter move pause for approval; line insert and delete are checkpointed, while a move
  changes chapter order only.
- Added `overwrite_chapter` and `delete_chapter` to the writing agent. Both pause for the author's
  approval; overwrite is checkpointed and undoable, delete moves the chapter to the trash.
- Added the first approval-gated agent tool: `remove_memory` now pauses the turn with an Allow/Deny
  card, resumes with a `tool-approval-response`, and passes a denial back to the model. The pause and
  denial are covered by mock-model tests; ADR 0014 records the protocol.
- Added a model-factory seam to `AgentRuntime` and two contract tests using AI SDK mock models: a full
  text turn persists its thread and usage, and a tool call runs through the same `ToolLoopAgent`.
- Added `compactHistory`: the runtime keeps the last six user turns verbatim and summarizes older
  tool activity before sending, while the stored thread remains complete. This closes 002 FR-030.
- Added `find_in_chapter`, `find_in_chapters` and `update_memory` to the writing agent. Search returns
  line numbers and matching text; memory updates keep the Story Bible current without removing a
  memory (removal still needs the approval flow).
- Added the `hackathon/` folder with the Meta Global AI Developer Hackathon brief, the AI Book Studio
  Meta Edition plan and the 10-day milestones.
- The writing agent now stores each turn under `books/<bookId>/threads/` and the chat reloads the
  latest conversation. A failed turn keeps its user message for Retry; a stopped turn keeps its
  partial text, reasoning and tool parts.
- Adopted the Apache License 2.0 (`LICENSE`, `NOTICE`) and declared it in every workspace package.
- Added the canonical agent message/thread format in `packages/core/src/agent/` and a `ThreadStore`
  over the shared library port, with 8 tests. Conversations have a file format under
  `books/<bookId>/threads/`; the runtime and chat do not write it yet. Recorded in ADR 0013 and
  `docs/FORMAT.md`.
- The writing agent now reads the Story Bible: the prompt carries saved memories and each character's
  description, motivations and notes; `read_story_bible` returns the full bible; `update_character` can
  change motivations and notes; and a snapshot plus a 4,000-token budget test guard the prompt. The
  worst-case fixture is 3,384 tokens.
- Added `docs/AGENTIC-COVERAGE.md`, an audit of specs 002/011/012 against the agent runtime: 19
  requirements implemented, 5 specified but missing, and conversation persistence, approvals, context
  assembly, injection safety and agent evals unspecified. Corrected the stale known-gaps list in
  `AGENTS.md`.
- Added T014's shared-component gallery at `apps/web/check/gallery.html`. It renders the shared Button,
  Brand, Notice and Dialog, compares browser-storage and folder disclosures, and was measured in light
  and dark at phone, tablet and desktop sizes. Also taught the web stylesheet to scan `packages/ui`.
- Moved `Brand` and `Notice` into `packages/ui`; the desktop renderer re-exports them, and the web
  welcome imports the shared Brand and Button instead of the `@renderer` alias.
- Added the first `packages/ui` extractions: `Button`, `Dialog` and `cn` now live in the shared package,
  the desktop renderer re-exports them, and both apps depend on the package. Remaining components and
  the visual check page are still open.
- Added `bun run smoke:packaged`: it builds the unpacked macOS app, starts the packaged binary with a
  throwaway profile and fixture library, and runs the full hidden suite against it. Passed 16/16.
- Added a Playwright cross-browser matrix for the real storage harness: Chromium passes 12/12, including folder mode through a picked OPFS handle; Firefox
  and WebKit OPFS openings are recorded findings. Browser storage now times out after five seconds and
  tells the author to choose a folder or export an archive instead of waiting indefinitely.
- Added unit coverage for the cross-tab Web Lock request and its no-lock fallback; the real-browser
  two-tab matrix remains.
- Completed the mobile accessibility pass: touch controls, accessibility labels and visual order on the
  iPad mini shell, reduced motion/transparency enabled and relaunched, and a web smoke check that
  emulates both media features and asserts no transition duration or backdrop filter.
- Added browser OpenRouter sign-in: a same-origin popup with PKCE and checked state, code exchange,
  storage in the browser vault, and list/remove in Settings. The live browser-access pass remains
  T040/T041; manual keys and the other providers stay gated.
- Added unit coverage for browser capability detection and persistence denial, unsupported and failure
  paths; the real-browser Playwright matrix remains.
- Added browser permission-recovery tests: a re-granted folder opens as `folder://`, and a denied
  re-grant keeps the folder pending without switching storage tiers. All T026 browser journeys now have
  automated coverage; the real-browser picker matrix remains T013/T027.
- Added a browser folder-mode integration test: a picked fake folder opens as `folder://`, creates a
  book and chapter, and saves through the shared library service.
- Added the browser credential vault (D-105): an origin-scoped IndexedDB store that returns summaries
  without secrets, supports touch/remove/re-open, and shows a Settings disclosure that it is not the OS
  keychain and can be cleared with site data. The browser OpenRouter flow stores its connection here.
- Added a DOM test for the browser archive import picker, covering both a selected archive and a
  cancelled picker. The core import path and the web export journey remain covered separately.
- Added a real DOM component-test setup (happy-dom and Testing Library) and editor tests for the 700 ms
  autosave debounce and the conflict state. The legacy import is recorded as delivered with its parser
  and importer tests.
- Chapters can be dragged to a new position in the rail. The move renumbers only the affected orders,
  checks both versions and hashes, rolls back a conflicting write, and is covered by the hidden smoke
  run. The rail buttons and keyboard move remain.
- Documented the sync journal, read-only scanner and drift detector, the two-system harness results and
  the D-124 device-identity caveat in the architecture and decision records. No drift UI or app lock has
  shipped; both remain behind D-121–D-124.
- Verified the iPad mini rotation path in the Capacitor shell: a chapter keeps its selected state, typed
  text and `Saved` status across portrait and landscape. The procedure, accessible names and remaining
  VoiceOver/reduced-motion checks are recorded in `docs/research/mobile-layouts.md`.
- Undo and redo now survive switching chapters. The editor keeps a per-chapter in-memory history,
  coalesces a typing burst into one step, clears it when the disk version is refreshed, and the hidden
  smoke run switches chapters and undoes the typed marker.
- Each agent turn records its provider, connection label and model id with its usage, and the
  conversation shows the model when it changes between turns.
- The studio now notices changes made outside it. The desktop filesystem port watches `books/**` and
  `.studio/trash/**`, the main process debounces them into one event, and the workspace offers a refresh
  that flushes unsaved text before reloading the chapter. Chapters can also move with ⌘⌥↑/⌘⌥↓
  (Ctrl+Alt on Windows) beside the rail buttons.
- Added browser smoke journeys for a stale-save conflict and a portable archive export, plus fake-handle
  tests for folder-picker cancellation and permission mapping. Updated the storage architecture/format
  docs and the spec 011 web tasks to record the landed storage boundary and the remaining decisions.
- Added shared build metadata and a capability table. Settings → About now reports the target, version,
  commit, format version, platform, storage and whether each capability is available, with a reason for
  every unavailable one. Vite and electron-vite inject the same version and commit as `bun run build:info`.
- Added one build-info source (`bun run build:info`) for version, commit, schema and target; it fails when
  the workspace package versions disagree. Desktop artifacts now carry the product, version, OS and
  architecture in their names. Added a deployment, promotion and five-minute rollback runbook, a Gitea
  verify workflow, and an honest README note that no runner is registered yet.
- Chapters can be moved up and down from the chapter rail. The move swaps order metadata only, leaves
  file names in place, checks both chapters' versions and hashes, rolls back a half-applied move, and is
  covered by the hidden smoke run.
- Added the two-system sync harness and read-only library scan from spec 016 (T004–T005). The scan hashes
  `books/**` and `.studio/trash/**`, probes online-only placeholders before reading, skips provider sidecars
  and transient files, and reads book schema and chapter identity from the same bytes. Ten scenarios cover
  clean propagation, concurrent and offline edits, deletion/tombstones, placeholders, interrupted copies,
  corrupt journals, repeated scans, provider conflict copies and renames. The harness found and fixed a
  detector bug where a chapter moved to the trash was paired as a rename instead of a deletion.
- Added the sync baseline and read-only drift detector from spec 016 (T001–T003): a per-device journal
  with tombstones, rename pairing, placeholder/unreadable/newer-schema reporting, and 14 tests. No UI or
  provider integration yet.
- Captured spec 016, sync and device trust: two-device folder sync, read-only drift detection with
  tombstones, an optional Face ID/Touch ID or keychain-PIN app lock, and a two-system transport harness.
  No sync code ships yet; decisions D-120–D-123 are open.
- The browser build now reports its storage summary through `LibraryInfo`, including the tier,
  persistence and the last confirmed save time, and Settings shows it with the browser warning.
- The browser build keeps unsaved chapter text in a draft buffer and flushes it once when the page
  is hidden. The flush reports `confirmed`, `conflict`, `unconfirmed` or `empty`; a write that does
  not land is never reported as saved, and the held text stays available.
- Books can be renamed and moved to the library trash from the library grid. Deletion preserves the
  whole folder under `.studio/trash/books/<timestamp>-<bookId>/`; the browser build moves the folder
  through the same storage port, so a deleted book survives in site storage and in archives.

### Fixed

- Provider names and connection ids now share Zod schemas between the core contract and the IPC
  boundary; malformed connection ids and unknown providers are rejected in tests.
- The credential vault repairs a world-readable file to owner-only permissions at startup and reports
  when the platform cannot confirm the mode. A scan test proves a stored connection leaves no plaintext
  secret in `studio.json` or the library.
- Browser saves now re-check the target hash immediately before the commit point and abort the swap file
  when another tab or folder writer changed the file. A read-back hash mismatch is reported as a conflict,
  never as saved. Injected permission, read-only, quota, interrupted-close and concurrent-edit tests assert
  that the previous bytes stay intact and the author's text survives in a conflict copy.
- A chapter whose title contains `conflict` is no longer hidden from the chapter list or treated as a
  provider conflict copy. The rule now matches only `.conflict-<reason>` and `(conflicted copy)` names,
  and the library and the sync scan share it.
- In the browser build, a successful save no longer discards newer draft text that was typed while
  the save was in flight; the draft is cleared only when its content is the content that was written.
- A failed agent turn keeps its original prompt and history for an explicit retry. Auth failures also
  offer Reconnect, which opens Settings on the provider-connections section without clearing the turn.
  Partial writes are checkpointed before the error is shown, and retry waits until the author undoes
  the changed chapters. The hidden smoke run covers the no-model retry path.
- Settings is now reachable from the workspace, from both the header gear and the phone More
  sheet. The old Connections dialog became a shared Settings surface covering appearance,
  provider connections, and where the library lives, and the Library gear is labelled Settings.
- The workspace save state shows a short text label at every width instead of only a coloured
  dot. The chapter delete action is visible on touch instead of hover-only. Settings and Story
  Bible keep Done/Save visible while their bodies scroll. Recorded in
  `docs/research/ui-audit-2026-10-25.md`.

### Added

- Added the Capacitor iOS shell (`apps/mobile`) around the real web build. It runs on the iPhone 17 Pro
  and iPad mini simulators with no native plugins, honors safe-area insets, and hides or explains
  actions WebKit cannot support instead of failing at the moment of use. `bun run ios:iphone`,
  `bun run ios:ipad` and `bun run ios:pair` build and open the devices.

- Polished the web shell: a plain-language storage welcome, and a phone-width library card that no
  longer wraps onto a third metadata line.
- Added the `apps/web` static shell: the real renderer runs in a browser with a storage-choice welcome screen, OPFS or chosen-folder libraries, archive import/export, and desktop-only actions explained instead of failing silently. `bun run build:web` emits `apps/web/dist`, and `bun run smoke:web` drives the built app in a hidden Chromium window (6/6 checks).

- Added a browser storage self-check harness at `apps/web/check/` that runs the real OPFS adapter, checked saves, a stale-save conflict, archive round-trip and IndexedDB in a browser and reports pass or fail without touching an author library.

- Added browser archive I/O: export streams into the browser's save picker when one exists and otherwise downloads a Blob; import reads a chosen File twice, so the core validator can check every path and hash before writing. No archive byte or credential is sent to a server.

- Added the browser storage layer in `apps/web`: one `LibraryPort` over a browser directory handle serves both chosen folders and OPFS; IndexedDB keeps only the handle and library id; folder permission, persistence, quota and cross-tab lock state are reported through the shared storage summary.

- Added library archive actions to the desktop library view: export writes a complete ZIP beside the chosen file and only replaces an older export after success; import validates the archive, requires an empty destination, never merges into the open library, and opens the imported library on success.

- Added the portable library archive in `packages/core`: a versioned, hash-validated ZIP manifest; streaming export that excludes credentials, catalogs, device identity, temporary and lock files; and a two-pass import that validates every path, size and hash before writing, refuses a non-empty destination and cleans up its own partial writes.

- The hidden smoke runner now reads the app's machine-readable result, so a passing run is not reported as a timeout when Electron closes the window but leaves the main process alive (recorded as a known issue in spec 012).
- Moved the library rules into `packages/core`: `LibraryService`, validated library-relative paths and the `LibraryPort` contract now own checked saves, conflict copies, trash, search and the derived catalog. `apps/desktop/src/main/library/fs-port.ts` is the reference filesystem adapter and `store.ts` is a thin facade, so the desktop IPC surface and its tests are unchanged. The in-memory conformance suite covers external edits, stale versions, trash/restore, newer schemas and failed writes.

- Added spec 010 for the browser storage/portable archive prerequisite, including a researched decision for browser credentials and the archive format, and a task plan that records the missing storage-port implementation instead of assuming ADR 0009 is already landed.
- Added the first target-neutral `LibraryPort` contract, validated relative/archive paths and in-memory tests for compare-before-write, byte isolation, directory listing and non-overwriting moves.
- Corrected the architecture status: the port contract exists, but shared library logic and production adapters are still pending in spec 010.
- Added plan and task tracking for spec 014; the 44px touch-target audit, safe-area work, orientation checks and real Capacitor renderer integration are now explicit open tasks.
- Finished the spec 014 touch-target pass: coarse-pointer layouts enlarge hit areas without changing icon size, the chapter delete action is reachable without hover, the agent Send button no longer overflows at 393px, long library paths truncate, and tall dialogs scroll inside the viewport.
- `capture.mjs --coarse` now emulates touch and fails on any visible control below 44 × 44 or on horizontal document overflow; the measured audit is recorded in `specs/014-mobile/checklists/touch-targets.md`.

- Model access, Phases 1–4 of spec 011: the provider contract and static registry (OpenRouter, OpenAI,
  Anthropic, Gemini, Meta with browser-access status), catalogue freshness and merge rules,
  `capabilitiesFor` with explicit unknown, `normalizeProviderError` (including `Retry-After`) and
  redaction for keys, bearer headers and query strings. `packages/core/tests/providers.test.ts` covers
  the contract.
- Desktop provider layer: a testable `FileCredentialVault` behind the operating system's protected
  storage (`userData/credentials.json`, `0600`, no plaintext), an OpenRouter loopback sign-in with PKCE
  S256, state checking, a ten-minute timeout and cancel, code exchange, labelled connections, a cached
  model catalogue and a key test. The Connections dialog connects, tests, lists models and removes a
  connection, and refuses to save when protected storage is unavailable. D-104 is accepted for desktop.
- Direct API keys for OpenAI, Anthropic, Gemini and Meta: the key is validated against the provider
  before it is stored, a rejected or unreachable key is never saved, keys travel in headers rather than
  query strings, Meta's base URL is configuration, multiple labelled accounts per provider are allowed,
  and removing a connection drops its secret and cached catalogue together.
- Optional provider, connection and model fields on `book.json`; books written before them still parse.
- Model selection per book: a turn override wins, then the book's saved choice, then the first usable
  connection. A saved model that can no longer run the agent falls back and explains why. The model
  picker lists every connection's models with context size and price, searches them, disables models
  that cannot use tools with a one-sentence reason, and warns when the saved model has vanished.
- The renderer's content security policy now allows only local connections. Model requests and keys
  stay in the main process, and a test fails if a registered provider host appears in the policy.
- A single transport module builds the AI SDK model for every provider: OpenRouter, the native OpenAI,
  Anthropic and Gemini factories, and Meta through an OpenAI-compatible client with its configured base
  URL. Nothing else in the app constructs a provider client.
- Usage is recorded per turn in `.studio/usage/<bookId>.jsonl` with reported or estimated cost. Cost is
  labelled reported, estimated, included in a plan, or unknown; an unknown cost never appears as $0.00.
  A usage summary channel reads the file without ever uploading it.
- Provider errors are normalised to auth, rate limit, quota, context, refusal, offline or unknown, with
  the provider's retry delay carried through.
- The first writing-agent loop: a `ToolLoopAgent` in the main process reads the book, the chapter list
  and the active chapter into a compact prompt, then edits through five tools (chapter list, read a
  chapter, count words, replace one unique passage, append text). Each edit goes through the same
  version-and-hash save protocol as the editor, so a conflict becomes a refusal rather than data loss.
  The chat panel streams text and tool progress, can stop a turn, and reloads the manuscript when the
  agent finishes. A turn's usage is appended to the book's usage file.
- The Story Bible: one dialog edits the book's title and description, genres and influences,
  outline, the three-act story arc, the cast and saved memories, all through the same book update
  channel and validated schema.
- A turn that edits chapters writes a checkpoint before its first change. The chat offers “Undo this
  turn”, which restores every chapter the turn touched through the same version and hash save
  protocol; checkpoints live under the book's `.studio/checkpoints` folder.
- The writing agent can also shape the book: it creates chapters, updates chapter titles, synopses
  and purposes, revises the book's description, outline or genres, keeps characters current and
  saves short memories. All of these go through the same book and chapter store.
- Export to Word: a book becomes a `.docx` with a title page, a page break per chapter, and the
  manuscript's font, size, line spacing and first-line indent, written atomically to a location the
  author chooses.
- Legacy import: a backup from the earlier app becomes books, chapters, characters, memories and
  manuscript settings in the open library. Chapters keep their text, the old conversations are left
  behind, and a damaged book is reported instead of stopping the rest.
- Book search: a search window finds matching lines across every chapter, ignores case, and opens
  the chapter from a result.
- Mobile path recorded: Capacitor for the iOS and Android shell, Expo Simulators or the Device hub for
  device testing. Expo is not adopted as the app framework (D-117, D-118).
- Local iOS simulator ready: Xcode 26.6 installed the iOS 26.5 runtime, iPhone 17 Pro boots and
  screenshots, and `Simulator.app` opens. Device hub agent access still needs to be enabled for the
  T3 simulator tools; `simctl` works without it.
- Capacitor shell spike: Capacitor 8.5.3 built through Swift Package Manager and launched a bundled
  page on the iPhone 17 Pro simulator, proving the WKWebView path without Expo or React Native. The
  real renderer and the Filesystem, SQLite, Keychain and iCloud plugins wait for spec 010. Recorded in
  `docs/research/capacitor-ios-spike.md`.
- Mobile-first layouts for the iPhone (393 × 852) and iPad mini (744 × 1133): a compact header, a
  bottom action bar, a chapter drawer, a full-screen agent sheet and a two-pane tablet workspace.
  The 700px and 1000px breakpoints, responsive manuscript type and dialog widths are recorded in
  `docs/DESIGN.md`; spec 014 defines the acceptance criteria and D-119 records the reference devices.
  Captures are in `docs/research/mobile-layouts.md`.
- A capture harness for the real renderer: `STUDIO_WINDOW_SIZE` and `STUDIO_CAPTURE` in the main
  process, plus `bun run capture:run 393x852 out.png` and an optional selector to open a book or panel.
- 107 tests pass (13 library, 26 provider contract, 5 credential file, 13 provider flow, 5 selection,
  2 content security policy, 4 transport, 6 usage contracts, 5 usage storage, 8 agent tools and
  prompt, 5 checkpoints and undo, 5 planning tools, 2 export, 4 legacy import, 4 search).
- `docs/DECISIONS.md`: a decision register with 16 settled decisions and 16 open ones (D-101…D-116),
  each naming the evidence needed and the spec or task it blocks, plus the rule that a spec relies only
  on an accepted decision or a stated assumption.
- Plan and tasks for spec 013: the six-phase workspace, packaging, shared UI, web target, environments
  and CI sequence (T001–T021), with T001–T012 complete.
- Packaging spike: `bun run package:dir` builds `release/mac-arm64/AI Book Studio.app`, and the packaged
  binary passes all five hidden smoke checks against a fixture library, including a saved edit. The
  build is unsigned and uses the default icon, as expected for this stage.
- Hidden test runs: `STUDIO_TEST`, `STUDIO_HEADLESS` and `STUDIO_SMOKE` launch an off-screen window
  with its own profile, and `bun run smoke` drives the real UI through the preload bridge, the library,
  opening a book and an autosave reaching the disk.
- Spec-driven record: `.specify/memory/constitution.md` with seven principles, `specs/README.md` with
  the roadmap, and `specs/001-foundation/` (spec, plan, tasks) describing the foundation as built.
- `docs/ARCHITECTURE.md` (process split, save protocol, sync model, testing seams) and
  `docs/DESIGN.md` (Liquid Glass rules, type scale, voice, accessibility checklist).
- ADRs 0001–0006: local-first Electron, Markdown as source of truth, user-chosen sync folder, token
  pipeline, spec-driven development, and AI calls plus secrets in the main process.
- White-room product specification `specs/002-studio-v1/` covering writing, the Story Bible, the agent,
  import and migration, voice, illustrations, export, sync and trust (76 requirements, 16 measurable
  outcomes), with its quality checklist.
- Migration specification `specs/003-legacy-port/` for the previous application's JSON export, mapped
  book by book, with idempotency, atomic publication, a migration report and rollback.
- `docs/FEEDBACK-DISPOSITION.md`: all fifty inherited defects (F-001…F-050), nineteen follow-up themes
  and fifteen unresolved design decisions given a disposition and a target requirement.
- Browser build requirements in spec 002: one shared book format, real-folder access in Chromium,
  origin-private storage in Safari and Firefox, explicit degraded guarantees, direct provider calls,
  and archive portability (FR-071…FR-076, SC-015, SC-016, user story 10).
- `docs/adr/0009-multi-target-storage.md`: the core/port/adapter design, the verified File System Access
  and OpenRouter CORS facts, and the three storage tiers. Electron becomes one adapter rather than the
  owner of the format.
- Harness evaluation appended to ADR 0007: `@ai-sdk/harness` cannot run in a browser, would bypass the
  save protocol, and is experimental, so harness runtimes are deferred behind the runtime seam.
- `docs/adr/0010-bun-and-workspaces.md`: Bun as package manager, task runner and test runner; a Bun
  workspaces layout for desktop, web, core, UI and shared config; Electron keeps its Node runtime and
  builder/Playwright stay on Node. Electrobun rejected for v1.
- Deep specs 011 (model access: OpenRouter SSO, provider keys, ChatGPT plan, capability rules),
  012 (automated verification: unit, contract, web and Electron end-to-end, live checks, gates) and
  013 (builds and deployment: shared core, desktop and web targets, staging). Each has a passing
  requirements checklist.
- `.env.example` and `bun run keys:check`, which verifies OpenRouter, OpenAI, Anthropic, Gemini and a
  configurable Meta endpoint without printing key material.
- Spec 011 plan and task list: provider registry and capability rules, a credential vault with desktop
  and web adapters, OpenRouter PKCE connection, API-key validation for four providers, the ChatGPT plan
  phase gated on D-102, model selection and runtime wiring, cost labelling and error recovery, and the
  web-enablement phase gated on spec 010. Forty-two tasks across nine phases.
- ADR 0007 picks the Vercel AI SDK 7 `ToolLoopAgent` with the OpenRouter provider as the agent runtime
  (rejecting the OpenRouter Agent SDK, OpenAI Agents SDK and Claude Agent SDK); ADR 0008 makes the
  legacy port one-way through the export file.
- Spec Kit initialised for OpenCode with the `git`, `agent-context`, `bug` and `assess` extensions;
  `/speckit-*` commands are available in `.opencode/commands/`.

## [0.1.0] — 2026-10-24

The first foundation: a local-first studio that opens a folder of files, writes chapters atomically,
and shows them in the Liquid Glass interface from the design kit. No agent, exports or packaging yet.

### Added

- Electron 45 application scaffolded with electron-vite, React 19, Tailwind 4 and TypeScript.
- Library format: `book.json` per book, one Markdown file per chapter with YAML front matter, and a
  derived `library.json` catalog that is never read as truth.
- `Library` store with create/read/update for books, chapters and chapter metadata; chapter order,
  slugged file names, deterministic fallback ids for files written by other tools.
- Atomic writes (temp file, fsync, rename, retry for Windows sharing violations) and per-book write
  serialization.
- Optimistic concurrency: every save carries the version and SHA-256 hash it was based on. A newer
  version or an edited file produces a conflict copy in `conflicts/` instead of an overwrite.
- Draft buffer in the main process, flushed on window close and on quit.
- Deleted chapters move to `.studio/trash/<bookId>/` rather than being unlinked.
- Schema versioning that refuses files from a newer app with an explicit "update the app" error.
- Typed IPC contract (`src/shared/ipc.ts`) with a `Result` envelope and Zod validation on every
  channel; context isolation, sandboxed renderer and a restrictive CSP.
- Design tokens generated from the local design kit (`design/tokens.json` → 38 primitives,
  96 semantic colors) plus the glass, window-wash and manuscript styles.
- Welcome, Library and Workspace views: 248 px chapter rail, 760 px manuscript sheet, save status,
  conflict banner with "Show the saved copy" and "Load the version on disk", theme cycle.
- 13 Vitest tests covering the format, atomic saves, conflicts, trash, schema rejection and path
  safety.
- electron-builder configuration for macOS (dmg, zip), Windows (nsis) and Linux (AppImage), with
  hardened-runtime entitlements.

### Notes

- This repository starts fresh. It replaces an earlier local prototype and shares no history, no
  Next.js server and no localStorage library.
