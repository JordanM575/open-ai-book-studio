# Testing

Three layers, and each one catches what the others cannot.

| Layer | What it proves | Command | Cost |
| --- | --- | --- | --- |
| **Unit** | The library, the providers, the tools, the schema — in process, no app | `bun test` | seconds |
| **Coverage** | That the unit layer has not quietly thinned out | `bun run coverage` | seconds |
| **End to end** | The built app, a real browser, a separate process | `bun run e2e` | under a minute |
| **Live** | A real provider, a real key, a real cost | `bun run live:check` | a few cents |

A change is not done because the tests pass. It is done when `bun run verify` and `bun run e2e`
both pass, and — if it touches a provider — `bun run live:check` still does.

`bun run verify` is the fast command and it has teeth: the whole command must finish within
5 minutes and the suite gate within 20 minutes on the reference machine (spec 012 T029,
FR-024/FR-025), or the run fails even when every gate passed. The summary prints the budget
line every run, so a slowing suite shows up before it breaches.

The slow checks stay out of the fast command on purpose. Each is marked here with the
command that runs it: `bun run smoke` (hidden desktop smoke), `bun run smoke:web` (web
journey), `node scripts/browser-matrix.mjs` (multi-engine findings), `bun run a11y`
(accessibility scans), `bun run visual` (visual baselines), `node scripts/e2e.mjs` (the
all-up run), `bun run smoke:packaged` (packaged app), and `bun run release` (the release
gate). `bun run live:check` is further out still: opt-in, cheapest call, real cost.

## The unit layer

`bun test` runs 560-odd tests across the workspaces. They are fast and they cover the things that
have a contract: the library service, the Markdown format, the conflict copies, the tool schemas,
the chunking rules, the schema migrations.

Two of them are worth knowing about because they guard decisions rather than functions:

- a book written **before** a setting existed still opens, so a new setting can never lock an author
  out of their own library;
- the committed sample library opens with the current schema, which is the same promise made with
  real data.

## The coverage ratchet

`bun run coverage` measures the unit layer and fails below a floor: **85% of functions, 92% of
lines** at the time of writing, against a measured 86.0 and 93.0. The floor only moves up — a
change that raises coverage is expected to raise the floor in the same commit — and a change that
drops it below the floor has to say why.

Bun does not fail a run on coverage by itself, so the script reads the summary it prints. Coverage
is not a goal in itself; it is a way of noticing that a change removed more test than it added.

## The end-to-end layer

`bun run e2e` builds the desktop app, the web build and the toolkit, then runs seven checks in
order:

| Check | What it drives |
| --- | --- |
| `smoke` | The built app through its own renderer: the preload bridge, the library, editing, autosave, undo, chapter moves, **a Word export with its illustration**, a Markdown export, a rename and a delete. |
| `web` | The browser build over its own storage: create, save, reopen, conflict copies, a portable archive, reduced motion. |
| `audit` | The real window at 1440×900 for dead ends, missing controls, console errors, and the accessibility basics: every control named, big enough to hit, every image with an `alt`, one `h1`, and a keyboard that reaches something with a visible focus ring. |
| `phone` | The same walk at 390×844, because the phone layout is a surface people use and it has its own ways to strand someone. |
| `glasses` | The 600×600 page for Meta Ray-Ban Display, in a browser at that size: the book, the passage, no scrolling, the D-pad, a write that asks first, and — with a stub model context — the tools the page hands an assistant, and one of them called through the assistant's own path. |
| `ambient` | The ambient agent over the control plane, and the toolkit saying the same thing. |
| `plugins` | A folder of TypeScript tools, loaded by the built app, called, and a broken plugin that must not take the others with it. |
| `bridge` | The phone's half: a **separate process** speaking to the running app over the local network with the per-run token. |

Run one, or a few:

```bash
bun run e2e smoke bridge
bun run e2e --no-build        # trust the current build
```

### Why these are separate from the unit tests

They all need something a unit test cannot have: a real Electron window, a real Chromium at
600×600, a real second process on another address, or a real docx on disk. The export check
unzips the file it produced and looks for `word/media/`, because the thing that goes wrong is
never the writer's opinion of what it wrote.

## The live layer

`bun run live:check` runs **inside the app**, so it uses the key from the operating system's
keychain through the app's own vault. It copies the committed sample into a temporary folder, works
there, and deletes it, so the author's own book is never opened.

| Check | What it proves |
| --- | --- |
| The catalogue | Nine models, including the Contributor and Muse Image |
| A writing turn | The agent replied **and the file on disk changed** |
| Dictation | The check speaks a known phrase and scores the transcript against it — nine of nine words |
| Speaking | Real audio, measured, not just bytes |
| Muse Image | A real PNG at 1024×1024 |
| SAM 3.1 | Blocked on the model's availability for the key, recorded as blocked rather than failed |

A `blocked` result is an account fact, not a defect. The distinction is deliberate: only one of the
two is the studio's problem.

**The trap.** A coding agent's shell can install a `fetch` shim through `NODE_OPTIONS`, routing
outbound requests through a proxy that authorises only the agent. Every check script spawns the app
with `{ ...process.env }`, so the app inherits it, and every provider request comes back as
`{"error":"unauthorized"}` — an error indistinguishable from a bad key. The scripts clear
`NODE_OPTIONS` and the `HEADROOM_*` variables first. A check must measure the product, not the
agent's proxy.

## Where it is still thin

The floor is a ratchet, not a ceiling. At the time of writing these are the modules below 70% of
lines, and they are the honest answer to "what is not covered":

- `packages/app/src/components/ManuscriptEditor.tsx` — the editor's formatting and paste paths.
  History, debounce and save are covered; the rest needs a real contenteditable.
- `packages/app/src/components/VoiceButton.tsx` and `packages/app/src/lib/cutout.ts` — both draw on a
  canvas or an audio element that the test DOM does not provide.

Everything else in the product is above 80% of lines, and the workspace as a whole is at 93.0%.

## What is not covered

- **The film.** Capturing it is a person at a screen, and no test makes that true.
- **A real phone.** The bridge's Mac half is proven from another process; the app on the phone is
  not written.
- **The glasses themselves.** The page is proven at 600×600 in a browser and cannot be proven on
  the hardware from here.
- **The microphone permission prompt, the 401 path, a notification with the window closed.** These
  need a person and a signed build; the task ledgers record them as outstanding rather than
  pretending otherwise.
- **Audio output through a speaker.** The pipeline is proven to produce real audio; whether a
  speaker plays it is not something a check can hear.
- **Linux.** Every end-to-end check has been run on macOS. `.github/workflows/verify.yml` has a job
  for them on Linux, and it is allowed to fail until somebody has watched it pass and said so. The
  typecheck, tests, builds and the coverage floor run everywhere.
