import {
  activeAudioGrant,
  type AudioGrant,
  type Binding,
  type HostFacts,
  identifier,
  immutable,
  initialTransportLedger,
  initialVoiceSession,
  maySend,
  mayCapture,
  type Request,
  reduceTransport,
  reduceVoiceSession,
  type Route,
  safeCounter,
  sameToken,
  type SessionToken,
  type TransportLedger,
  type TransportReceipt,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceSession,
} from "../../../core/src/voice-session";

/*
 * The Discuss surface's hands-free controller (017 T017).
 *
 * T017 asks for mounted session/transcript/correct/confirm/stop controls bound to a real
 * book/chapter/thread. This module is the host-neutral half: it owns no microphone, no provider
 * call, no file and no promise. It composes the existing T013 session reducer, the T015 permission
 * predicates and the T016 transport ledger, and returns effect descriptions for a trusted host to
 * execute once.
 *
 * What is deliberately absent:
 *
 * - No capture adapter. `HandsFreePort.startCapture` is the only way a capture fact reaches this
 *   module, and nothing in this build implements it, so the mounted surface reports that audio is
 *   not connected instead of pretending to record.
 * - No OS permission prompt. A session may only start from an already-active audio-only grant; the
 *   grant's own session id/generation becomes the session token, so a grant for another conversation
 *   cannot be reused.
 * - No second send path. The single `send-turn` effect is executed by the Discuss panel's existing
 *   checked turn start, with the bound book/chapter/thread.
 *
 * Facts are never stored as authority: every event carries a fresh host snapshot, exactly as the
 * core README requires, and the reducer rechecks the grant, route and binding on every event.
 */

export type HandsFreeMode = "discuss";

export interface HandsFreeScope {
  readonly bookId: string;
  readonly chapterId: string | null;
  readonly threadId: string | null;
  readonly mode: HandsFreeMode;
}

export interface HandsFreeIdentity {
  readonly hostId: string;
  readonly windowId: string;
  readonly frameId: string;
  readonly origin: string;
  readonly libraryId: string;
}

export interface HandsFreeRoutes {
  readonly stt: Route;
  readonly tts: Route | null;
  readonly agent: Route;
}

/** What the host adapter can see. `now` is stamped by the caller so the clock is injected. */
export interface HandsFreeSnapshot {
  readonly identity: HandsFreeIdentity | null;
  readonly routes: HandsFreeRoutes | null;
  readonly grant: AudioGrant | null;
  readonly sourceDigest: string | null;
  readonly available: boolean;
  readonly visible: boolean;
  readonly unlocked: boolean;
}

export interface HandsFreeFacts extends HandsFreeSnapshot {
  readonly now: number;
}

export interface HandsFreeTurn {
  readonly text: string;
  readonly bookId: string;
  readonly chapterId: string;
  readonly threadId: string;
  readonly mode: HandsFreeMode;
}

/** Calls the external boundary itself, after fresh facts; no cached boolean crosses an await. */
export interface HandsFreeAdmission {
  dispatch<T>(start: () => Promise<T>, current?: () => boolean): Promise<T | null>;
}

export type HandsFreeAvailability =
  | { readonly ready: true; readonly binding: Binding }
  | { readonly ready: false; readonly reason: string };

export interface HandsFreeHostOutcome {
  readonly ok: boolean;
  readonly reason?: string;
}

export type HandsFreeTranscript =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** Everything a host adapter could implement. Nothing here ships a capture or provider call. */
export interface HandsFreePort {
  snapshot(scope: HandsFreeScope): Promise<HandsFreeSnapshot | null>;
  /** Injectable clock so expiries are deterministic in tests. */
  now?(): number;
  startCapture?(token: SessionToken): Promise<HandsFreeHostOutcome>;
  stopCapture?(token: SessionToken): Promise<HandsFreeHostOutcome>;
  transcribeSegment?(input: {
    readonly requestId: number;
    readonly segmentId: number;
    readonly signal: AbortSignal;
  }): Promise<HandsFreeTranscript>;
  /** A qualified segment ended. The host owns segmentation; this module owns no PCM. */
  onSegment?(listener: (segment: { readonly segmentId: number }) => void): () => void;
}

export type HandsFreeCaptureState = "closed" | "opening" | "open" | "failed";

export interface HandsFreeStopState {
  readonly status: "idle" | "stopping" | "stopped" | "failed";
  readonly reason: string | null;
  readonly attemptId: number | null;
  readonly token: SessionToken | null;
}

export interface HandsFreeSendState {
  readonly status: "idle" | "sending" | "sent" | "failed";
  readonly text: string | null;
  readonly threadId: string | null;
  readonly reason: string | null;
  readonly requestId: number | null;
  readonly dispatched: boolean;
}

