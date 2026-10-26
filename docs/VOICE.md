# The voice pipeline

The studio both listens and speaks. This page is how, and why the two halves are separate.

## The loop

```
   the author speaks
          │
          ▼
   microphone ──▶ WAV 16 kHz mono ──▶ Muse Voice Transcribe ──▶ text
                                                                 │
                                                                 ▼
                                                        the writing agent
                                                                 │
                                                                 ▼
   the glasses' speaker ◀── audio ◀── text-to-speech ◀──── the reply
```

Listening and speaking are different providers with different contracts, so they are different
modules: [`speech.ts`](../packages/core/src/providers/speech.ts) listens, and
[`tts.ts`](../packages/core/src/providers/tts.ts) speaks. The voice pipeline is the two of them
either side of the agent.

## Listening

Meta's file endpoint takes a multipart body — a JSON `request` part and a WAV part — and returns a
transcript with turn timings. The studio validates the container before spending a request: RIFF/
WAVE, 16-bit PCM, mono, 16 kHz or 24 kHz, up to ten minutes and 32 MB.

The recording never touches disk. It is read in the main process, sent, and the text comes back.

**Live evidence:** the check speaks a known phrase with macOS `say`, converts it to the shape Meta
accepts, and scores the transcript against the phrase. All nine words matched. See
[`docs/research/live-meta-2026-10-26.md`](research/live-meta-2026-10-26.md).

## Speaking

OpenAI's `/audio/speech` takes a JSON body and returns audio. The studio asks for MP3, a named
voice, and optionally an instruction about how to read — which only the `gpt-4o-mini-tts` model
understands, so it is omitted for the older ones rather than silently ignored.

### Two services, and they are not the same thing

| | A text-to-speech endpoint | A speech model asked to read |
| --- | --- | --- |
| **Provider** | OpenAI — `POST /audio/speech` | OpenRouter — a chat completion with `modalities: ["text","audio"]` |
| **Model** | `gpt-4o-mini-tts` | `openai/gpt-audio-mini` |
| **What it does** | Takes the words, returns audio. It will not change them. | Takes the words as a message and *reads* them. It can deviate. |
| **Returns** | MP3 | 24 kHz mono 16-bit PCM, streamed as events |
| **Cost, a sentence** | — | about **$0.0002** |

The second is honest about what it is: the words go in as an instruction — *"Read the following
aloud exactly as written, adding nothing"* — and a model decides how to obey it. It can paraphrase,
or add a greeting. That is why OpenAI stays the default voice, and why the cheap path is the one
the check runs often. Both are behind the same seam, and the caller does not have to care which.

Nothing about the cheap path is hidden from the reader of the audio: it is the same pipeline, the
same chunking, the same joined sound.

### The PCM the cheap path streams

The service refuses any audio format but `pcm16` while streaming, so it does not send a file. The
studio wraps the samples in a 44-byte RIFF/WAVE header itself, at the sample rate the capability
names, so the renderer still gets one playable sound. A malformed event in the stream is skipped
rather than thrown, because one bad line must not lose the audio that did arrive.

### A chapter is longer than one request

One request carries at most 4,000 characters. A chapter is several times that. So the text is
split at **sentence boundaries**, sent in order, and the audio is **joined back into one sound** —
MP3 frames concatenate, so the caller plays one thing and stops one thing.

The splitting rules are deliberate:

- A sentence is never cut in the middle.
- A single sentence longer than the limit is split on **word** boundaries, so no word is broken.
- An enormous single word is cut rather than allowed to loop, because it cannot be prose.
- **Nothing is dropped.** A truncated sentence is a wrong sentence, so the last chunk is short
  rather than clipped.

`chunkForSpeech` is a pure function with tests for all four rules, and one of them asserts the
joined chunks have exactly the same number of words as the input.

### Two voices, and the better one wins

| Voice | When | What it sounds like |
| --- | --- | --- |
| **A voice service** | A connection can speak — OpenAI today | The same voice on every surface, told how to read, independent of the machine |
| **The device's own** | No voice service is connected | The operating system's voice. Free, no key, different on every computer |

The renderer's `useSpeech` picks the first and falls back to the second. It also reports which one
it is using, so the panel can say "Speaking with this computer's own voice" rather than pretend.

**Either way the words are on the screen.** Someone who cannot hear, or who is in a room they do
not want to talk in, still gets them. Speaking is an addition to the interface, never a
replacement for it.

### Where the voice comes from

The key lives in the operating system's keychain, through the app's vault, like every other
connection. Settings → Provider connections → **OpenAI** for the studio's voice, or **OpenRouter**
for the cheap one. Nothing reads a key from `.env` at runtime: that file is for the check scripts,
so a key never sits in plaintext next to the code.

OpenRouter is optional, and it is there because a check that runs on every change should not cost
a dollar. A user who never adds it gets the device's own voice and nothing breaks.

## The panel

The minimal mode's **Read aloud** and **Where am I?** both go through the pipeline. When a voice
service is connected, the panel offers the voices; when it is not, it says which voice it is using
and where to change it.

## What is not built yet

- **Barge-in.** Speaking while the author talks over it needs the microphone to stay open during
  playback, which is a capture and echo-cancellation decision rather than a TTS one.
- **Speech-to-speech.** Both halves are turn-based: a recording, then a reply. A continuous
  conversation needs a streaming protocol neither provider offers here.
- **The glasses.** The voice reaches the glasses through the phone, in the Device Access Toolkit
  slice. Web Apps cannot use the microphone at all.

## Verification

- `bun test packages/core/tests/tts.test.ts` — the chunking rules, the request body, joining.
- `bun test apps/desktop/tests/speech.test.ts` — one request, many requests joined, the voice and
  speed, an empty reply, a refused key, an unreachable service.
- `bun run live:check` — speaks a sentence, and measures it. A file of the right size proves
  nothing, because a service that returns silence returns a file, so the check computes the root
  mean square of the 16-bit samples and reports it. The cheap path measured **level 2967**: speech,
  not silence.
