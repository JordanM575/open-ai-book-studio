# Decision record

Every decision that shapes the product is written down before it is built. This file is the index and
the working register; an Architecture Decision Record in [`adr/`](adr/) is written when a decision is
significant, hard to reverse, or likely to be relitigated.

**Rule:** a spec may depend only on a decision that is `Accepted` or on an assumption listed in the
spec's Assumptions section. An `Open` decision blocks the task that needs it, not the whole spec.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `Open` | A question exists; nobody has chosen. Research may be needed first. |
| `Researching` | Someone is gathering evidence; the decision is not made. |
| `Proposed` | A recommendation exists with its alternatives; awaiting acceptance. |
| `Accepted` | Chosen. Implementations may rely on it. |
| `Deferred` | Deliberately not decided now; the trigger for revisiting is written down. |
| `Superseded` | Replaced; the old entry stays and links forward. |

## Settled decisions

| ID | Decision | Record |
| --- | --- | --- |
| D-001 | Local-first Electron application; the main process owns files | ADR 0001 |
| D-002 | Markdown plus YAML front matter per chapter; SQLite is a derived index | ADR 0002, `docs/FORMAT.md` |
| D-003 | Sync through a folder the author chooses; conflict copies, no server | ADR 0003 |
| D-004 | Design tokens are vendored and compiled, never hand-copied | ADR 0004 |
| D-005 | Spec before code; ADRs for hard-to-reverse choices | ADR 0005 |
| D-006 | AI calls and secrets live in the main process | ADR 0006 |
| D-007 | Agent runtime is Vercel AI SDK 7 `ToolLoopAgent`; harness runtimes deferred | ADR 0007 |
| D-008 | Legacy migration is one-way, file-based, through the export | ADR 0008 |
| D-009 | One core over a storage port; Electron, Chromium folders and browser storage are adapters | ADR 0009 |
| D-010 | Bun is package manager, task runner and test runner; Electron keeps Node | ADR 0010 |
| D-011 | Paragraphs are lines; no 66-character virtual wrap | spec 002 Assumptions |
| D-012 | Agent edits apply during a turn and the turn is one undo; no Apply/Reject cards | spec 002 Assumptions |
| D-013 | No emoji in application copy | spec 002 Assumptions |
| D-014 | One illustration per chapter on its own page, plus separate image files | spec 002 Assumptions |
| D-015 | No telemetry, ever | Constitution, FR-061 |
| D-016 | Fresh repository, inherited app archived rather than forked | CHANGELOG `[Unreleased]` |
| D-104 | OpenRouter web sign-in uses same-origin OAuth callback with PKCE and checked state | ADR 0011 |
| D-105 | Browser credentials use disclosed origin-scoped storage; no passphrase or encryption claim in v1 | ADR 0011 |
| D-112 | Portable libraries use a versioned, hash-validated ZIP archive; import never merges silently | ADR 0012 |
| D-114 | Bun tests core/adapters; Playwright on Node for browser and Electron E2E; live-provider tests opt in | spec 012 |

## Open decisions

These are the questions we already know we cannot answer by assumption. Each one names the evidence
needed and the spec or task it blocks.

### D-101 · Browser access per model provider

| | |
| --- | --- |
| **Status** | Researching |
| **Question** | Which providers can the web build call directly, with the author's key, without a proxy? |
| **Known** | OpenRouter: yes, verified CORS. OpenAI: no (preflight fails). Anthropic: only with `anthropic-dangerous-direct-browser-access`. Gemini and Meta: unverified. |
| **Needed** | A repeatable browser-access check per provider, run from the built web app, recorded with date and result. |
| **Blocks** | spec 011 tasks for web provider adapters; spec 010 provider UI |
| **Owner** | spec 011 |

### D-102 · Sign in with ChatGPT eligibility and licence