export type HandsFreePhase =
  | "unavailable"
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "correcting"
  | "confirming"
  | "speaking"
  | "interrupted"
  | "held"
  | "stopping"
  | "stopped"
  | "stop-unconfirmed";

export interface HandsFreeState {
  readonly session: VoiceSession;
  readonly scope: HandsFreeScope | null;
  readonly binding: Binding | null;
  readonly availability: HandsFreeAvailability;
  readonly revision: number;
  readonly capture: HandsFreeCaptureState;
  readonly captureReason: string | null;
  readonly ioSequence: number;
  readonly captureAttempt: number | null;
  readonly sttRequest: { readonly operationId: number; readonly request: Request } | null;
  /** A correction remains editable even when the author clears every character. */
  readonly editing: boolean;
  readonly stop: HandsFreeStopState;
  readonly send: HandsFreeSendState;
  readonly transport: TransportLedger;
  /** Bounded copy of words that were never sent when a session ended or the target changed. */
  readonly preserved: string | null;
  readonly note: string | null;
  readonly ignoredTranscripts: number;
  /** The last STT receipt, so a stop can show an honest unknown charge. */
  readonly lastReceipt: TransportReceipt | null;
}

export type HandsFreeEffect =
  | { readonly type: "capture-open"; readonly token: SessionToken; readonly attemptId: number }
  | { readonly type: "capture-close"; readonly token: SessionToken; readonly attemptId: number;
      readonly purpose: "hold" | "shutdown" }
  | {
      readonly type: "transcribe";
      readonly requestId: number;
      readonly segmentId: number;
      readonly operationId: number;
      readonly chunkId: number;
    }
  | {
      readonly type: "abort-transcribe";
      readonly operationId: number;
      readonly chunkId: number;
      readonly reason: string;
    }
  | { readonly type: "send-turn"; readonly requestId: number; readonly turn: HandsFreeTurn };

export interface HandsFreeTransition {
  readonly state: HandsFreeState;
  readonly effects: readonly HandsFreeEffect[];
}

/** The event minus the facts/scope the caller must rebuild on every call. */
export type HandsFreeIntent =
  | { readonly type: "sync" }
  | { readonly type: "revoke" }
  | { readonly type: "capture-blocked"; readonly token: SessionToken; readonly reason: string }
  | { readonly type: "start" }
  | { readonly type: "segment"; readonly segmentId: number }
  | {
      readonly type: "dispatch-transcribe";
      readonly requestId: number;
      readonly operationId: number;
      readonly chunkId: number;
      readonly ready: boolean;
    }
  | {
      readonly type: "transcript";
      readonly text: string;
      readonly operationId: number;
      readonly chunkId: number;
    }
  | {
      readonly type: "transcript-failed";
      readonly reason: string;
      readonly operationId: number;
      readonly chunkId: number;
    }
  | { readonly type: "correct"; readonly text: string }
  | { readonly type: "discard" }
  | { readonly type: "continue" }
  | { readonly type: "confirm" }
  | { readonly type: "stop" }
  | { readonly type: "acknowledge" }
  | { readonly type: "send-settled"; readonly ok: boolean; readonly requestId: number; readonly reason?: string }
  | { readonly type: "send-dispatched"; readonly requestId: number }
  | { readonly type: "stop-settled"; readonly ok: boolean; readonly reason?: string;
      readonly token: SessionToken; readonly attemptId: number; readonly purpose: "hold" | "shutdown" }
  | {
      readonly type: "capture-settled";
      readonly open: boolean;
      readonly token: SessionToken;
      readonly attemptId: number;
      readonly reason?: string;
    };

export type HandsFreeEvent = HandsFreeIntent & {
  readonly facts: HandsFreeFacts | null;
  readonly scope: HandsFreeScope;
};

const TEXT_LIMIT = 65_536;
const NO_GRANT_REASON = "No audio grant is active for this conversation. Nothing was recorded.";
export const HANDS_FREE_UNCONNECTED =
  "Hands-free audio is not connected in this build, so nothing is recorded or sent.";

/** Shaped only so the core reducer can be called when no host facts exist. Never dispatched. */
const NO_BINDING: Binding = {
  hostId: "",
  windowId: "",
  frameId: "",
  origin: "",
  libraryId: "",
  bookId: "",
  chapterId: "",
  threadId: "",
  mode: "discuss",
  scopeRevision: 0,
  sourceDigest: "",
  stt: { connectionId: "", provider: "", model: "", destination: "", voice: null, revision: 0 },
  tts: null,
  agent: { connectionId: "", provider: "", model: "", destination: "", voice: null, revision: 0 },
};

