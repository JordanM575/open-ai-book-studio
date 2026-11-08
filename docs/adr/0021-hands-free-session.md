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

## Mounted synthetic seam and retained host boundary

The currently mounted controller accepts only a `synthetic-in-process-v1` `HandsFreePort`. This is a
test contract for one JavaScript realm, **not** a native/IPC capture integration. A port must:

- Keep one non-recycled monotonic revision for its entire lifetime. Advance it for every relevant
  identity, scope, availability, visibility, lock, source, route or grant change, including expiry and
  A–B–A changes; stamp each snapshot at capture time. Provide a synchronous current revision and a
  working lifecycle subscription that promptly reports changes. The controller refuses incomplete
  ports, invalid revision/subscription setup, stale snapshots and old pending lifetimes. If a
  revision advances before its notification arrives, an old transcript is not admitted; its actual
  transport settlement is still retained.
- Independently end all owned capture on lifecycle loss or expiry, including an acquisition still in
  progress, even if the renderer is suspended or disposed. Prompt notifications and the controller's
  expiry timer are additional defenses, not substitutes for host-owned closure.
- Implement `admit` as a synchronous critical section which checks the current revision, requested
  scope, grant, route and expiry and either refuses or calls its callback once. The callback must cross
  the **actual** capture, STT or agent-start boundary in that same section. Deferred preflight,
  renderer polling or merely wrapping IPC does not meet this contract. ChatPanel still flushes the
  draft and uses its checked turn flow, but a voice turn crosses the qualified host's `startAgent`
  boundary; normal typed sending remains separate.

An already-dispatched turn keeps its actual result visible even if the host becomes unavailable.
Capture closure has its own status and remains unconfirmed on a failed close, regardless of whether
the turn or closure receipt arrives first.

Confirmed voice words displayed while draft flush/admission is pending are local-only until the
actual admitted agent-start callback. Pre-dispatch Stop, refusal and flush errors preserve those
displayed words without making them eligible for any later typed or voice request's history. Only
a fresh deliberate submission can send them. Already-dispatched words remain legitimate history
even when the start result fails; this does not assert provider receipt or cancellation. Ordinary
typed sending/retry and independently stored conversation history retain their existing behavior.

The qualification marker and runtime checks can reject an incomplete adapter; they cannot prove that
an adapter which claims the contract actually honors atomicity, notifications or independent closure.
No production adapter currently qualifies. A future native host needs a separate trusted-process
contract and atomic validation at the real external dispatch boundary, plus independent lifecycle and
device evidence; a renderer-side revision check is not that proof.

Within the synthetic realm, the same port object owns capture attempts and a bounded STT ledger across
component disposal/remount. A failed or rejected acquisition is compensated through its original
owner; Stop joins pending acquisition/closure, and failed cleanup remains unconfirmed until an
explicit successful retry. A best-effort abort does not release a dispatched STT slot. Exact late
settlements release only their own slot and retain unknown charges; operation cancellation and the
actual final dispatched-chunk outcome are separate receipt facts. The in-memory ledger cannot survive
process loss or coordinate different port objects representing one underlying host. A native host
must provide stable, authoritative ownership and accounting for those cases. Exhausted bounded
receipt history refuses further operations rather than discarding accounting.

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