| | |
| --- | --- |
| **Status** | Researching |
| **Question** | May this app ship the `@siwc/*` devkit, and does the hackathon build qualify as an eligible project? |
| **Known** | Devkit exists with Electron support; eligibility covers open-source and local personal projects, selected private apps, and identity-only partnerships. Paid or hosted use needs OpenAI approval. |
| **Needed** | Licence review, eligibility answer from OpenAI, and a decision on whether desktop-only ChatGPT access ships in v1. |
| **Blocks** | spec 011 ChatGPT story; credentials UI |
| **Owner** | spec 011 |

### D-103 · Meta and Gemini endpoints

| | |
| --- | --- |
| **Status** | Researching |
| **Question** | Which Meta API endpoint and model family is current, and does Gemini's API allow browser calls? |
| **Known** | `api.llama.com` was shut down in July 2026; `dev.meta.ai` exists. Google's browser guidance assumes a proxy. |
| **Needed** | Current official docs, a live probe with a key, and a capability entry rather than a hard-coded base URL. |
| **Blocks** | spec 011 provider registry entries |
| **Owner** | spec 011 |

### D-106 · Bun workspaces with electron-vite and electron-builder

| | |
| --- | --- |
| **Status** | Accepted |
| **Question** | Does `bun install` plus workspace linking survive electron-vite's dependency externalisation and electron-builder's packaging on macOS? |
| **Evidence** | `bun install` linked `@ai-book-studio/core` into the desktop app; electron-vite bundled the core package with no unresolved import; `bun run package:dir` produced `release/mac-arm64/AI Book Studio.app` (unsigned, default icon) and the packaged binary passed all five hidden smoke checks, including a save reaching disk. electron-builder warned that it could not read Bun's dependency tree, then used its file-traversal collector successfully. |
| **Decision** | Keep Bun as package manager and task runner, Electron as the desktop runtime, and electron-builder on Node. Record `trustedDependencies` for Electron; check for the binary in `scripts/check-electron.mjs`. |
| **Blocks** | spec 013 T001–T012 (done) |

### D-107 · Index engine per build

| | |
| --- | --- |
| **Status** | Open |
| **Question** | SQLite in Electron (`node:sqlite`, `bun:sqlite` or `better-sqlite3`) and IndexedDB in the browser — or one portable engine? |
| **Tension** | `bun:sqlite` does not exist in Electron's Node. Native modules need an ABI rebuild per Electron version. |
| **Needed** | A spike on the Electron 45 / Node 22 combination; a schema that can be rebuilt from files either way. |
| **Blocks** | spec 002 search/index tasks; spec 010 browser index |
| **Owner** | spec 002 / 010 |

### D-108 · Export libraries and determinism

| | |
| --- | --- |
| **Status** | Open |
| **Question** | Which DOCX, PDF and EPUB implementations produce KDP-acceptable output and deterministic files? |
| **Needed** | Compare `docx`, LibreOffice headless, `pdf-lib`, Typst, `epub-gen`; test a book with front matter, images and verse. |
| **Blocks** | spec 002 export tasks |
| **Owner** | spec 002 |

### D-109 · Voice stack

| | |
| --- | --- |
| **Status** | Open |
| **Question** | Which system voices are reachable from Electron on each OS, and is browser `speechSynthesis` good enough for the web build? Is premium TTS (ElevenLabs) in scope for v1? |
| **Needed** | Platform probes; a matrix of voice, offline behaviour and cost; dictation fallback. |
| **Blocks** | spec 002 voice requirements |
| **Owner** | spec 002 |

### D-110 · Image generation providers and policy

| | |
| --- | --- |
| **Status** | Open |
| **Question** | Which OpenRouter image models are suitable for book illustration, what do they cost, and how are refusals surfaced? |
| **Needed** | Model survey with per-image cost, size and content-policy behaviour; a budget model for a 40-image book. |
| **Blocks** | spec 002 illustration tasks |
| **Owner** | spec 002 |

### D-111 · Conflict UX across sync providers

| | |
| --- | --- |
| **Status** | Open |
| **Question** | How do iCloud, Drive and Dropbox name conflicted copies, and what does the review screen show for each? |
| **Needed** | Observed file naming per provider on macOS and Windows; a comparison and merge flow that never chooses silently. |
| **Blocks** | spec 002 sync tasks |
| **Owner** | spec 002 |