export function initialHandsFreeState(): HandsFreeState {
  return immutable({
    session: initialVoiceSession(),
    scope: null,
    binding: null,
    availability: { ready: false, reason: HANDS_FREE_UNCONNECTED } as HandsFreeAvailability,
    revision: 0,
    capture: "closed" as HandsFreeCaptureState,
    captureReason: null,
    ioSequence: 0,
    captureAttempt: null,
    sttRequest: null,
    editing: false,
    stop: { status: "idle", reason: null, attemptId: null, token: null } as HandsFreeStopState,
    send: { status: "idle", text: null, threadId: null, reason: null, requestId: null, dispatched: false } as HandsFreeSendState,
    transport: initialTransportLedger(),
    preserved: null,
    note: null,
    ignoredTranscripts: 0,
    lastReceipt: null,
  });
}

export function sameScope(a: HandsFreeScope | null, b: HandsFreeScope): boolean {
  return !!a && a.bookId === b.bookId && a.chapterId === b.chapterId && a.threadId === b.threadId &&
    a.mode === b.mode;
}

function granted(snapshot: HandsFreeSnapshot, identity: HandsFreeIdentity, now: number): boolean {
  const { grant } = snapshot;
  return !!grant && grant.active && grant.audioOnly && safeCounter(now) && safeCounter(grant.expiresAt) &&
    now < grant.expiresAt && identifier(grant.grantId) && identifier(grant.sessionId) &&
    safeCounter(grant.generation) && [grant.hostId, grant.windowId, grant.frameId, grant.origin].every(identifier) &&
    grant.hostId === identity.hostId && grant.windowId === identity.windowId &&
    grant.frameId === identity.frameId && grant.origin === identity.origin;
}

/**
 * Everything the mounted surface needs to decide whether Start is honest. Read it again on every
 * event; a cached yes is exactly the bug the core README warns about.
 */
export function handsFreeAvailability(
  scope: HandsFreeScope,
  facts: HandsFreeFacts | null,
): HandsFreeAvailability {
  if (!facts) return { ready: false, reason: HANDS_FREE_UNCONNECTED };
  if (!facts.available) return { ready: false, reason: "Hands-free audio is unavailable in this window." };
  if (!facts.visible) return { ready: false, reason: "Bring the studio window forward before starting." };
  if (!facts.unlocked) return { ready: false, reason: "The studio is locked. Unlock it before starting." };
  const { identity, routes } = facts;
  if (!identity) {
    return { ready: false, reason: "This window cannot identify its own session. Nothing was recorded." };
  }
  if (!scope.bookId) return { ready: false, reason: "Open a book before starting a hands-free session." };
  if (!scope.chapterId) {
    return { ready: false, reason: "Open a chapter before starting. A voice turn binds to the chapter you are in." };
  }
  if (!scope.threadId) {
    return {
      ready: false,
      reason: "Send one typed message or open a saved conversation first, so a voice turn has a thread to join.",
    };
  }
  if (!routes) {
    return {
      ready: false,
      reason: "Choose an audio transcription connection and model in Settings before starting.",
    };
  }
  if (!facts.sourceDigest) {
    return { ready: false, reason: "The conversation is still loading its source. Try again in a moment." };
  }
  if (!granted(facts, identity, facts.now)) return { ready: false, reason: NO_GRANT_REASON };
  return {
    ready: true,
    binding: {
      hostId: identity.hostId,
      windowId: identity.windowId,
      frameId: identity.frameId,
      origin: identity.origin,
      libraryId: identity.libraryId,
      bookId: scope.bookId,
      chapterId: scope.chapterId,
      threadId: scope.threadId,
      mode: "discuss",
      scopeRevision: 0,
      sourceDigest: facts.sourceDigest,
      stt: routes.stt,
      tts: routes.tts,
      agent: routes.agent,
    },
  };
}

function hostFacts(facts: HandsFreeFacts | null, binding: Binding | null): HostFacts {
  return {
    now: facts?.now ?? 0,
    binding: binding ?? NO_BINDING,
    available: facts?.available === true,
    visible: facts?.visible === true,
    unlocked: facts?.unlocked === true,
    routesReady: !!facts?.routes,
    fullDuplexQualified: false,
    grant: facts?.grant ?? null,
    action: null,
    question: null,
    workflowRevoked: false,
  };
}

function permitFor(session: VoiceSession, facts: HandsFreeFacts | null): boolean {
  if (!facts?.grant || !session.token || !session.binding) return false;
  return activeAudioGrant({
    token: session.token,
    studio: session.binding,
    grant: facts.grant,
    now: facts.now,
    captureRequested: true,
  });
}

export function mayOpenHandsFreeCapture(state: HandsFreeState, facts: HandsFreeFacts | null,
  scope: HandsFreeScope, attemptId: number): boolean {
  const available = handsFreeAvailability(scope, facts);
  return state.captureAttempt === attemptId && state.capture === "opening" &&
    state.stop.status === "idle" && sameScope(state.scope, scope) && available.ready &&
    mayCapture(state.session, hostFacts(facts, available.binding));
}

