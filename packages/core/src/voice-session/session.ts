import {
  type Binding, copyBinding, type HostFacts, identifier, immutable, type NamedAction,
  type QuestionBinding, type Route, safeCounter, sameAction, sameBinding, sameQuestion,
  sameRoute, sameToken, type SessionToken, validAction, validBinding, validQuestion,
} from "./contracts";
import { activeAudioGrant } from "./permission";

export type VoiceStatus = "stopped" | "unavailable" | "requesting" | "listening" | "processing" |
  "held" | "review-needed" | "speaking" | "interrupted";
export type RequestKind = "stt" | "tts" | "work";
export interface Request extends SessionToken {
  readonly id: number;
  readonly kind: RequestKind;
  readonly route: Route;
  readonly action: NamedAction | null;
  readonly closed: boolean;
  /** An issued effect may already have reached a provider. No assumed refund or zero cost. */
  readonly outcome: "possibly-sent-or-charged";
}
export interface Confirmation extends SessionToken {
  readonly id: number;
  readonly action: NamedAction;
  readonly text: string;
}
export interface VoiceSession {
  readonly generation: number;
  readonly sequence: number;
  readonly token: SessionToken | null;
  readonly binding: Binding | null;
  readonly status: VoiceStatus;
  readonly active: boolean;
  readonly permissionPending: boolean;
  readonly grantId: string | null;
  readonly capture: boolean;
  readonly dispatchInhibited: boolean;
  readonly interrupted: boolean;
  readonly speechEnabled: boolean;
  readonly speechId: number;
  readonly autoSendDiscuss: boolean;
  readonly commandMode: boolean;
  readonly draft: string;
  readonly confirmation: Confirmation | null;
  readonly correctionPending: boolean;
  readonly lastSentText: string | null;
  readonly lastSegment: number;
  readonly lastChunk: number;
  readonly requests: Readonly<Record<RequestKind, Request | null>>;
  readonly answered: readonly QuestionBinding[];
  readonly confirmed: readonly NamedAction[];
  readonly workflowStopped: boolean;
  readonly reason: string | null;
}

export type Command =
  | { readonly kind: "stop-speaking" | "pause-work" | "stop-work" | "stop-listening" | "stop" |
      "read-chapter" | "next-chapter" | "repeat-question" | "discard" }
  | { readonly kind: "correct-that"; readonly text: string }
  | { readonly kind: "undo-named-change"; readonly action: NamedAction };

export type VoiceEvent =
  | { readonly type: "start"; readonly sessionId: string; readonly generation: number;
      readonly autoSendDiscuss: boolean }
  | { readonly type: "observe" }
  | { readonly type: "settled"; readonly request: Request; readonly failure?: string }
  | ({ readonly token: SessionToken } & (
    | { readonly type: "permission"; readonly granted: boolean }
    | { readonly type: "end"; readonly reason: "hide" | "close" | "lock" | "permission-loss" | "scope-change" | "route-change" }
    | { readonly type: "command-mode"; readonly enabled: boolean }
    | { readonly type: "command"; readonly command: Command; readonly input: "control" | "spoken" }
    | { readonly type: "onset"; readonly qualifiedNearEnd: boolean }
    | { readonly type: "segment"; readonly segmentId: number }
    | { readonly type: "transcript"; readonly request: Request; readonly text: string }
    | { readonly type: "prepare"; readonly action: NamedAction }
    | { readonly type: "confirm"; readonly confirmation: Confirmation }
    | { readonly type: "send" }
    | { readonly type: "continue" }
    | { readonly type: "start-speaking"; readonly speechId: number }
    | { readonly type: "tts-chunk"; readonly speechId: number; readonly chunkId: number; readonly text: string }
    | { readonly type: "tts-ready"; readonly request: Request }
    | { readonly type: "playback-ended"; readonly request: Request }
    | { readonly type: "answer"; readonly question: QuestionBinding; readonly text: string }
  ));