### D-113 · Conversations and checkpoints on disk

| | |
| --- | --- |
| **Status** | Open |
| **Question** | One JSONL file per thread, plus per-turn checkpoints as patch files? What are the retention and size limits for a 250k-word book? |
| **Tension** | Full snapshots are simple but huge; patches are small but fragile if a later turn rewrites the same lines. |
| **Needed** | A storage spike with a realistic turn sequence, plus a pruning rule the author can see. |
| **Blocks** | spec 002 agent history tasks |
| **Owner** | spec 002 |

### D-115 · Updates and signing for the hackathon

| | |
| --- | --- |
| **Status** | Deferred |
| **Question** | Do we notarise, and do we ship auto-updates in the hackathon build? |
| **Trigger to revisit** | A public download page, or the first external tester on macOS. Until then builds are unsigned and labelled as such. |
| **Blocks** | nothing in v1; spec 009 |

### D-116 · Cost and usage cap enforcement

| | |
| --- | --- |
| **Status** | Proposed |
| **Recommendation** | Show provider-reported cost per turn; enforce a per-turn and per-session ceiling the author sets; refuse to start a batch (images, long agent runs) whose estimate exceeds the remaining ceiling. |
| **Needed** | Acceptance, plus what to do when the provider reports no price. |
| **Blocks** | spec 011 usage tasks, spec 002 image batch |
| **Owner** | spec 011 |

### D-117 · iOS through Capacitor

| | |
| --- | --- |
| **Status** | Proposed |
| **Recommendation** | Ship iOS later by wrapping the planned web build in Capacitor, which runs the same React app in WKWebView. Add a native storage adapter: the Filesystem plugin keeps the library in the app's Documents folder, SQLite holds the rebuildable index, and Keychain holds provider keys. Authors reach the folder through the Files app and iCloud Drive, so sync still needs no account with us. Reuse the core and UI; no Electron code reaches iOS. |
| **Needed** | After spec 010 produces a web build: point Capacitor's `webDir` at it, then spike the Filesystem, SQLite and Keychain plugins, iCloud container and security-scoped bookmark behaviour, WebView storage durability under pressure, OpenRouter from the Capacitor origin, and Apple review notes for a local-first writing app. |
| **Blocks** | nothing in v1; spec 010 (web build) is the prerequisite; a future spec 014-mobile |
| **Owner** | later |

**Update (2026-10-24).** Expo Simulators can host any `iphonesimulator` `.app` or Android `.apk`, so it can test a Capacitor build without adding Expo or React Native to the app. It is a limited-access preview for select partners, billed per session, and not included with Expo plans. Use it as a remote device lab when access is granted; otherwise use the local Device hub after installing a simulator runtime.

**Update (2026-10-24, later).** The shell spike passed. Capacitor 8.5.3 built with Swift Package Manager, installed and launched on the iPhone 17 Pro simulator with the iOS 26.5 runtime; the bundled page rendered in WKWebView. See [the spike note](research/capacitor-ios-spike.md). This validates the shell, not the studio renderer or the Filesystem, SQLite, Keychain and iCloud plugins, which wait for spec 010's web build.

### D-118 · Mobile device testing (Device hub and Expo Simulators)

| | |
| --- | --- |
| **Status** | Proposed |
| **Recommendation** | Keep Expo out of the app stack: the studio is a DOM app and ships through Capacitor, not React Native. Use Expo Simulators only as a remote device lab when access is granted; it installs any `iphonesimulator` `.app` or `.apk`, gives agent control and a browser preview, and needs no Expo dependency in the app. A local iOS runtime is now installed (iOS 26.5 under Xcode 26.6); use it through `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl` or the Simulator app. Android still needs Java, the emulator package and a system image. |
| **Needed** | Agent device access enabled in Device hub for the T3 simulator tools; Expo Simulators waitlist or partner access and billing approval if a remote lab is wanted; a Capacitor iOS build from the web target. |
| **Blocks** | nothing in v1; spec 010 (web build) is the prerequisite; a future spec 014-mobile |
| **Owner** | later |

