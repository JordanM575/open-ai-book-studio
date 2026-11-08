# ADR 0021: Explicit hands-free sessions and bound spoken actions

**Status:** Accepted, November 7, 2026, under delegated feature-delivery authority.
**Decision:** D-200. **Owners:** 017/038, with 031/037 control contracts.

## Selected contracts

1. **Activation/lifetime.** Start conversation is an explicit visible action after local capability
   and selected-route checks. Bind session to host/window/trusted top-level frame, library/book,
   chapter/thread, mode, destination and generation. No automatic capture on open/reload/settings.
   Stop listening, hide/close, lock, permission loss, library/book switch or process loss ends capture;
   reopening requires activation. A separate authorized 037 workflow may continue while mic is off.
2. **Utterances.** Local VAD segments in-memory PCM; silence is not uploaded. Initial tunable engineering
   defaults: 1.2s end silence, 250ms preroll, 60s utterance maximum. PTT retains its separate ten-minute/
   32MB contract. One STT operation in flight; explicit held/backpressure state instead of silent drops.
   States distinguish listening, processing, review-needed, speaking, interrupted, stopped/unavailable.
   No audio file or ambient transcript log; only deliberately submitted author text may be retained.
3. **Interruption.** Qualified near-end onset cancels/ducks playback and inhibits future dispatch locally,
   before STT. Already executing checked effects settle under D-178. Onset is not an edit command or
   proof of provider cancellation. Noise/no-match leaves an interrupted state until explicit Continue.
   Full-duplex requires measured echo/near-end qualification. Unqualified hosts clearly expose
   half-duplex plus keyboard/pointer interrupt; full-duplex remains retained acceptance work.
4. **Typed commands.** Distinguish Stop speaking, Pause work, Stop work, Stop listening, Read chapter,
   Next chapter, Repeat question, Correct that and Undo named change. Bare stop silences, inhibits and
   ends listening immediately. No confirmation is needed to stop/pause. Command mode is explicit;
   story dialogue containing “cancel” is not a control. Free-form questions use visible bound context
   and Discuss by default, never an inferred Edit mode.
5. **Confirmation/correction.** Recognized text stays visible with replace/discard/send controls.
   Exact-target readback and confirmation precede Edit, destructive approval, undo, destination change
   or workflow grant. Read-only questions may auto-send within the disclosed active session. Pending
   confirmation binds immutable command/target/source/digest and expires on scope/source/permission
   changes. Bare yes without that binding does nothing. Correction before send edits the pending draft;
   after send it inhibits future work, settles actual effects and creates new direction/turn. It cannot
   recall sent text. Dictation defaults to insertion at selection start, retaining selected text;
   Replace selection is explicit. Preserve intended newlines instead of collapsing verse whitespace.
6. **Cancellation.** Host-owned STT/TTS request IDs and session generations cancel transport best-effort,
   close future sends synchronously and stop every owned capture track/playback. Late results cannot
   affect a new session. Each TTS chunk rechecks pinned connection/model/voice/permission. Possibly sent/
   charged remains unknown, never free by assumption. No provider fallback or preference mutation.
7. **Permission.** Both Electron permission handlers require the actual studio webContents, expected
   trusted main frame/origin and active audio-only capture grant. Deny foreign/missing sender, subframe,
   camera/display and expired/inactive grants. OS permission remains separate; one denial ends the
   request without a prompt loop. Synthetic predicates precede live microphone qualification.
8. **Accessible reading/local input.** All states/questions have persistent text and keyboard controls.
   Stop speaking works during generation. Reading retains paragraph/source revision, supports qualified
   speed/system-voice selection and explicit device-voice choice. Unknown local recognition refuses;
   browser default recognition is not proof of local processing. On-device dictation remains retained,
   cloud route requires explicit opt-in, and failure offers explicit text/device choices without switching.
9. **Check-ins.** Use 037's question/run/character identity and direction revision. Voice answers are the
   same checked author intents as text, never an approval signature. Late answers lose to revoke/stop.
   Proactive speech occurs only within an activated speaking session; hidden-window notices are generic
   and the durable inbox retains the question. No separate voice scheduler or question store.

## Scope amendments

D-125 memory-only audio and D-192 explicit destinations/no fallback remain. D-109's specific OS/offline
voice qualification remains open, but the interaction/local-input contract is selected. D-159 gains
request/chunk cancellation and explicit playback arbitration; its old automatic-fallback wording is
superseded by D-192. 017's old no-voice-command scope describes PTT only. 038 remains the profile-choice
owner; its T022 is still unchecked. A voice session does not create unattended workflow authority.
The constitution/AGENTS amendment in ADR 0019 includes this explicit, revocable session exception.

## Alternatives and acceptance

Reject always-on cloud streaming, wake-on-launch, confidence-as-permission, prompt-only Edit dispatch,
and ignoring late playback as a substitute for stopping future paid chunks. No wake word is selected.
Official [Electron permissions](https://www.electronjs.org/docs/latest/api/session),
[track stop](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop), and
[local recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
were inspected November 7 alongside current voice/ambient/runtime code. API availability is not host
or acoustic evidence. First build pure session/confirmation/interruption/permission/segmenter contracts
with injected clocks, PCM, transports and commands, then one named host integration owner.

Required failure cases: no activation/no send; denied/late permission; route/scope ABA; STT backpressure;
echo/noise; late TTS chunks; exact edit/approval/undo confirmation; stale question/duplicate answer;
all stop variants; >5s and unresolved write settlement; failed Result/persistence warnings; Unicode/
verse/selection preservation; hide/quit/restart; accessible text-only and unsupported-host refusal.
Real mic/echo/accents/noisy-room/latency and per-platform device evidence are separately authorized
future work. Synthetic PCM or generated-audio transcription cannot close those claims.