/** Descriptions only: the host must execute, recheck and acknowledge them. */
export type VoiceEffect =
  | { readonly type: "request-permission" | "start-capture" | "stop-capture" | "revoke-grant" |
      "stop-playback" | "inhibit-dispatch"; readonly token: SessionToken }
  | { readonly type: "cancel-request"; readonly request: Request }
  | { readonly type: "work-control"; readonly command: "pause" | "stop"; readonly token: SessionToken }
  | { readonly type: "transcribe"; readonly request: Request; readonly segmentId: number }
  | { readonly type: "synthesize"; readonly request: Request; readonly chunkId: number; readonly text: string }
  | { readonly type: "play"; readonly request: Request }
  | { readonly type: "submit-discuss"; readonly request: Request; readonly binding: Binding; readonly text: string }
  | { readonly type: "confirmed-intent"; readonly request: Request; readonly binding: Binding;
      readonly confirmation: Confirmation }
  | { readonly type: "new-direction"; readonly token: SessionToken; readonly binding: Binding; readonly text: string }
  | { readonly type: "answer-intent"; readonly token: SessionToken; readonly question: QuestionBinding; readonly text: string }
  | { readonly type: "present-command"; readonly token: SessionToken;
      readonly command: "read-chapter" | "next-chapter" | "repeat-question" };

export interface Transition {
  readonly state: VoiceSession;
  readonly effects: readonly VoiceEffect[];
}

const TEXT_LIMIT = 65_536;
const ANSWER_LIMIT = 64;
const textValid = (text: string) => typeof text === "string" && text.length <= TEXT_LIMIT;

export function initialVoiceSession(): VoiceSession {
  return immutable({ generation: 0, sequence: 0, token: null, binding: null, status: "stopped", active: false,
    permissionPending: false, grantId: null, capture: false, dispatchInhibited: true, interrupted: false,
    speechEnabled: false, speechId: 0, autoSendDiscuss: false, commandMode: false, draft: "", confirmation: null,
    correctionPending: false, lastSentText: null, lastSegment: 0, lastChunk: 0,
    requests: { stt: null, tts: null, work: null }, answered: [], confirmed: [], workflowStopped: false, reason: null });
}

function requestMatches(a: Request | null, b: Request): boolean {
  return !!a && sameToken(a, b) && a.id === b.id && a.kind === b.kind && sameRoute(a.route, b.route) &&
    (a.action && b.action ? sameAction(a.action, b.action) : a.action === b.action);
}

function hostReady(facts: HostFacts): boolean {
  return safeCounter(facts.now) && facts.available && facts.visible && facts.unlocked && facts.routesReady &&
    validBinding(facts.binding);
}

function granted(state: VoiceSession, facts: HostFacts): boolean {
  return !!state.token && !!state.binding && activeAudioGrant({ token: state.token, studio: state.binding,
    grant: facts.grant, now: facts.now, captureRequested: state.active }) &&
    (state.permissionPending || state.grantId === facts.grant?.grantId);
}

/** Recheck immediately before EACH external send, after every await. Never cache this result. */
export function maySend(state: VoiceSession, request: Request, facts: HostFacts): boolean {
  return state.active && !!state.token && !!state.binding && sameToken(state.token, request) &&
    hostReady(facts) && sameBinding(state.binding, facts.binding) && !state.permissionPending &&
    granted(state, facts) && requestMatches(state.requests[request.kind], request) &&
    state.requests[request.kind]?.closed === false &&
    (!request.action || (!!facts.action && sameAction(request.action, facts.action))) &&
    (request.kind === "stt" || (!state.dispatchInhibited &&
      (request.kind !== "tts" || state.speechEnabled)));
}

/** Recheck before starting decoded audio, including a result queued before Stop speaking. */
export function mayPlay(state: VoiceSession, request: Request, facts: HostFacts): boolean {
  return request.kind === "tts" && state.active && state.speechEnabled && state.status === "speaking" &&
    !state.dispatchInhibited && !!state.token && sameToken(state.token, request) && !!state.binding &&
    hostReady(facts) && sameBinding(state.binding, facts.binding) && granted(state, facts) &&
    requestMatches(state.requests.tts, request) && state.requests.tts?.closed === true;
}