**Update (2026-10-24, later).** The local iOS path is ready: Xcode 26.6 installed the **iOS 26.5 (23F77)** simulator runtime, `simctl` created the standard device set, and **iPhone 17 Pro** boots and screenshots successfully. `Simulator.app` is open. The runtime lives under `/Applications/Xcode.app`; commands need `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` because `xcode-select` still points at Command Line Tools. Agent device access in Device hub remains off, so T3's `device_*` tools cannot drive the simulator yet; CLI `simctl` works without it. Disk headroom after cleanup is about 61 GiB.

### D-119 · Mobile reference devices

| | |
| --- | --- |
| **Status** | Accepted |
| **Decision** | Design and verify against **iPhone 393 × 852** and **iPad mini 744 × 1133** first; desktop remains supported at 1440 × 900. The layout breakpoints are 700px and 1000px: below 700px is one column with a bottom bar and drawer, 700–999px keeps the chapter rail, and 1000px and above is the three-pane desktop workspace. The mobile shell is Capacitor; Expo and React Native are not part of the stack. |
| **Evidence** | Responsive layouts implemented and captured at all three sizes; Capacitor 8.5.3 shell launched on the iPhone 17 Pro simulator. Spec [014-mobile](../specs/014-mobile/spec.md). |
| **Blocks** | nothing; the web build (spec 010) is still required before the real renderer runs in Capacitor |
| **Owner** | spec 014 |

### D-120 · Sync journal and drift baseline

| | |
| --- | --- |
| **Status** | Proposed (implemented as recommended) |
| **Question** | What is the baseline for “changed on another device”, and how are deletions, renames and placeholders represented without a server? |
| **Recommendation** | A per-device journal under `.studio/sync/<deviceId>.json` records the last observed hash and the hash this device last wrote. Drift is a read-only comparison; deletions are tombstones; a missing/corrupt journal falls back to a full comparison with a warning. Timestamps are display-only. |
| **Needed** | Author acceptance. The harness results and corrupt/stale-journal tests are recorded below. |
| **Evidence** | `packages/core/src/sync/` journal, scan and detector; 14 unit tests; 10 two-system scenarios in `apps/desktop/tests/sync/`; a trash move is a deletion, not a rename; a copied journal with another device id is ignored. Device identity inside a synced folder is tracked as D-124. |
| **Blocks** | spec 016 T006–T007 (the review UI) |
| **Owner** | spec 016 |

### D-121 · App lock scope and PIN policy

| | |
| --- | --- |
| **Status** | Proposed |
| **Question** | Is the lock a UI gate or an encrypted vault, and which biometric/passcode/PIN policy applies on macOS and iOS? |
| **Recommendation** | A UI gate using LocalAuthentication at launch and resume. Optional 6+ digit PIN verifier in the keychain (`ThisDeviceOnly`, random salt, slow KDF, attempt limit). No encryption-at-rest claim in v1; files remain readable by Finder/CLI/agent. No recovery code. The iOS plugin choice is part of this decision. |
| **Needed** | macOS LocalAuthentication probe from Electron main, Capacitor/iOS plugin review, security review of the PIN verifier, and a UX check of cancel/lockout states. |
| **Blocks** | spec 016 T008–T011; spec 014 device checks |
| **Owner** | spec 016 |

### D-122 · Sync providers and placeholders

| | |
| --- | --- |
| **Status** | Proposed |
| **Question** | Which locations ship in v1: iCloud Drive, Google Drive mounted folder, local folder — and how are online-only files handled? |
| **Recommendation** | v1 is folder-based: local, iCloud Drive (macOS/iOS Files), and Google Drive through its desktop-mounted folder. No OAuth/API. Placeholders are materialized or reported as “not downloaded”; never read as empty. Direct cloud APIs wait for a separate decision. |
| **Needed** | Real probes for iCloud eviction and Google Drive placeholders, iOS security-scoped bookmark persistence, and the exact conflict-copy names. |
| **Blocks** | spec 016 T012; spec 014 iOS folder access |
| **Owner** | spec 016 |