export function mayDispatchHandsFreeTurn(state: HandsFreeState, facts: HandsFreeFacts | null,
  scope: HandsFreeScope, requestId: number): boolean {
  const available = handsFreeAvailability(scope, facts);
  const request = state.session.requests.work;
  return state.send.status === "sending" && !state.send.dispatched && state.send.requestId === requestId &&
    !!request && request.id === requestId && sameScope(state.scope, scope) && available.ready &&
    maySend(state.session, request, hostFacts(facts, available.binding));
}

function phaseOf(state: HandsFreeState): HandsFreePhase {
  if (state.stop.status === "stopping") return "stopping";
  if (state.stop.status === "failed") return "stop-unconfirmed";
  const session = state.session;
  if (!session.active) {
    if (!state.availability.ready || session.status === "unavailable") return "unavailable";
    return "stopped";
  }
  if (state.send.status === "sending") return "confirming";
  if (session.permissionPending || state.capture === "opening") return "starting";
  if (session.requests.stt || session.status === "processing") return "transcribing";
  if ((state.editing || session.draft) && !session.confirmation) return "correcting";
  if (session.status === "requesting") return "starting";
  if (session.status === "interrupted") return "interrupted";
  if (session.status === "speaking") return "speaking";
  if (state.capture === "failed") return "held";
  if (session.capture && state.capture === "open") return "recording";
  return "held";
}

export function handsFreePhase(state: HandsFreeState): HandsFreePhase {
  return phaseOf(state);
}

function boundedText(text: string): boolean {
  return typeof text === "string" && text.length <= TEXT_LIMIT;
}

function failureCopy(reason: string | undefined): string {
  return typeof reason === "string" && reason.trim() && reason.length <= TEXT_LIMIT
    ? reason
    : "The operation failed. Review the conversation before continuing.";
}

