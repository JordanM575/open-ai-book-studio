# Product film script

**Version:** draft 2, 2026-11-03.
**Status:** **Approved for recording** (2026-11-04, the author delegated the approval). Lock the timings
after the narration is recorded.
**Target:** 2:50–3:00 master. Read the voice at 145–160 wpm; the narration is about 320 words, which
leaves room for live actions. Timings are targets. Lock them after the narration is recorded.
**Voice:** recorded by the author or founder. A licensed synthetic voice is allowed if the disclosure
note goes in the description. Never clone a third party.

## The event-scope rule

The hackathon rules say the demo highlights only work built during the event, and that judges must be
able to tell what was created then. So the film:

- puts all pre-event context in **one opening segment**, labelled on screen "Built before the event";
- tags every other segment "Built during the event";
- names only the event-built part of each shot in the voiceover and the on-screen text.

Some event shots have older parts on screen, such as the agent loop, the tool lines, checked saves,
undo and the Word export itself. The film shows those parts but never names them.

The event began at the cut tag `meta-base-2026-10-26`; in the public repository the cut is the first
commit, the labelled baseline.

| Time | Picture | Voiceover | On-screen text | Built | Live |
| --- | --- | --- | --- | --- | --- |
| 0:00–0:25 | Motion plate: a chat window, and beside it a folder of chapter files, with an arrow marked copy · paste between them. The studio opens on the sample library, and Finder shows the book's folder: `book.json` and `chapters/`. | Most AI writing tools give you a chat window, and the book lives somewhere else. So you copy, you paste, and you hope nothing is lost. AI Book Studio starts from the other side: every book is a folder of Markdown files that you own. Everything after this was built during the hackathon. | “The book is somewhere else.” → “A folder, not an account.” | **Before the event** | No |
| 0:25–0:43 | One turn already on Muse Spark 1.3. Open the model picker and choose **Muse Spark 1.3 Contributor**. It warns that it may train on what you send and refuses until the book opts in. Tick the opt-in, then ask for the next scene. The divider reads “Now answering with Meta · Muse Spark 1.3 Contributor”. | Muse Spark 1.3 Contributor may train on what you send, so the studio refuses it until this book opts in. Opt the sample book in, ask for the next scene, and the conversation names the model that answered. | “Contributor stays off until the book opts in.” | During | **Meta** |
| 0:43–1:01 | Header bot icon → the **Agent** dialog: calls and successes per tool. Switch off `find_in_chapter`. In a terminal, `bookwriter call <bookId> find_in_chapter --allow-writes --args '…'` prints “find_in_chapter is turned off for this book. The author withdrew it.” | The Agent panel counts every tool call and how often it worked. Turn a tool off for this book, and it is refused everywhere: by the model, the command line and any MCP client. | “One switch: the model, the CLI and MCP.” | During | No |
| 1:01–1:15 | The manuscript's microphone button: recording, then the transcript inserted at the caret. | When typing is in the way, dictate. Muse Voice Transcribe puts your words at the caret, and the audio is not kept. | “Dictate with Muse Voice Transcribe.” | During | **Meta** |
| 1:15–1:29 | The strip at the bottom of the workspace (“The writing agent, in brief”): press **Say where you are** and the status is read aloud. Open the agent's actions, tap the microphone, ask a question out loud, and the reply appears and is spoken. | Step back from the keyboard and a small strip keeps you oriented: where you are, what changed, what it would do next. Ask out loud, and it answers out loud. | “Listens with Muse Voice Transcribe · speaks with OpenRouter text-to-speech.” | During | **Meta + OpenRouter** |
| 1:29–1:45 | Tick **Background** in the composer and send. Close the window. A notification arrives (“The Salt Road — ready”, previewing the reply); click it, and the window reopens on the finished conversation. | Tick Background and close the window. The agent keeps working, and a notification tells you when the scene is ready, or when it needs your approval. | “It keeps working after you close the window.” | During | **Meta** |
| 1:45–2:03 | The illustration dialog for a chapter: the prompt, then **Generate · $0.01**; the new image appears (“1024×1024 · muse-image-1.0”) and is attached. **Export Word document**; Quick Look in Finder shows the illustration in the document. | Illustrate a chapter with Muse Image. The price is on the button before you spend anything, and the picture goes with the chapter into the Word export. | “Muse Image, carried into the Word export.” | During | **Meta** |
| 2:03–2:19 | Terminal beside the studio: `bookwriter books`, `bookwriter tools`, then `bookwriter read <bookId> <chapterId>` showing the scene from 0:25. `bookwriter mcp` reports “AI Book Studio MCP server on stdio”. | Because the book is files behind one careful writer, other agents can work on it too. The bookwriter command line and its MCP server read and save the same open book, with the same checks. | “CLI and MCP. The same book, no second copy.” | During | No |
| 2:19–2:29 | Wi-Fi off; send a turn. The conversation says “You are offline. Your words are safe — writing, planning and exporting all still work.” The request stays ready to retry. | When something goes wrong, the studio says so in plain words, and keeps what you typed. | “Plain warnings. Nothing lost.” | During | No (Wi-Fi off) |
| 2:29–2:40 | The 600×600 glasses page, served by the studio, in a 600×600 browser window. | And the same status is ready for a glasses display: six hundred pixels square, one glance at a time. | “Shown at glasses size. Not filmed on glasses.” | During | No |
| 2:40–3:00 | Finder: the book's `images/` and `images.json` (added during the event), and the exported Word file outside the library. The close card follows. | Everything in the middle was built during these nine days. The book is still a folder you own. Your book. Your files. Your agent. | “Your book. Your files. Your agent.” / “AI Book Studio” | Close | No |