### D-123 · Drift conflict resolution UX

| | |
| --- | --- |
| **Status** | Proposed |
| **Question** | When both devices changed a chapter, does the studio keep file copies, offer a chapter-level review, or attempt an automatic merge? |
| **Recommendation** | Preserve both versions, group the report at chapter level, and offer review / keep disk / keep mine / open both / export. No automatic prose merge in v1; agent-assisted merge is a later opt-in. |
| **Needed** | Author testing with concurrent edits and a check against the existing save-conflict and agent-checkpoint flows. |
| **Blocks** | spec 016 T006 |
| **Owner** | spec 016 |

### D-124 · Device identity in a synced folder

| | |
| --- | --- |
| **Status** | Proposed |
| **Question** | `.studio/device.json` lives inside the folder the provider copies. If two installs read the same identity, both write `.studio/sync/<deviceId>.json` and the baseline stops being per-device. Where does identity belong? |
| **Recommendation** | Keep the authoritative device id in the host profile (Electron `userData`, browser origin storage), keyed by library; treat `.studio/device.json` as display metadata regenerated per install. The archive already excludes and regenerates it, so the rule stays consistent. |
| **Needed** | A desktop profile identity store with a migration from the current file, a browser adapter check, and a harness run that copies `.studio/device.json` and asserts the journals stay separate. |
| **Blocks** | Nothing yet; it constrains T006–T007 and the iOS pass. Until it is accepted, the drift report must not claim the journal is per-device. |
| **Owner** | spec 016 |

## Resolved browser decisions

### D-104 · OpenRouter OAuth redirect on desktop and web

| | |
| --- | --- |
| **Status** | Accepted |
| **Decision** | Desktop uses the ephemeral loopback callback. Web uses a same-origin redirect. Both use PKCE S256, validate and consume state once, exchange the authorization code once, and remove callback parameters from the visible URL/history after handling them. Manual key entry remains the fallback where OAuth cannot complete. |
| **Evidence** | Desktop happy path, wrong state, provider failure and cancel tests exist in `apps/desktop/tests/providers-service.test.ts`. Web callback is gated by the existing D-101 browser-access table and specified in [ADR 0011](adr/0011-browser-credentials.md). |
| **Blocks** | Spec 011 web connection tasks and spec 010 browser integration. |

### D-105 · Key storage in the browser

| | |
| --- | --- |
| **Status** | Accepted |
| **Decision** | Use an origin-scoped IndexedDB vault with explicit disclosure. Do not add a passphrase or claim OS-keychain-equivalent or encrypted-at-rest protection in v1. Forget removes the credential. Never export it, place it in the library, log it, or send it anywhere except the chosen provider after an author-requested action. |
| **Evidence** | IndexedDB is origin-scoped, but same-origin scripts can access it; a Web Crypto wrapping key does not protect against compromised code running on that origin. Passphrase encryption adds a recovery secret without removing that risk. See [ADR 0011](adr/0011-browser-credentials.md), spec 011 US7 and spec 010 research. |
| **Blocks** | None. Spec 011 T037 implements this decision; spec 010 supplies the storage boundary. |

### D-112 · Portable archive format

| | |
| --- | --- |
| **Status** | Accepted |
| **Decision** | Use a versioned ZIP archive with `manifest.json`, normalized relative paths and per-file hashes. Preserve format-defined and unknown author files; omit only documented derived, transient and per-install data. Import only to a new library or empty chosen destination; reject unsafe paths, bad hashes and unsupported future versions before publication. Never merge or overwrite an existing library silently. |
| **Evidence** | See [ADR 0012](adr/0012-portable-library-archive.md), spec 010 research and contracts. The archive is a transport format; ordinary library files remain the source of truth. |
| **Blocks** | Spec 002 FR-056, spec 010 archive work and spec 013 build integration. |