export function reduceHandsFree(previous: HandsFreeState, event: HandsFreeEvent): HandsFreeTransition {
  const { facts, scope } = event;
  const availability = handsFreeAvailability(scope, facts);
  const currentBinding = availability.ready ? availability.binding : null;
  let state = previous;
  const effects: HandsFreeEffect[] = [];

  const update = (patch: Partial<HandsFreeState>) => {
    state = { ...state, ...patch };
  };
  const result = (): HandsFreeTransition => immutable({ state, effects });

  /** Call the pure core reducer with the fresh facts. */
  const core = (voiceEvent: VoiceEvent): readonly VoiceEffect[] => {
    const wasActive = state.session.active;
    const draft = state.session.draft;
    const transition = reduceVoiceSession(
      { ...state.session, binding: state.session.binding ?? currentBinding },
      voiceEvent,
      hostFacts(facts, currentBinding),
    );
    update({ session: transition.state });
    closeCaptureEffects(transition.effects);
    if (transition.effects.some((effect) => effect.type === "cancel-request" && effect.request.kind === "stt")) {
      cancelSttTransport("The session no longer admits transcription.");
    }
    if (wasActive && !state.session.active) {
      update({ session: { ...state.session, draft: "", confirmation: null }, editing: false,
        ...(draft.trim() && boundedText(draft) ? { preserved: draft } : {}) });
    }
    return transition.effects;
  };

  const openCaptureEffects = (coreEffects: readonly VoiceEffect[]) => {
    for (const effect of coreEffects) {
      if (effect.type === "start-capture" && state.session.token) {
        if (state.capture === "open" || state.capture === "opening") continue;
        const attemptId = state.ioSequence + 1;
        effects.push({ type: "capture-open", token: state.session.token, attemptId });
        update({ capture: "opening", captureAttempt: attemptId, ioSequence: attemptId });
      }
    }
  };

  /** The core holds capture while a request is outstanding; the host is told to close its track. */
  const closeCaptureEffects = (coreEffects: readonly VoiceEffect[]) => {
    const token = state.session.token;
    if (!token || !coreEffects.some((effect) => effect.type === "stop-capture" || effect.type === "revoke-grant")) return;
    const purpose = state.session.active ? "hold" : "shutdown";
    if (effects.some((effect) => effect.type === "capture-close" && effect.purpose === purpose)) return;
    const attemptId = state.ioSequence + 1;
    effects.push({ type: "capture-close", token, attemptId, purpose });
    update({ capture: "closed", captureAttempt: null, ioSequence: attemptId,
      ...(purpose === "shutdown" ? { stop: { status: "stopping", reason: null, attemptId, token } as HandsFreeStopState } : {}) });
  };

  const preserveDraft = () => {
    const draft = state.session.draft.trim();
    if (draft && boundedText(draft)) update({ preserved: state.session.draft });
  };

  /** Release an outstanding core request as a cancellation receipt, never as a failure. */
  const settleOutstanding = (kind: "stt" | "work") => {
    const request = state.session.requests[kind];
    if (request) core({ type: "settled", request });
  };

  const endSession = (reason: string) => {
    const token = state.session.token;
    if (!token) return;
    preserveDraft();
    const sending = state.send.status === "sending";
    core({ type: "end", token, reason: "scope-change" });
    settleOutstanding("stt");
    settleOutstanding("work");
    // The core deliberately keeps a pending draft across Stop for host recovery. This surface
    // discards it so it can never be sent to a new target; `preserved` keeps it visible instead.
    update({
      session: { ...state.session, draft: "", confirmation: null, active: false, capture: false },
      editing: false,
      capture: "closed" as HandsFreeCaptureState,
      send: sending
        ? state.send
        : { status: "idle", text: null, threadId: null, reason: null, requestId: null, dispatched: false },
      note: sending
        ? state.send.dispatched ? "The conversation changed after dispatch. The turn outcome is unknown until its receipt arrives."
          : "The conversation changed before dispatch. The pending turn is revoked."
        : reason,
      scope: { ...scope },
      binding: null,
    });
  };

  const cancelSttTransport = (reason: string) => {
    const operation = state.transport.slots.stt;
    if (!operation) return;
    const cancelled = reduceTransport(state.transport, {
      type: "cancel",
      operationId: operation.operationId,
      reason,
    });
    update({ transport: cancelled.ledger });
    for (const effect of cancelled.effects) {
      if (effect.type === "abort") {
        effects.push({
          type: "abort-transcribe",
          operationId: effect.operationId,
          chunkId: effect.chunkId,
          reason: effect.reason,
        });
      }
    }
    const receipt = cancelled.ledger.receipts.at(-1) ?? null;
    if (receipt) update({ lastReceipt: receipt });
  };

  const scopeChanged = !!state.binding && !sameScope(state.scope, scope);
  if (scopeChanged || event.type === "revoke") {
    if (state.session.active) endSession("The book, chapter, conversation or capture host changed. Those words were not sent.");
    else {
      preserveDraft();
      update({ session: { ...state.session, draft: "", confirmation: null }, editing: false,
        scope: { ...scope }, binding: null });
    }
  }

  switch (event.type) {
    case "capture-blocked": {
      if (state.session.active) break;
      const attemptId = state.ioSequence + 1;
      update({ ioSequence: attemptId, capture: "failed", captureReason: event.reason,
        stop: { status: "failed", reason: event.reason, token: event.token, attemptId } });
      break;
    }
    case "sync": {
      core({ type: "observe" });
      if (!state.session.active && state.capture !== "closed") {
        update({ capture: "closed" as HandsFreeCaptureState });
      }
      break;
    }

    case "start": {
      if (state.stop.status === "stopping" || state.stop.status === "failed" || state.send.status === "sending") break;
      if (state.session.active) {
        core({ type: "observe" });
        update({ note: state.session.active ? "End the current conversation before starting another." : state.session.reason });
        break;
      }
      if (!availability.ready) {
        update({
          session: {
            ...initialVoiceSession(),
            generation: state.session.generation,
            sequence: state.session.sequence,
            status: "unavailable",
            reason: availability.reason,
            failures: state.session.failures,
            requests: state.session.requests,
            playbackReady: state.session.playbackReady,
          },
          availability,
          note: availability.reason,
          capture: "closed" as HandsFreeCaptureState,
          scope: { ...scope },
          binding: null,
        });
        break;
      }
      const grant = facts?.grant;
      if (!grant || !facts) {
        update({ note: NO_GRANT_REASON, availability });
        break;
      }
      if (grant.generation <= state.session.generation) {
        update({
          note: "That audio grant belongs to an earlier session. Start again from the conversation.",
          availability,
        });
        break;
      }
      const revision = state.revision + 1;
      core({ type: "start", sessionId: grant.sessionId, generation: grant.generation, autoSendDiscuss: false });
      update({
        availability,
        scope: { ...scope },
        binding: { ...availability.binding, scopeRevision: revision },
        revision,
        capture: "closed" as HandsFreeCaptureState,
        captureReason: null,
        editing: false,
        stop: { status: "idle", reason: null, attemptId: null, token: null } as HandsFreeStopState,
        send: state.send.status === "failed"
          ? state.send
          : { status: "idle", text: null, threadId: null, reason: null, requestId: null, dispatched: false } as HandsFreeSendState,
        preserved: null,
        note: null,
        ignoredTranscripts: 0,
      });
      const token = state.session.token;
      if (!token) break;
      // Starting is only attempted with an active grant, so the permission outcome is already a host
      // fact. No OS prompt is shown and none is claimed; `request-permission` is not executed.
      openCaptureEffects(core({ type: "permission", token, granted: true }));
      break;
    }

    case "segment": {
      const token = state.session.token;
      if (!state.session.active || !token || !safeCounter(event.segmentId) ||
          event.segmentId <= state.session.lastSegment) {
        break;
      }
      const coreEffects = core({ type: "segment", token, segmentId: event.segmentId });
      const transcribe = coreEffects.find((effect): effect is Extract<VoiceEffect, { type: "transcribe" }> =>
        effect.type === "transcribe");
      if (!transcribe) break;
      const permitted = permitFor(state.session, facts);
      const now = facts?.now ?? 0;
      const begin = reduceTransport(state.transport, {
        type: "begin",
        kind: "stt",
        planned: 1,
        facts: { now, session: token, route: transcribe.request.route, permitted },
      });
      const operationId = begin.ledger.slots.stt?.operationId;
      if (!operationId || operationId === state.transport.slots.stt?.operationId) {
        update({ transport: begin.ledger, note: begin.ledger.reason ?? "The transcription could not start." });
        const failure = begin.ledger.reason ?? "The transcription could not start.";
        core({ type: "settled", request: transcribe.request, failure });
        break;
      }
      const chunk = reduceTransport(begin.ledger, { type: "chunk", operationId });
      const chunkId = chunk.ledger.slots.stt?.chunks[0]?.chunkId;
      if (!chunkId) {
        update({ transport: chunk.ledger, note: chunk.ledger.reason ?? "The transcription could not start." });
        break;
      }
      // Capture closure can await the host. Keep this chunk queued/unsent until the runner
      // revalidates fresh facts immediately before the adapter call.
      update({ transport: chunk.ledger, sttRequest: { operationId, request: transcribe.request } });
      effects.push({
        type: "transcribe",
        requestId: transcribe.request.id,
        segmentId: event.segmentId,
        operationId,
        chunkId,
      });
      break;
    }

    case "dispatch-transcribe": {
      const operation = state.transport.slots.stt;
      if (!operation || operation.operationId !== event.operationId ||
          operation.chunks.find((chunk) => chunk.chunkId === event.chunkId)?.state !== "queued") break;
      const request = state.session.requests.stt;
      if (!event.ready || !request || request.id !== event.requestId || !sameToken(operation, request) ||
          !maySend(state.session, request, hostFacts(facts, currentBinding))) {
        cancelSttTransport("Transcription was cancelled before dispatch. Nothing was sent.");
        if (request && request.id === event.requestId && sameToken(operation, request)) settleOutstanding("stt");
        update({ note: "Transcription was cancelled before dispatch. Nothing was sent." });
        break;
      }
      const dispatched = reduceTransport(state.transport, {
        type: "dispatch", operationId: event.operationId, chunkId: event.chunkId,
        facts: { now: facts?.now ?? 0, session: request, route: request.route, permitted: permitFor(state.session, facts) },
      });
      update({ transport: dispatched.ledger });
      if (!dispatched.effects.some((effect) => effect.type === "send")) {
        settleOutstanding("stt");
        update({ note: dispatched.ledger.reason ?? "The transcription was not dispatched." });
      }
      break;
    }

    case "transcript": {
      const token = state.session.token;
      const request = state.sttRequest?.operationId === event.operationId ? state.sttRequest.request : null;
      const operation = state.transport.slots.stt;
      const matching = operation?.operationId === event.operationId &&
        operation.chunks.find((chunk) => chunk.chunkId === event.chunkId)?.state === "dispatched";
      if (matching) {
        const settle = reduceTransport(state.transport, {
          type: "settle",
          operationId: operation.operationId,
          chunkId: event.chunkId,
          outcome: "success",
          costUsd: null,
        });
        update({ transport: settle.ledger, sttRequest: null, lastReceipt: settle.ledger.receipts.at(-1) ?? state.lastReceipt });
      }
      const stopped = state.stop.status === "stopping" || state.stop.status === "failed" || !state.session.active;
      if (!matching || stopped || !request || !token || !sameToken(operation, request)) {
        if (matching && request && sameToken(operation, request)) core({ type: "settled", request });
        update({
          ignoredTranscripts: state.ignoredTranscripts + 1,
          note: "A transcript arrived after this session stopped. It was ignored and nothing was sent.",
        });
        break;
      }
      if (!boundedText(event.text)) {
        cancelSttTransport("The transcript exceeded the text bound.");
        core({
          type: "settled",
          request,
          failure: "Transcript exceeds the text bound; the host must retain it for explicit recovery.",
        });
        update({ note: "That transcript was too long to handle. The host must keep it for explicit recovery." });
        break;
      }
      core({ type: "transcript", token, request, text: event.text });
      // Delivery and permission to consume words are separate. The exact receipt always releases
      // its core request, even when the core lifecycle precheck rejected the text.
      core({ type: "settled", request });
      update({ editing: state.session.active && Boolean(state.session.draft),
        note: state.session.status === "interrupted" ? state.session.reason : null });
      break;
    }

    case "transcript-failed": {
      const token = state.session.token;
      const request = state.sttRequest?.operationId === event.operationId ? state.sttRequest.request : null;
      const operation = state.transport.slots.stt;
      const matching = operation?.operationId === event.operationId &&
        operation.chunks.find((chunk) => chunk.chunkId === event.chunkId)?.state === "dispatched";
      if (matching) {
        const settle = reduceTransport(state.transport, {
          type: "settle",
          operationId: operation.operationId,
          chunkId: event.chunkId,
          outcome: "failure",
          failure: event.reason,
        });
        update({ transport: settle.ledger, sttRequest: null, lastReceipt: settle.ledger.receipts.at(-1) ?? state.lastReceipt });
      }
      if (!matching || !request || !token || !sameToken(operation, request)) {
        update({ ignoredTranscripts: state.ignoredTranscripts + 1 });
        break;
      }
      core({ type: "observe" });
      if (!state.session.active || state.stop.status !== "idle") {
        // A stop aborts the request; settling it as a failure would block every later session.
        core({ type: "settled", request });
        update({
          ignoredTranscripts: state.ignoredTranscripts + 1,
          note: "The transcription ended after this session stopped. Nothing was sent.",
        });
        break;
      }
      const reason = failureCopy(event.reason);
      core({ type: "settled", request, failure: reason });
      update({ note: reason });
      break;
    }

    case "correct": {
      const token = state.session.token;
      if (!state.session.active || !token) {
        update({ note: "Start a session before correcting words." });
        break;
      }
      if (!boundedText(event.text)) {
        update({ note: "That correction is too long. Shorten it and try again." });
        break;
      }
      if (event.text === state.session.draft) break;
      core({
        type: "command",
        token,
        command: { kind: "correct-that", text: event.text },
        input: "control",
      });
      if (state.session.active && state.session.draft === event.text) update({ editing: true });
      if (state.session.draft !== event.text) {
        update({ note: state.session.reason ?? "The correction could not be applied." });
      } else if (state.session.correctionPending) {
        update({ note: "That changed words after a sent turn. Continue before sending." });
      } else {
        update({ note: null });
      }
      break;
    }

    case "discard": {
      const token = state.session.token;
      if (!state.session.active || !token) break;
      core({ type: "command", token, command: { kind: "discard" }, input: "control" });
      update({ note: null, editing: false });
      break;
    }

    case "continue": {
      const token = state.session.token;
      if (!state.session.active || !token) break;
      // The core also emits `new-direction`, a host intent this build must not dispatch by itself:
      // the author still confirms the words through the one checked send path.
      const coreEffects = core({ type: "continue", token });
      openCaptureEffects(coreEffects);
      update({
        captureReason: null,
        note: state.session.reason ?? "The new direction is ready. Confirm to send it explicitly.",
      });
      break;
    }

    case "confirm": {
      const binding = state.binding;
      if (!binding || !sameScope(state.scope, scope) || binding.bookId !== scope.bookId ||
          binding.chapterId !== scope.chapterId || binding.threadId !== scope.threadId) {
        update({ note: "The book, chapter or conversation changed. Nothing was sent." });
        break;
      }
      if (state.send.status === "sending") {
        update({ note: "The turn is already being sent." });
        break;
      }
      const token = state.session.token;
      if (!state.session.active || !token) {
        update({ note: "Start a session before confirming words." });
        break;
      }
      if (!state.session.draft.trim()) {
        update({ note: "There are no words to send." });
        break;
      }
      if (state.session.correctionPending) {
        update({ note: "A correction after sending starts a new direction. Continue first." });
        break;
      }
      const coreEffects = core({ type: "send", token });
      const submit = coreEffects.find((effect): effect is Extract<VoiceEffect, { type: "submit-discuss" }> =>
        effect.type === "submit-discuss");
      if (!submit) {
        update({ note: state.session.reason ?? "The words were not sent." });
        break;
      }
      update({
        send: {
          status: "sending",
          text: submit.text,
          threadId: binding.threadId,
          reason: null,
          requestId: submit.request.id,
          dispatched: false,
        },
        editing: false,
        note: null,
      });
      effects.push({
        type: "send-turn",
        requestId: submit.request.id,
        turn: {
          text: submit.text,
          bookId: binding.bookId,
          chapterId: binding.chapterId,
          threadId: binding.threadId,
          mode: "discuss",
        },
      });
      openCaptureEffects(coreEffects);
      break;
    }

    case "send-dispatched": {
      if (state.send.status === "sending" && state.send.requestId === event.requestId) {
        update({ send: { ...state.send, dispatched: true } });
      }
      break;
    }

    case "send-settled": {
      // A late result from another turn or session must not speak for this one.
      if (state.send.status !== "sending" || state.send.requestId !== event.requestId) break;
      const request = state.session.requests.work;
      if (request && request.id === event.requestId && event.ok) {
        core({ type: "settled", request });
      } else if (request && request.id === event.requestId) {
        core({ type: "settled", request, failure: failureCopy(event.reason) });
      }
      if (event.ok) {
        update({
          send: { ...state.send, status: "sent", reason: null, requestId: null },
          note: sameScope(state.scope, scope) && state.send.threadId === scope.threadId
            ? "Sent to this conversation." : "Sent to the original conversation before it changed.",
        });
      } else {
        const reason = failureCopy(event.reason);
        update({
          send: { ...state.send, status: "failed", reason, requestId: null },
          note: reason,
          preserved: state.send.text && boundedText(state.send.text) ? state.send.text : state.preserved,
        });
      }
      break;
    }

    case "acknowledge": {
      for (const kind of ["stt", "tts", "work"] as const) {
        const failure = state.session.failures[kind];
        if (failure) core({ type: "acknowledge-failure", request: failure.request });
      }
      if (state.send.status === "failed") {
        update({ send: { status: "idle", text: null, threadId: null, reason: null, requestId: null, dispatched: false } });
      }
      update({ note: null });
      break;
    }

    case "stop": {
      if (state.stop.status === "stopping") break;
      if (state.stop.status === "failed" && state.stop.token) {
        const attemptId = state.ioSequence + 1;
        effects.push({ type: "capture-close", token: state.stop.token, purpose: "shutdown", attemptId });
        update({ ioSequence: attemptId, stop: { ...state.stop, status: "stopping", reason: null, attemptId } });
        break;
      }
      const token = state.session.token;
      if (!token || !state.session.active) {
        update({
          stop: { ...state.stop, status: "stopped", reason: null },
          capture: "closed" as HandsFreeCaptureState,
          note: "Nothing was recording.",
        });
        break;
      }
      preserveDraft();
      core({ type: "command", token, command: { kind: "stop" }, input: "control" });
      update({
        session: { ...state.session, draft: "" },
        editing: false,
        send: state.send.status === "sending" ? state.send
          : { status: "idle", text: null, threadId: null, reason: null, requestId: null, dispatched: false } as HandsFreeSendState,
        note: "Stopping. Waiting for the host to confirm that capture closed.",
      });
      cancelSttTransport("Stopped.");
      // Stop is a cancellation, not a failure: release the core slots while the transport receipt
      // keeps the unknown charge. A dispatched send still reports its own real outcome.
      settleOutstanding("stt");
      settleOutstanding("work");
      break;
    }

    case "stop-settled": {
      if (event.purpose === "hold") {
        if (!event.ok && state.session.active && state.session.token && sameToken(state.session.token, event.token) &&
            state.ioSequence === event.attemptId) {
          update({ capture: "failed", captureReason: `Capture closure was not confirmed: ${failureCopy(event.reason)} Stop to retry.` });
        }
        break;
      }
      if (event.purpose !== "shutdown" || state.stop.status !== "stopping" ||
          state.stop.attemptId !== event.attemptId || !state.stop.token || !sameToken(state.stop.token, event.token)) break;
      if (event.ok) {
        update({
          stop: { ...state.stop, status: "stopped", reason: null },
          capture: "closed" as HandsFreeCaptureState,
          note: "Stopped.",
        });
      } else {
        const reason = failureCopy(event.reason);
        update({
          stop: { ...state.stop, status: "failed", reason },
          capture: "closed" as HandsFreeCaptureState,
          note: `Stop was not confirmed: ${reason} This session cannot send.`,
        });
      }
      break;
    }

    case "capture-settled": {
      const current = state.session.token;
      if (!current || current.sessionId !== event.token.sessionId ||
          current.generation !== event.token.generation || state.captureAttempt !== event.attemptId || !state.session.active) {
        // A late open/close from an earlier session must not describe this one.
        break;
      }
      if (event.open) {
        update({ capture: "open" as HandsFreeCaptureState, captureReason: null });
        break;
      }
      const reason = event.reason ?? "Capture could not be opened. Nothing is being recorded.";
      update({ capture: "failed" as HandsFreeCaptureState, captureReason: reason, note: reason });
      break;
    }
  }

  if (!state.session.active && state.capture === "open") {
    update({ capture: "closed" as HandsFreeCaptureState });
  }
  update({ availability });
  return result();
}
