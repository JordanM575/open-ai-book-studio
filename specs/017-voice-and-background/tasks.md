# Tasks: voice notes and background runs

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Tasks are ordered. `[P]` means it can run in parallel with the other `[P]` tasks in the same phase.
A task blocked on an open decision must not start until it is accepted.

## Phase 1 — Speech contract

- [x] T001 Add `packages/core/src/providers/speech.ts`: Meta endpoint and model constants, WAV header
  and duration validation, multipart request construction, response parsing and typed transcript.
  Export it through `./providers/*`; cover valid, truncated, stereo, wrong-rate and non-WAV input.
  `speech.test.ts` has 12 cases; `speechForm` sends the documented `request` JSON and `audio` WAV parts.
- [x] T002 Add `VoiceService` in `apps/desktop/src/main/voice.ts`. Select the first Meta connection,
  read the secret only in main, post the form with a timeout, normalize provider errors and return the
  transcript plus duration. `voice-service.test.ts` covers the form, auth mapping, non-WAV refusal and
  connection selection with a memory vault and a mocked `fetch`.

## Phase 2 — Microphone and editor

- [x] T003 Add `packages/app/src/lib/audio.ts`: decode a recorded blob, mix to mono, resample to
  16 kHz, encode 16-bit PCM WAV. `audio.test.ts` covers the header, sample conversion and linear
  resampling without a browser.
- [x] T004 Add `useDictation` and `VoiceButton` with idle, requesting, recording, transcribing and
  error states, a 10-minute cap and a visible timer. The button is unavailable in the web build with
  the desktop-only reason.
- [x] T005 Insert the transcript at the textarea selection through the existing `applyText` path.
  The pure insertion logic is in `voice-text.ts` and tested for spacing, punctuation, selections and
  silence; the editor keeps the caret and marks the chapter dirty.

## Phase 3 — IPC and builds

- [x] T006 Add `IPC.voice.connections` and `IPC.voice.transcribe` to the core contract, preload,
  desktop handler and browser refusal. The desktop handler validates the connection id, audio size,
  language list and keyword list with Zod before the service.
- [x] T007 Add the macOS microphone usage string to `electron-builder.yml`, the audio-input
  entitlement and a main-process permission handler that allows only audio capture.

## Phase 4 — Background turns

- [x] T008 Add `background?: boolean` to `AgentTurnInput` and an outcome callback to `AgentRuntime`.
  The callback fires after `done`, `error`, `stopped` and an approval pause; the existing event stream
  is unchanged.
- [x] T009 Add `BackgroundNotifier`: notification copy, visibility decision, dock badge and
  focus-on-click. `background-copy.test.ts` covers the copy, preview, approval and stop rules.
- [x] T010 Wire the notifier in `index.ts` and add a per-turn "Background" control to `ChatPanel`.
  The control resets after each send and is not persisted on the book.

## Phase 5 — Evidence and docs

- [x] T011 Add the voice/background sections to `docs/ARCHITECTURE.md`, the audio decisions to
  `docs/DECISIONS.md` (D-125–D-127), the spec link to `specs/README.md` and the changelog entry.
- [ ] T012 Manual pass with a Meta key: dictate one paragraph, deny the microphone once, force a 401,
  close the window during a turn and confirm the notification and stored thread. Record the result in
  `docs/research/voice-and-background-2026-10-26.md`. Pending: this environment has no Meta key and a
  notification pass needs a signed or locally permitted macOS app.

## Dependencies

- T001–T011 are complete and need no live Meta key; the automated suite covers the contracts.
- T012 needs a Meta key and macOS notification permission.
- Realtime dictation, diarization UI and browser dictation wait for D-125–D-127.