### D-114 · Test runner boundaries

| | |
| --- | --- |
| **Status** | Accepted |
| **Decision** | Use Bun's test runner for pure core, adapters and component logic; use Playwright on Node for browser and Electron end-to-end runs; live provider checks stay explicit opt-in and spend-capped. |
| **Evidence** | Accepted in spec 012's 2026-10-24 clarification session. Electron packaging and Playwright remain on Node; Bun owns workspace tests. |
| **Blocks** | Spec 012 browser/Electron E2E and spec 010 adapter verification. |

## How an entry moves

1. `Open` → `Researching`: someone is gathering evidence; add findings under the entry or in `docs/research/`.
2. `Researching` → `Proposed`: write the recommendation and the alternatives considered.
3. `Proposed` → `Accepted`: the user accepts; if the decision is significant, write an ADR and link it.
4. `Accepted` → task: the spec that depends on it gets a task citing the decision ID.
5. If it later proves wrong: mark `Superseded`, keep the text, link the replacement. Do not delete history.

## Voice and background decisions (2026-10-26)

| ID | Status | Question | Decision | Evidence | Tasks |
| --- | --- | --- | --- | --- | --- |
| D-125 | Accepted | Does the studio keep the audio a dictation sends to Meta? | No. Audio exists in renderer and main memory for one request, is converted to the WAV Meta documents and is discarded. It is never written to the library, thread store, archive or a temporary file. A future kept-recording feature needs its own format, consent copy and deletion path. | `packages/core/src/providers/speech.ts`, `apps/desktop/src/main/voice.ts`, spec 017 FR-004 | 017 T001–T006 |
| D-126 | Accepted | What may a background turn do, and how does it reach the author? | A turn is background only when the author opts in for that turn. It notifies on finish, failure or an approval pause, focuses the window on click and never auto-approves a destructive tool. "Reach out" means a native notification, not email or a network message. A quit app stops all work. | `apps/desktop/src/main/background-copy.ts`, `background.ts`, `agent/runtime.ts`, spec 017 FR-010–FR-017 | 017 T008–T010 |
| D-127 | Accepted | Can the browser build dictate? | Not yet. The browser surface returns a specific refusal until Meta's browser access passes the D-101 table. Recording first and failing afterwards is forbidden. | `apps/web/src/runtime/browser-api.ts`, spec 017 FR-008 | 017 T006; D-101 browser test |

## Agent toolkit decisions (2026-10-26)

| ID | Status | Question | Decision | Evidence | Tasks |
| --- | --- | --- | --- | --- | --- |
| D-128 | Accepted | How can a standalone CLI or MCP client reach the open library without a second copy or a hosted service? | The desktop starts a loopback-only HTTP backend on a random port with a 256-bit per-run token, writes an owner-only locator at `~/.ai-book-studio/backend.json`, refuses browser origins and non-loopback Host headers, and removes the locator on quit. The toolkit is read-only by default; create and checked-save tools require `--allow-writes`. Every call goes through the open `Studio` and `Library`. | `apps/desktop/src/main/backend.ts`, `apps/toolkit/`, spec 018 FR-001–FR-014 | 018 T001–T010 |
| D-129 | Deferred | Should an agent reach the library remotely through a tunnel or hosted MCP endpoint? | Not in v1. Remote access would add authentication, custody and revocation; the loopback backend deliberately has no LAN listener. Revisit with a dedicated ADR if the toolkit needs a remote client. | spec 018 non-goals, D-128 | None |

## Illustration decisions (2026-10-26)