/** Host checks before accepting PCM, particularly if full-duplex qualification has been lost. */
export function mayCapture(state: VoiceSession, facts: HostFacts): boolean {
  return state.active && state.capture && !state.permissionPending && !state.requests.stt &&
    !!state.binding && hostReady(facts) && sameBinding(state.binding, facts.binding) && granted(state, facts) &&
    ((!state.requests.tts && state.status !== "speaking") || facts.fullDuplexQualified);
}

/** Recheck immediately before handing an issued answer to the checked 037 authority. */
export function mayDeliverAnswer(state: VoiceSession, token: SessionToken, question: QuestionBinding, facts: HostFacts): boolean {
  return state.active && !!state.token && sameToken(state.token, token) && !!state.binding &&
    hostReady(facts) && sameBinding(state.binding, facts.binding) && granted(state, facts) &&
    !state.dispatchInhibited && !state.workflowStopped && !facts.workflowRevoked && !!facts.question &&
    sameQuestion(question, facts.question) && state.answered.some((q) => sameQuestion(q, question));
}

/** Exact local vocabulary only. Story/direction text never enters this parser without command mode. */
export function parseVoiceCommand(text: string, commandMode: boolean): Command | null {
  if (!commandMode) return null;
  const commands: Record<string, Command> = {
    stop: { kind: "stop" }, "stop speaking": { kind: "stop-speaking" }, "pause work": { kind: "pause-work" },
    "stop work": { kind: "stop-work" }, "stop listening": { kind: "stop-listening" },
    "read chapter": { kind: "read-chapter" }, "read this chapter": { kind: "read-chapter" },
    "next chapter": { kind: "next-chapter" }, "repeat question": { kind: "repeat-question" },
    "discard that": { kind: "discard" },
  };
  const key = text.trim().toLowerCase();
  return Object.hasOwn(commands, key) ? commands[key] ?? null : null;
}

