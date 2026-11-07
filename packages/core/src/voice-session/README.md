# Pure voice-session core — D-200 / ADR 0021

This is an **unmounted, platform-independent leaf**, implementing 017 T013/T014 and the pure part
of T015. Import its local `index.ts` directly in leaf tests. No shared package export, existing
PTT hook, profile preference, provider transport, permission handler or editor is changed.

## Selected basis and bounded implementation decisions

ADR 0021 / D-200 is the accepted policy, rather than the earlier research recommendations.
D-125 keeps audio in memory; D-192 pins explicit routes without fallback. The existing
`VoiceService` checks selected STT connection/model and the existing `SpeechService` loops TTS
chunks; neither currently supplies this module's cancellation or session authority. They remain
host-integration work, not implicitly upgraded by these files.

Use a synchronous immutable reducer plus **effect descriptions**, rather than embedding promises
or transports: a never-settling effect cannot delay revocation. Keep one bounded outstanding slot
for each of STT, TTS and work; canceled operations retain their slot until a matching settlement.
This intentionally favors a visible hold over overlapping an uncertain request. No timeout claims
an external operation stopped, was refunded, or cost zero. No request retry is automatic.

Local engineering bounds (not provider or acoustic certifications): safe integer generations and
IDs; strings used as identities/routes up to 2,048 UTF-16 units; transcript/correction text up to
65,536 UTF-16 units; 64 consumed confirmations and 64 answered question projections per activation.
These lists refuse further intents at capacity; they never evict/replay. The host must retain an
oversize transcript for explicit recovery when the reducer refuses it. These are transient records,
not a new file format or durable question store. The host still owns durable idempotency and budgets.

## Session and intent contract

- Only `start` requests permission. `initialVoiceSession()` and `observe` do no activation.
  Start binds host/window/main-frame/origin/library/book/chapter/thread, actual mode, source digest,
  scope revision and exact STT/TTS/agent routes (including connection, model, destination, voice,
  revision). The host supplies a fresh opaque session ID and strictly increasing safe generation.
- The host increments scope/route revisions on **every** change, even A → B → A. Source digests
  cover the selected current source. Never derive epochs from a mutable renderer preference.
  Copy/freeze the binding and retained intents; later mutation of caller data cannot change them.
- `capture`, `status`, `dispatchInhibited` and outstanding request slots describe different facts.
  `stopped` describes the voice session, **not** terminal runtime/work settlement. UI must present
  outstanding slots as unresolved even when capture is stopped. `requesting`, `listening`,
  `processing`, `held`, `review-needed`, `speaking`, `interrupted`, `stopped`, `unavailable` are distinct.
- Stop speaking closes speech/chunk playback gates. Pause work inhibits and asks the host to pause;
  Stop work asks the host to stop and blocks further check-in answers for this activation. Stop
  listening ends capture/voice outputs, without a work-stop intent. Bare Stop silences, inhibits,
  asks for pause, closes capture and invalidates the grant. None needs confirmation.
- `parseVoiceCommand` accepts only whole local commands in explicit command mode. It does not
  parse free-form story dialogue. Bare yes does not send/confirm. Structured correction and named
  undo carry explicit payloads instead of guessing targets from speech. Read/Next/Repeat emit
  presentation intents; the host resolves actual reading/navigation and invalidates scope as needed.
- Optional disclosed Discuss auto-send emits only `submit-discuss` with exact bound context.
  The host must use read-only tools and exclude unapproved plugins. Edit, destructive approvals,
  undo, destination changes and workflow grants require host-prepared immutable readback and exact
  `Confirmation`. Host `NamedAction.digest` covers **all** action/target/source/text/payload fields;
  this module compares it, it does not compute or authenticate it. Matching text is also checked
  literally. `confirmed-intent` is an intent, not a Library write, preference mutation or 037 grant.
- Before-send correction changes only pending text and holds capture. After-send correction closes
  future work and preserves `lastSentText`. Explicit Continue waits for all occupied slots, then
  emits a new-direction intent; it never recalls history or automatically sends that direction.
- Qualified onset silences and inhibits locally before STT. An interrupted/no-match state requires
  explicit Continue; a successful transcript cannot silently resume interrupted work. Ordinary
  successful Discuss submission can rearm capture to allow the next utterance/barge-in. In half-duplex,
  speech holds capture. Host loss of full-duplex qualification closes capture on observation.
- STT results, TTS-ready/playback events, confirmations and settlements match exact token/request IDs.
  Explicit `start-speaking` has a monotonic speech ID; each chunk has a monotonic ID within it.
  Stop speaking cannot be undone by a late chunk. A canceled old STT slot survives Start until actual
  settlement; old settlement can release its own slot but cannot rearm capture or replace new content.
- Restart begins stopped and carries no permission. The caller must preserve visible pending text
  from the previous immutable state before replacing it with a new activation; no transcript log
  or persistence is created here. Reopening/hiding/locking/permission loss cannot implicitly Start.

## Required host adapter (not implemented)

1. Keep reducer state and `HostFacts` in the trusted host. Authenticate author controls separately from
   provider text and renderer claims. Validate external wire payloads before this typed internal API.
   Serialize events, publish the new state **before** executing effects, and consume each effect once.
   Effect replay is not safe merely because the reducer is pure.