| ID | Status | Question | Decision | Evidence | Tasks |
| --- | --- | --- | --- | --- | --- |
| D-130 | Accepted | One image manifest or fields inside `book.json`? | A separate versioned `images.json` beside an `images/` folder. It keeps `book.json` small, gives the archive a clean diff and lets the image store serialize its own writes. | Spec 019; `packages/core/src/images/` | 019 T001–T008 |
| D-131 | Deferred | Multi-turn image editing, reference images and masks? | Not in v1. One-shot generation and the SAM cutout cover the demo; editing needs a conversation-state decision and a new cost model. | Spec 019 non-goals | None |
| D-132 | Accepted | Where is the cutout PNG composited? | In the renderer from the source image and the decoded binary mask, so the desktop adds no native image library. The result is saved through the image store as a `character` image with `cutoutOf`. | Spec 020 FR-007 | 020 T004 |
| D-133 | Deferred | Manual box/point SAM prompts? | Not in v1. Concept prompts plus an author-selected match are enough for the demo; manual prompts need a canvas coordinate UI and the documented token builder. | Spec 020 non-goals | None |

## Licensing decisions (2026-10-26)

| ID | Status | Question | Decision | Evidence | Tasks |
| --- | --- | --- | --- | --- | --- |
| D-137 | Accepted | May the desktop use Meta's `@meta-sam/parser` when the project is Apache-2.0? | Yes for the hackathon build, with the SAM License included in `THIRD_PARTY_NOTICES.md` and the distribution. The feature is optional and desktop-only. Before a public release, review compatibility or replace the parser with a clean-room implementation; do not claim the repository is Apache-2.0 while silently shipping an incompatible dependency. | `THIRD_PARTY_NOTICES.md`, spec 020 FR-013 | 020 T007 and release review |

## Provider compatibility decisions (2026-10-26)

| ID | Status | Question | Decision | Evidence | Tasks |
| --- | --- | --- | --- | --- | --- |
| D-138 | Accepted | How does the app use Muse Spark 1.3 Contributor without sending an author's private book to a training-eligible model? | Contributor is opt-in per book (`allowContributorTraining`, default false). The model picker shows the training warning, prices and reasoning limit and requires a checkbox; `AgentRuntime` refuses the model before any request until consent exists. Contributor is for the synthetic fixture/public-domain tests; Standard is the default alternative. | `packages/core/src/providers/compatibility.ts`, `AgentRuntime.start`, `ModelPickerDialog`; spec 022 | 022 T001–T008 |
| D-139 | Deferred | Should the compatibility layer also be a local OpenAI-compatible HTTP endpoint? | Not in v1. `modelFor` is the one AI SDK seam. A network gateway needs caller authentication, streaming, tool execution and approval ownership; it would be a separate spec. | Spec 022 FR-014 | None |
| D-158 | Superseded | Is SAM 3.1 the way to make a character cutout? | No. The live request reaches Meta and is accepted — `200`, `status: completed` — but the response carries no records and no usage, on two real illustrations and a synthetic disc, with four different nouns, in the shape Meta's own segmenting guide documents. Whether that is an entitlement gap or a model the account cannot use, it is not something the studio can fix, and the cutout was never on the critical path. Spec 020 is superseded: the code stays where it is and is tested, but nothing is built on it and the submission does not claim a cutout. | `docs/research/live-meta-2026-10-26.md`, spec 020 |
| D-159 | Accepted | How does the agent speak? | A provider seam for text-to-speech, with OpenAI's `/audio/speech` as the first adapter, and the browser's own `speechSynthesis` as the fallback when no voice service is connected. A chapter is longer than one request, so the pipeline splits the text at sentence boundaries and joins the audio back into one sound that plays and stops as a whole. The voice is a per-call choice, so a passage and a notification can sound different. | `packages/core/src/providers/tts.ts`, `apps/desktop/src/main/speech.ts`, `packages/app/src/hooks/use-speech.ts` |
| D-160 | Accepted | How does the author's own book reach the glasses? | The phone is the server and the glasses the client, through Meta's Device Access Toolkit: the toolkit sends UI content over Bluetooth and routes the interactions back. It is the only route that keeps the author's own book private (D-156, D-157): a Web App cannot read a private network, and a hosted copy is out of the question. The studio stays the only writer; the phone is a display and a remote control. | `apps/desktop/src/main/bridge.ts`, spec 026 | 026 T015–T018 (native companion) |