## Capture tonight

**Before anything else, run the live check.** Run `bun run keys:check --strict` with the author's keys,
then one short Muse Spark turn in the throwaway profile.

- Meta's base URL has changed before, so take it from Meta's developer console.
- If no Meta model answers, there is no film to record: the event requires the product working with
  Meta models.

**Setup:**

1. Run `rm -rf video/fixture/library && bun run film:fixture`, then copy the library to a folder outside
   your home folder, so no path on screen shows your name.
2. Start a throwaway profile: `STUDIO_TEST=1 STUDIO_VISIBLE=1 STUDIO_USER_DATA=/tmp/film-profile bun run dev`.
3. Add the Meta connection and label it **Meta**. Add an OpenRouter connection for the strip's voice.
4. Turn on a Focus mode that allows only AI Book Studio's notifications. Hide the menu bar clock and
   personal items.
5. Record the app at 1440×900, at 2× and 30 fps.

**Order and fallbacks.** Record in this order, because the Agent panel's numbers come from the turns
recorded before it. If a live shot fails, cut the shot **and its line**. Never fake a response, a save
or a notification.

| # | Shot | Needs | If it fails |
| --- | --- | --- | --- |
| 1 | 0:25 turn on Muse Spark 1.3, then the Contributor opt-in turn | Meta key; the Contributor model on the account | Keep the Muse Spark 1.3 turn and cut the Contributor lines. If no Meta model answers, stop. |
| 2 | 0:43 Agent dialog and the CLI refusal | The turns from shot 1 | Show the switch only; cut “from the command line” |
| 3 | 1:01 dictation | Meta key; microphone permission for the app | Cut the shot and its line |
| 4 | 1:15 the strip | Meta key and OpenRouter key | Cut the shot and its line |
| 5 | 1:29 background turn and notification | Meta key; the Focus mode allows the studio | Cut the shot and its line |
| 6 | 1:45 illustration and Word export | Meta key with Muse Image | Cut the shot and its line. Never show the fixture's images as Muse Image output. |
| 7 | 2:03 CLI and MCP | The studio open on the fixture | None needed |
| 8 | 2:19 offline warning | Wi-Fi off for a moment | Cut it (second in the cut order) |
| 9 | 2:29 glasses page | The studio's loopback backend (see `scripts/glasses-check.mjs`) | Cut it (first in the cut order) |
| 10 | 0:00 library and Finder; 2:40 Finder | Nothing live | None needed |

**If time runs short, cut in this order:** the glasses page, the warning, the strip, and the vertical
cut. Only the 3:00 master is required.

## Not claimed

The film makes none of these claims:

- **SAM cutouts.** They were retired by D-158.
- **Kindle or KDP acceptance.**
- **Code signing.**
- **A real glasses run.**
- **A prompt-cache hit rate.** The Agent dialog may show whatever the build really reports, but the
  narration and on-screen text never quote it.
- **The fixture's images as Muse Image output.** The sample's images are drawn by the fixture
  generator, and the character image (recorded as a cutout) never appears.

## Notes for the read

- Use the first person for the agent and the second person for the author. Use “we” only for storage
  and privacy.
- Pause after “that you own” and before the close.
- Say “Markdown” plainly. Do not explain hashes.
- Credit the strip's spoken voice to OpenRouter, never to Meta.
- If a shot is cut, cut its line.

## Disclosure

If the narration is synthetic, add to the video description:

> Narration generated with [provider and voice]. Captions transcribed with Muse Voice Transcribe.
> Music: none.
