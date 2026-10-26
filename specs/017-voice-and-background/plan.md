# Plan: voice notes and background runs

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Shape

Two independent features share one seam: the Electron main process already owns the provider
credential and the agent turn. The renderer never sees a key, and audio never needs the library.

```
packages/core/src/providers/speech.ts     WAV checks, Meta request form, response parser
apps/desktop/src/main/voice.ts            credential lookup, HTTP request, error normalization
apps/desktop/src/main/background.ts       outcome -> notification copy and focus
apps/desktop/src/main/agent/runtime.ts    background flag + outcome callback
packages/app/src/lib/audio.ts             decode, mono mix, resample, WAV encode
packages/app/src/hooks/use-dictation.ts   microphone lifecycle and transcription call
packages/app/src/components/VoiceButton.tsx
packages/app/src/components/ManuscriptEditor.tsx  insert at the caret
packages/app/src/components/ChatPanel.tsx        background opt-in per turn
```

## Voice path

1. The author presses the microphone. `useDictation` calls `getUserMedia({ audio: true })` and starts a
   `MediaRecorder`.
2. Stop collects the chunks, decodes them with `AudioContext.decodeAudioData`, mixes to mono, resamples
   to 16 kHz and writes a 16-bit PCM WAV in memory.
3. The renderer calls `window.studio.voice.transcribe`. The preload sends the `ArrayBuffer` over IPC.
4. The main process picks the first Meta connection, validates the WAV, builds the multipart request and
   posts it to `https://api.meta.ai/v1/asr/transcribe` with the stored bearer token.
5. The service returns the transcript, provider and duration. The renderer inserts it at the selection
   and lets the existing editor save path run.

No audio is persisted. The main process rejects before the request when the header, sample rate, size
or duration is wrong. The form uses the provider's documented `request` JSON part and `audio` WAV part,
not the OpenAI `file`/`model` shape.

The web build exposes the same `window.studio.voice` surface but returns a specific refusal. The button
is hidden or disabled with that reason; it never records audio first.

## Background path

`AgentTurnInput.background` is optional. The runtime stores it with the active turn and calls an
outcome callback after `done`, `error`, `stopped` or an approval pause. The callback carries the book
title, thread id, changed chapter count, a short text preview and the outcome kind.

`BackgroundNotifier` decides whether a notification is warranted: an explicit background turn, or any
turn while the window is hidden or unfocused. It uses Electron's `Notification` and the dock badge,
and focuses the existing window on click. It never opens a second window or a URL.

An approval pause is not a finish. The runtime persists the pending approval as it does today and the
notifier sends a "needs you" message. Auto-approval is forbidden by the spec.

## Failure and privacy

- Provider errors go through `normalizeProviderError`, then `redact`; the message never contains the
  key or a request body.
- A 32 MB / 10 min check runs before the network. The service also rejects non-WAV bytes.
- The transcript is ordinary editor text, so an external disk change still reaches the normal conflict
  path. Voice does not write a file directly.
- The background run uses the same thread, checkpoint and usage stores. There is no second job
  database and no resume token to leak.

## Verification

- Unit: WAV header/sample checks, form construction, response parsing, provider selection, error
  mapping, notification copy and the background decision.
- UI: editor test that a transcript is inserted at the caret and marks the draft dirty.
- Manual: speak one paragraph through the Meta key; close the window during a turn and confirm the
  notification, thread and usage record.
- Build: `bun run typecheck`, `bun test`, `bun run build`, `bun run build:web`.