export function reduceVoiceSession(previous: VoiceSession, event: VoiceEvent, facts: HostFacts): Transition {
  let state = previous;
  const effects: VoiceEffect[] = [];
  const update = (patch: Partial<VoiceSession>) => { state = { ...state, ...patch }; };
  const simple = (type: "stop-capture" | "revoke-grant" | "stop-playback" | "inhibit-dispatch" |
    "request-permission" | "start-capture") => {
    if (state.token) effects.push({ type, token: state.token });
  };
  const closeRequest = (kind: RequestKind) => {
    const request = state.requests[kind];
    if (!request || request.closed) return;
    const closed = { ...request, closed: true };
    update({ requests: { ...state.requests, [kind]: closed } });
    effects.push({ type: "cancel-request", request: closed });
  };
  const silence = () => {
    update({ speechEnabled: false });
    closeRequest("tts");
    simple("stop-playback");
  };
  const inhibit = () => {
    update({ dispatchInhibited: true, interrupted: true, confirmation: null, status: "interrupted" });
    simple("inhibit-dispatch");
  };
  const end = (reason: string, unavailable = false) => {
    closeRequest("stt");
    silence();
    simple("stop-capture");
    simple("revoke-grant");
    update({ active: false, capture: false, permissionPending: false, grantId: null,
      dispatchInhibited: true, confirmation: null, status: unavailable ? "unavailable" : "stopped", reason });
  };
  const result = (): Transition => immutable({ state, effects });
  const refuse = (reason: string): Transition => { update({ reason }); return result(); };
  const allocate = (kind: RequestKind, action: NamedAction | null = null): Request | null => {
    if (!state.token || !state.binding || state.requests[kind] || state.sequence >= Number.MAX_SAFE_INTEGER) return null;
    const route = kind === "stt" ? state.binding.stt : kind === "tts" ? state.binding.tts : state.binding.agent;
    if (!route) return null;
    const request: Request = { ...state.token, id: state.sequence + 1, kind, route, action, closed: false,
      outcome: "possibly-sent-or-charged" };
    update({ sequence: request.id, requests: { ...state.requests, [kind]: request } });
    return request;
  };
  const submitDiscuss = () => {
    if (state.binding?.mode !== "discuss" || state.dispatchInhibited ||
        !state.draft.trim() || state.draft.trim().toLowerCase() === "yes" || state.correctionPending || state.requests.work) return;
    const request = allocate("work");
    if (!request) return;
    effects.push({ type: "submit-discuss", request, binding: state.binding, text: state.draft });
    update({ lastSentText: state.draft, draft: "", confirmation: null, status: "processing",
      capture: !state.requests.stt && (!state.requests.tts || facts.fullDuplexQualified) });
    if (state.capture) simple("start-capture");
  };

  // Lifecycle/route observations are authoritative even if the triggering callback is stale.
  if (state.active && (!hostReady(facts) || !state.binding || !sameBinding(state.binding, facts.binding) ||
      (!state.permissionPending && !granted(state, facts)))) {
    end("The host, source, route or audio permission changed. Start a new conversation.", !facts.available);
  }
  if (state.confirmation && (!facts.action || !sameAction(state.confirmation.action, facts.action))) {
    update({ confirmation: null });
  }
  if (state.active && state.capture && !state.permissionPending && !mayCapture(state, facts)) {
    update({ capture: false });
    simple("stop-capture");
  }

  // Settlement is receipt-only and may release an old slot. It never resumes work or plays a result.
  if (event.type === "settled") {
    if (requestMatches(state.requests[event.request.kind], event.request)) {
      update({ requests: { ...state.requests, [event.request.kind]: null } });
      if (state.token && sameToken(state.token, event.request) && state.active && !state.permissionPending) {
        if (event.failure !== undefined) {
          inhibit();
          update({ reason: textValid(event.failure) && event.failure.trim()
            ? event.failure : "The external operation failed. Review its host receipt before continuing." });
        } else if (!state.interrupted && (state.status === "processing" || state.status === "speaking")) {
          update({ status: state.draft ? "review-needed" : state.capture ? "listening" : "held" });
        }
      }
    }
    return result();
  }
  if (event.type === "observe") return result();
  if (event.type === "start") {
    if (state.active) return refuse("End the current conversation before starting another.");
    if (!identifier(event.sessionId) || !safeCounter(event.generation) || event.generation <= state.generation) {
      return refuse("A fresh, safe session generation is required.");
    }
    if (!hostReady(facts)) {
      update({ status: "unavailable", reason: "Conversation is unavailable for this host or selected route." });
      return result();
    }
    // Unsettled old operations retain their bounded slots across reactivation, never a second STT.
    update({ ...initialVoiceSession(), generation: event.generation, sequence: state.sequence,
      token: { sessionId: event.sessionId, generation: event.generation }, binding: copyBinding(facts.binding),
      requests: state.requests, active: true, permissionPending: true, autoSendDiscuss: event.autoSendDiscuss,
      status: "requesting", reason: null });
    simple("request-permission");
    return result();
  }
  if (!state.token || !sameToken(state.token, event.token) || !state.active) return result();
  if (event.type === "end") { end(event.reason); return result(); }

  // All stop controls remain usable during an outstanding OS prompt, without confirmation.
  if (event.type === "command" && (event.input === "control" || state.commandMode)) {
    const command = event.command;
    if (command.kind === "stop" || command.kind === "stop-listening") {
      if (command.kind === "stop") {
        inhibit();
        update({ workflowStopped: true });
        closeRequest("work");
        effects.push({ type: "work-control", command: "pause", token: state.token });
      }
      end(command.kind);
      return result();
    }
    if (command.kind === "stop-speaking") {
      silence();
      update({ status: state.interrupted ? "interrupted" : state.permissionPending ? "requesting"
        : state.requests.work ? "processing" : state.capture ? "listening" : "held" });
      return result();
    }
    if (command.kind === "pause-work" || command.kind === "stop-work") {
      inhibit();
      if (command.kind === "stop-work") update({ workflowStopped: true });
      closeRequest("work");
      effects.push({ type: "work-control", command: command.kind === "pause-work" ? "pause" : "stop", token: state.token });
      return result();
    }
  }
  if (event.type === "permission") {
    if (!state.permissionPending) return result();
    if (!event.granted || !granted(state, facts)) {
      end("Microphone permission was refused. Activate again to retry.", true);
    } else {
      update({ permissionPending: false, grantId: facts.grant?.grantId ?? null, capture: !state.requests.stt,
        dispatchInhibited: false, status: state.requests.stt ? "held" : "listening" });
      if (state.capture) simple("start-capture");
    }
    return result();
  }
  if (state.permissionPending || !granted(state, facts)) return result();
  switch (event.type) {
    case "command-mode":
      update({ commandMode: event.enabled });
      break;
    case "onset": {
      if (!event.qualifiedNearEnd || !state.capture) break;
      const wasBusy = !!state.requests.work || !!state.requests.tts || state.status === "speaking";
      // Half-duplex must not claim speaker/near-end isolation.
      if ((state.status === "speaking" || state.requests.tts) && !facts.fullDuplexQualified) break;
      silence();
      simple("inhibit-dispatch");
      update({ dispatchInhibited: true, interrupted: state.interrupted || wasBusy,
        confirmation: null, status: wasBusy || state.interrupted ? "interrupted" : "listening" });
      break;
    }
    case "segment": {
      if (!state.capture || !safeCounter(event.segmentId) || event.segmentId <= state.lastSegment) break;
      const request = allocate("stt");
      if (!request) { update({ status: "held", capture: false, reason: "Transcription is still settling; capture is held." }); break; }
      update({ lastSegment: event.segmentId, capture: false, status: state.interrupted ? "interrupted" : "processing" });
      simple("stop-capture");
      effects.push({ type: "transcribe", request, segmentId: event.segmentId });
      break;
    }
    case "transcript": {
      if (!requestMatches(state.requests.stt, event.request) || !maySend(state, event.request, facts)) break;
      update({ requests: { ...state.requests, stt: null } });
      if (!textValid(event.text)) {
        inhibit();
        update({ reason: "Transcript exceeds the text bound; the host must retain it for explicit recovery." });
        break;
      }
      if (!event.text.trim()) {
        inhibit();
        update({ reason: "No matching speech. Continue explicitly when ready." });
        break;
      }
      update({ draft: event.text, confirmation: null, dispatchInhibited: state.interrupted,
        status: state.interrupted ? "interrupted" : "review-needed" });
      if (state.autoSendDiscuss && !state.commandMode) submitDiscuss();
      break;
    }
    case "prepare": {
      if (!facts.action || !validAction(event.action) || !sameAction(event.action, facts.action) ||
          event.action.sourceDigest !== state.binding?.sourceDigest || state.dispatchInhibited ||
          event.action.text !== state.draft ||
          state.confirmed.length >= ANSWER_LIMIT || state.confirmed.some((a) => sameAction(a, event.action)) ||
          state.sequence >= Number.MAX_SAFE_INTEGER) break;
      const confirmation: Confirmation = { ...state.token, id: state.sequence + 1,
        action: { ...event.action }, text: state.draft };
      update({ confirmation, sequence: confirmation.id, status: "review-needed" });
      break;
    }
    case "confirm": {
      const pending = state.confirmation;
      if (!pending || !facts.action || !sameToken(pending, event.confirmation) ||
          pending.id !== event.confirmation.id || pending.text !== event.confirmation.text ||
          !sameAction(pending.action, event.confirmation.action) || !sameAction(pending.action, facts.action) ||
          state.dispatchInhibited || state.requests.work || !state.binding) break;
      const request = allocate("work", pending.action);
      if (!request) break;
      effects.push({ type: "confirmed-intent", request, binding: state.binding, confirmation: pending });
      update({ confirmation: null, lastSentText: pending.text, draft: "", status: "processing",
        confirmed: [...state.confirmed, pending.action],
        capture: !state.requests.stt && (!state.requests.tts || facts.fullDuplexQualified) });
      if (state.capture) simple("start-capture");
      break;
    }
    case "send":
      submitDiscuss();
      break;
    case "continue":
      if (state.requests.stt || state.requests.work || state.requests.tts) {
        update({ reason: "External operations are still settling. No continuation was sent." });
        break;
      }
      if (state.correctionPending && state.binding) {
        effects.push({ type: "new-direction", token: state.token, binding: state.binding, text: state.draft });
        update({ correctionPending: false, lastSentText: null });
        // The new direction needs its own host validation/confirmation, not automatic submission.
      }
      update({ interrupted: false, dispatchInhibited: false, capture: !state.draft,
        status: state.draft ? "review-needed" : "listening", reason: null });
      if (state.capture) simple("start-capture");
      break;
    case "start-speaking":
      if (!state.dispatchInhibited && !state.requests.tts && safeCounter(event.speechId) && event.speechId > state.speechId) {
        update({ speechEnabled: true, speechId: event.speechId, lastChunk: 0 });
      }
      break;
    case "tts-chunk": {
      if (!state.speechEnabled || event.speechId !== state.speechId || state.dispatchInhibited || state.requests.tts || !safeCounter(event.chunkId) ||
          event.chunkId <= state.lastChunk || !textValid(event.text) || !event.text.trim()) break;
      const request = allocate("tts");
      if (!request) break;
      update({ speechEnabled: true, lastChunk: event.chunkId, status: "speaking" });
      if (!facts.fullDuplexQualified) { update({ capture: false }); simple("stop-capture"); }
      effects.push({ type: "synthesize", request, chunkId: event.chunkId, text: event.text });
      break;
    }
    case "tts-ready":
      if (maySend(state, event.request, facts) && event.request.kind === "tts") {
        effects.push({ type: "play", request: event.request });
        // Keep the slot until playback-ended, so duplicate audio/chunk delivery cannot overlap.
        update({ requests: { ...state.requests, tts: { ...event.request, closed: true } } });
      }
      break;
    case "playback-ended":
      if (state.status === "speaking" && state.requests.tts?.closed && requestMatches(state.requests.tts, event.request)) {
        update({ requests: { ...state.requests, tts: null }, status: "held" });
      }
      break;
    case "answer":
      if (!facts.question || facts.workflowRevoked || state.workflowStopped || state.dispatchInhibited || !validQuestion(event.question) ||
          !sameQuestion(facts.question, event.question) || !textValid(event.text) || !event.text.trim() ||
          state.answered.length >= ANSWER_LIMIT || state.answered.some((q) => sameQuestion(q, event.question))) break;
      effects.push({ type: "answer-intent", token: state.token, question: { ...event.question }, text: event.text });
      update({ answered: [...state.answered, { ...event.question }] });
      break;
    case "command": {
      if (event.input === "spoken" && !state.commandMode) break;
      const command = event.command;
      if (command.kind === "discard") {
        update({ draft: "", confirmation: null, status: state.interrupted ? "interrupted" : "held" });
      } else if (command.kind === "correct-that") {
        if (!textValid(command.text)) return refuse("Correction exceeds the text bound.");
        closeRequest("stt");
        simple("stop-capture");
        update({ draft: command.text, confirmation: null, status: "review-needed", capture: false });
        if (state.lastSentText !== null || state.requests.work) {
          inhibit();
          closeRequest("work");
          update({ correctionPending: true });
        }
      } else if (command.kind === "undo-named-change") {
        if (command.action.kind !== "undo") break;
        return reduceVoiceSession(immutable(state), { type: "prepare", token: state.token, action: command.action }, facts);
      } else if (command.kind === "read-chapter" || command.kind === "next-chapter" || command.kind === "repeat-question") {
        effects.push({ type: "present-command", token: state.token, command: command.kind });
      }
      break;
    }
  }
  return result();
}