2. Build `HostFacts` afresh from real host/capability/catalog/profile/source state. A renderer-supplied
   `available`, frame ID, origin, digest, grant, route revision or full-duplex flag is not authority.
   Observe all hide/close/lock/sleep/source/route/grant transitions immediately; process loss destroys
   capture ownership. A new process uses fresh session IDs. Do not persist live grants.
3. Issue an audio-only grant for the exact permission attempt/session. Both Electron permission
   handlers must extract the real intended studio sender, trusted top-level frame/origin and requested
   media type and call `permitsAudio`. Missing or ambiguous callback facts deny. This predicate is not
   a claim the current Electron handlers have been wired or OS permission has been obtained.
4. Call `mayCapture` before PCM intake; `maySend` immediately before **every** external request or
   checked intent dispatch and after every await; `mayPlay` before decoded audio playback;
   `mayDeliverAnswer` immediately before the authoritative 037 checked-answer operation. Recheck the
   real action/target/source/grant again at the writer/approval boundary. A returned boolean is never
   a reusable capability. Stop/revoke must win atomically against queued answers/publications.
5. Execute track/playback stop, grant revocation and best-effort transport abort without awaiting
   settlement before honoring the closed gate. Stop **every owned** track, including streams delivered
   after permission cancellation. Do not infer machine-wide microphone shutdown or provider refund.
   A failed abort/stop Result must be visible; keep the unresolved operation until a real receipt.
6. STT success uses `transcript`; TTS success uses `tts-ready`, followed by exact `playback-ended`.
   Do not send a generic `settled` before consuming a successful result. `settled` is for final
   cancellation/failure/work receipts, has no result delivery, and never auto-resumes. Route STT
   no-match through empty `transcript`; canceled operations use settlement, never late content.
   Include a host-redacted `failure` on a failed receipt: it remains visible and inhibits further
   dispatch. A successful work receipt clears processing without reopening previously held capture.
7. `answer-intent` reuses run/question/character/direction/question/source/authority revisions from
   the live 037 projection. No names-as-identity, separate voice question database or scheduler.
   The host must atomically deduplicate durable answers and reject stopped/revoked/answered questions
   across activations/restarts. Session presence grants no workflow authority.
8. Present all states/questions, retained text, correction, confirmation, holds and failures in an
   accessible text/keyboard UI. Integrate actual bound Ambient/Chat/editor targets and honest W04
   settlement/persistence outcomes. `insertDictation` is only a literal pure helper; production
   insertion/replacement still needs checked editor mutation/undo. There is deliberately no unchecked
   replace-selection helper here.

## PCM/VAD adapter and bounds

`PcmSegmenter` owns normalized mono float PCM, an injected monotonic millisecond clock and an injected
local classifier. It is **not an acoustic detector**. Only `qualified-near-end` starts an utterance;
unqualified speech/noise/echo/silence cannot create a segment. Endpoint timing uses accepted sample
counts, not a timer that would mistake a stalled capture stream for silence. Capture stalls/clock gaps
are the host's lifecycle fault to report; no fabricated silence is appended.

Defaults: 16 kHz, 1.2s end silence, 250ms preroll, 60s maximum including preroll, reads ≤100ms.
Tunable validated bounds: 8–48 kHz, 100–5,000ms silence, 0–1,000ms preroll, 1–60s utterance,
reads at most sampleRate/10; silence/preroll must be shorter than the utterance maximum.
PTT's existing ten-minute/32MB limits are untouched. Nothing here changes WAV/provider contracts.

At defaults the internal capacity is 964,000 float samples (3,856,000 bytes). Maximum configured
capacity is 2,928,000 samples (11,712,000 bytes). One emitted segment is at most 2,880,000 samples
(11,520,000 bytes); the bounded input/VAD copies add at most 38,400 bytes. Host transport encoding
and buffers are additional and require their own limits. Internal used PCM is zeroed on completion
or Stop; output ownership transfers to the caller, which must release it after transport settlement.

Process `onset` effects **before** submitting any segment returned by the same `push`. Every `push`
returns `consumed`; on a limit/end-silence boundary, preserve the unconsumed suffix and show the hold.
Held/stopped reads consume zero. Do not record an unbounded host queue while held or silently drop a
later sentence: stop intake and disclose that listening is held, retaining any already accepted suffix
within one bounded read for explicit continuation/recovery. A limit produces a labeled partial segment
and shorter-continuation instruction, not an invisibly truncated successful transcript.

One completed segment occupies the segmenter's slot until exact acknowledgement; acknowledgement
does not resume capture. The adapter resumes only when the corresponding session capture gate permits
it, and must not reuse a segmenter across unrelated scopes without the matching token. No-match/noise
interruption requires an actual author Continue. Near-end/echo accuracy, full-duplex, local recognition,
sample-rate conversion, stream gaps and actual microphone/permission behavior need separate host
qualification. Synthetic events certify none of those.

## Focused verification

```sh
bun test ./packages/core/tests/voice-session/
bunx --no-install tsc -p packages/core/tests/voice-session/tsconfig.strict.json
bunx --no-install biome lint packages/core/src/voice-session packages/core/tests/voice-session
bun run typecheck
```

The unique strict config includes both source and tests and reuses the desktop workspace's installed
Bun types. No dependency, shared configuration, runner, schema or package export is added. Tests use
only synthetic text, PCM, clocks and unresolved promises; no real transport, microphone or device.
038 T022 and 017's host/UI/acoustic/device acceptance remain open.
