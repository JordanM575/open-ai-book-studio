import { expect, test } from "bun:test";
import {
  type Binding, type Command, type Confirmation, initialVoiceSession, mayCapture, mayDeliverAnswer, mayPlay, maySend, parseVoiceCommand,
  type QuestionBinding, reduceVoiceSession, type Request, type RequestKind, type VoiceSession,
} from "../../src/voice-session";
import { action, facts, grant, harness, token } from "./fixtures";

function request(state: VoiceSession, kind: RequestKind): Request {
  const value = state.requests[kind];
  if (!value) throw new Error(`Expected a synthetic ${kind} request.`);
  return value;
}
function confirmation(state: VoiceSession): Confirmation {
  if (!state.confirmation) throw new Error("Expected an exact confirmation.");
  return state.confirmation;
}
const question = (): QuestionBinding => ({ runId: "synthetic-run", questionId: "synthetic-question",
  characterId: "synthetic-character", directionRevision: 1, questionRevision: 1,
  sourceDigest: "synthetic-source-hash", authorityRevision: 1 });
const stop = (kind: "stop" | "stop-speaking" | "stop-work" | "pause-work" | "stop-listening") =>
  ({ type: "command", token, command: { kind }, input: "control" } as const);
const startSpeech = (h: ReturnType<typeof harness>, speechId = 1) => {
  h.send({ type: "start-speaking", token, speechId });
  return h.send({ type: "tts-chunk", token, speechId, chunkId: 1, text: "Synthetic reply." });
};

test("open, reload, Settings and route observations never activate or send", () => {
  const host = facts();
  for (const routesReady of [true, false, true]) {
    const result = reduceVoiceSession(initialVoiceSession(), { type: "observe" }, { ...host, routesReady });
    expect(result.effects).toEqual([]);
    expect(result.state.active).toBe(false);
    expect(result.state.capture).toBe(false);
  }
  expect(reduceVoiceSession(initialVoiceSession(), { type: "permission", token, granted: true }, host).effects).toEqual([]);
});

test.each([
  { available: false }, { routesReady: false }, { visible: false }, { unlocked: false }, { now: Infinity },
])("explicit Start refuses missing host/capability/selected-route facts: %j", (patch) => {
  const result = reduceVoiceSession(initialVoiceSession(), { type: "start", ...token, autoSendDiscuss: true }, { ...facts(), ...patch });
  expect(result.effects).toEqual([]);
  expect(result.state.status).toBe("unavailable");
});

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("unsafe Start generation %p is refused", (generation) => {
  const result = reduceVoiceSession(initialVoiceSession(), { type: "start", ...token, generation, autoSendDiscuss: true }, facts());
  expect(result.effects).toEqual([]);
  expect(result.state.active).toBe(false);
});

test("only explicit Start then exact active permission grant can capture", () => {
  const host = facts();
  const started = reduceVoiceSession(initialVoiceSession(), { type: "start", ...token, autoSendDiscuss: true }, host);
  expect(started.effects.map((e) => e.type)).toEqual(["request-permission"]);
  expect(started.state.capture).toBe(false);
  const pendingSend = reduceVoiceSession(started.state, { type: "segment", token, segmentId: 1 }, host);
  expect(pendingSend.effects).toEqual([]);
  const permitted = reduceVoiceSession(started.state, { type: "permission", token, granted: true }, host);
  expect(permitted.state.status).toBe("listening");
  expect(permitted.effects.map((e) => e.type)).toEqual(["start-capture"]);
  const denied = reduceVoiceSession(started.state, { type: "permission", token, granted: false }, host);
  expect(denied.state.active).toBe(false);
  expect(denied.state.status).toBe("unavailable");
  expect(reduceVoiceSession(denied.state, { type: "permission", token, granted: true }, host).effects).toEqual([]);
});

test("stop during OS prompt releases ownership; a late grant cannot reopen it", () => {
  const host = facts();
  const started = reduceVoiceSession(initialVoiceSession(), { type: "start", ...token, autoSendDiscuss: true }, host);
  const stopped = reduceVoiceSession(started.state, stop("stop-listening"), host);
  expect(stopped.effects.map((e) => e.type)).toContain("revoke-grant");
  const late = reduceVoiceSession(stopped.state, { type: "permission", token, granted: true }, host);
  expect(late.state.capture).toBe(false);
  expect(late.effects).toEqual([]);
});

test.each(["hide", "close", "lock", "permission-loss", "scope-change", "route-change"] as const)(
  "%s ends capture and reopening requires a fresh explicit activation", (reason) => {
    const h = harness();
    const ended = h.send({ type: "end", token, reason });
    expect(ended.state.status).toBe("stopped");
    expect(ended.effects.map((e) => e.type)).toContain("stop-capture");
    expect(h.send({ type: "observe" }).state.active).toBe(false);
    expect(h.send({ type: "start", ...token, autoSendDiscuss: false }).state.active).toBe(false);
    const nextToken = { sessionId: "synthetic-session-2", generation: 2 };
    h.setHost({ ...h.host, grant: grant(nextToken) });
    h.send({ type: "start", ...nextToken, autoSendDiscuss: false });
    expect(h.send({ type: "permission", token, granted: true }).state.capture).toBe(false);
    expect(h.send({ type: "permission", token: nextToken, granted: true }).state.capture).toBe(true);
  },
);

test.each([
  { libraryId: "other" }, { bookId: "other" }, { chapterId: "other" }, { threadId: "other" },
  { hostId: "other" }, { windowId: "other" }, { frameId: "other" }, { origin: "other" },
  { sourceDigest: "edited" }, { mode: "edit" as const }, { scopeRevision: 3 },
])("current scope mismatch refuses before STT and invalidates permission: %j", (patch) => {
  const h = harness();
  h.setHost({ ...h.host, binding: { ...h.host.binding, ...patch } });
  const result = h.send({ type: "segment", token, segmentId: 1 });
  expect(result.effects.some((e) => e.type === "transcribe")).toBe(false);
  expect(result.state.active).toBe(false);
});

test("scope and route ABA revisions cannot revive a former binding", () => {
  for (const scope of [true, false]) {
    const h = harness();
    h.send({ type: "segment", token, segmentId: 1 });
    const oldRequest = request(h.state, "stt");
    const binding: Binding = scope ? { ...h.host.binding, scopeRevision: 3 }
      : { ...h.host.binding, stt: { ...h.host.binding.stt, revision: 3 } };
    h.setHost({ ...h.host, binding });
    expect(maySend(h.state, oldRequest, h.host)).toBe(false);
    const late = h.send({ type: "transcript", token, request: oldRequest, text: "Old scope text." });
    expect(late.state.active).toBe(false);
    expect(late.state.draft).toBe("");
    expect(late.effects.some((e) => e.type === "submit-discuss")).toBe(false);
  }
});

test.each(["stt", "tts", "agent"] as const)("pins the complete %s destination including revision", (kind) => {
  const h = harness();
  const current = h.host.binding[kind];
  if (!current) throw new Error("Missing fixture route");
  h.setHost({ ...h.host, binding: { ...h.host.binding, [kind]: { ...current, destination: "https://other.invalid" } } });
  expect(h.send({ type: "observe" }).state.active).toBe(false);
});

test("late permission replacement and grant expiry close the gate before an event is reduced", () => {
  for (const host of [{ ...facts(), now: 100_000 }, { ...facts(), grant: { ...grant(), grantId: "replacement" } }]) {
    const h = harness();
    h.send({ type: "segment", token, segmentId: 1 });
    expect(maySend(h.state, request(h.state, "stt"), host)).toBe(false);
    h.setHost(host);
    expect(h.send({ type: "observe" }).state.active).toBe(false);
  }
});

test("one STT in flight, immutable snapshots, exact identity and literal transcript", () => {
  const h = harness();
  const first = h.send({ type: "segment", token, segmentId: 1 });
  const stt = request(h.state, "stt");
  expect(maySend(h.state, stt, h.host)).toBe(true);
  expect(first.state.status).toBe("processing");
  expect(first.state.capture).toBe(false);
  expect(Object.isFrozen(first.state.binding?.stt)).toBe(true);
  expect(Object.isFrozen(first.state.requests.stt)).toBe(true);
  expect(h.send({ type: "segment", token, segmentId: 2 }).effects).toEqual([]);
  expect(h.send({ type: "transcript", token, request: { ...stt, id: 999 }, text: "Wrong." }).state.draft).toBe("");
  const literal = "𝒜 — café\n\n詩の行\n  indented";
  const result = h.send({ type: "transcript", token, request: stt, text: literal });
  expect(result.state.draft).toBe(literal);
  expect(result.state.status).toBe("review-needed");
  expect(result.effects).toEqual([]);
  expect(h.send({ type: "transcript", token, request: stt, text: "Duplicate." }).state.draft).toBe(literal);
});

test("disclosed Discuss auto-send uses bound chapter/thread/mode and never authorizes Edit", () => {
  const discuss = harness({ autoSend: true });
  const result = discuss.transcript("A synthetic read-only question?\nKeep line.");
  const submitted = result.effects.find((e) => e.type === "submit-discuss");
  expect(submitted?.binding).toEqual(discuss.host.binding);
  expect(submitted?.text).toBe("A synthetic read-only question?\nKeep line.");
  expect(discuss.state.capture).toBe(true);
  expect(discuss.state.status).toBe("processing");
  const edit = harness({ autoSend: true, host: { ...facts(), binding: { ...facts().binding, mode: "edit" } } });
  expect(edit.transcript("Replace the chapter.").effects).toEqual([]);
  expect(edit.send({ type: "send", token }).effects).toEqual([]);
  expect(edit.state.status).toBe("review-needed");
});

test("command mode is explicit; prose, cancel and bare yes cannot become authority", () => {
  expect(parseVoiceCommand("stop", false)).toBeNull();
  expect(parseVoiceCommand('She said, "cancel the operation".', true)).toBeNull();
  expect(parseVoiceCommand("cancel", true)).toBeNull();
  expect(parseVoiceCommand("yes", true)).toBeNull();
  expect(parseVoiceCommand("constructor", true)).toBeNull();
  expect(parseVoiceCommand(" Stop speaking ", true)).toEqual({ kind: "stop-speaking" });
  const h = harness({ autoSend: true });
  expect(h.send({ ...stop("stop"), input: "spoken" }).state.active).toBe(true);
  h.send({ type: "command-mode", token, enabled: true });
  expect(h.transcript("yes").effects).toEqual([]);
  expect(h.state.requests.work).toBeNull();
  expect(h.send({ ...stop("stop"), input: "spoken" }).state.active).toBe(false);
});

test.each(["edit", "destructive-approval", "undo", "destination", "workflow-grant"] as const)(
  "%s requires an exact immutable named confirmation; consumption is single use", (kind) => {
    const a = { ...action("Recognized\nrequest."), kind };
    const h = harness({ host: { ...facts(), action: a } });
    h.transcript("Recognized\nrequest.");
    const prepared = h.send({ type: "prepare", token, action: a });
    expect(prepared.effects).toEqual([]);
    const c = confirmation(h.state);
    expect(Object.isFrozen(c.action)).toBe(true);
    for (const altered of [
      { ...c, id: c.id + 1 }, { ...c, text: "Other request." },
      { ...c, action: { ...c.action, targetId: "other" } },
      { ...c, action: { ...c.action, sourceDigest: "other" } },
      { ...c, action: { ...c.action, digest: "other" } },
      { ...c, action: { ...c.action, command: "Other command" } },
    ]) expect(h.send({ type: "confirm", token, confirmation: altered }).effects).toEqual([]);
    const accepted = h.send({ type: "confirm", token, confirmation: c });
    expect(accepted.effects.map((e) => e.type)).toEqual(["confirmed-intent", "start-capture"]);
    expect(h.state.confirmation).toBeNull();
    expect(h.send({ type: "confirm", token, confirmation: c }).effects).toEqual([]);
    h.send({ type: "settled", request: request(h.state, "work") });
    expect(h.send({ type: "prepare", token, action: a }).state.confirmation).toBeNull();
    // Only an intent; no workflow grant, file writer or preference mutator exists here.
  },
);

test("stale host action/source or permission cannot confirm an earlier readback", () => {
  for (const stale of ["action", "source", "permission"]) {
    const h = harness({ host: { ...facts(), action: action() } });
    h.send({ type: "prepare", token, action: action() });
    const c = confirmation(h.state);
    h.setHost(stale === "action" ? { ...h.host, action: { ...action(), digest: "changed" } }
      : stale === "source" ? { ...h.host, binding: { ...h.host.binding, sourceDigest: "changed" } }
        : { ...h.host, grant: null });
    const result = h.send({ type: "confirm", token, confirmation: c });
    expect(result.effects.some((e) => e.type === "confirmed-intent")).toBe(false);
    expect(result.state.confirmation).toBeNull();
  }
});

test("before-send correction replaces only pending text and cancels stale recognition", () => {
  const h = harness();
  h.send({ type: "segment", token, segmentId: 1 });
  const stt = request(h.state, "stt");
  const corrected = h.send({ type: "command", token, input: "control",
    command: { kind: "correct-that", text: "New\n\nverse." } });
  expect(corrected.state.draft).toBe("New\n\nverse.");
  expect(corrected.state.correctionPending).toBe(false);
  expect(maySend(corrected.state, stt, h.host)).toBe(false);
  h.send({ type: "transcript", token, request: stt, text: "Late replacement" });
  expect(h.state.draft).toBe("New\n\nverse.");
});

test("after-send correction inhibits, waits for actual settlement and emits new direction without recall", () => {
  const h = harness({ autoSend: true });
  h.transcript("Original request.");
  const work = request(h.state, "work");
  const corrected = h.send({ type: "command", token, input: "control",
    command: { kind: "correct-that", text: "New direction." } });
  expect(corrected.state.lastSentText).toBe("Original request.");
  expect(corrected.state.status).toBe("interrupted");
  expect(corrected.effects.map((e) => e.type)).toContain("inhibit-dispatch");
  expect(h.send({ type: "continue", token }).effects).toEqual([]);
  h.setHost({ ...h.host, now: 90_000 });
  expect(h.send({ type: "continue", token }).effects).toEqual([]);
  expect(h.state.correctionPending).toBe(true);
  h.send({ type: "settled", request: work });
  const continued = h.send({ type: "continue", token });
  expect(continued.effects.map((e) => e.type)).toEqual(["new-direction"]);
  expect(continued.state.draft).toBe("New direction.");
  expect(continued.state.requests.work).toBeNull();
});

test.each(["stop-speaking", "pause-work", "stop-work", "stop-listening", "stop"] as const)(
  "%s has distinct immediate effects and preserves unresolved truth", (kind) => {
    const h = harness({ autoSend: true });
    h.transcript("Synthetic work.");
    const work = request(h.state, "work");
    startSpeech(h);
    const tts = request(h.state, "tts");
    const stopped = h.send(stop(kind));
    const types = stopped.effects.map((e) => e.type);
    if (kind === "stop-speaking") {
      expect(h.state.active).toBe(true);
      expect(h.state.dispatchInhibited).toBe(false);
      expect(maySend(h.state, work, h.host)).toBe(true);
      expect(types).toContain("stop-playback");
    } else if (kind === "stop-listening") {
      expect(h.state.active).toBe(false);
      expect(types).toContain("stop-capture");
      expect(types).not.toContain("work-control");
      expect(h.state.requests.work?.closed).toBe(false);
    } else {
      expect(h.state.dispatchInhibited).toBe(true);
      expect(maySend(h.state, work, h.host)).toBe(false);
      expect(types).toContain("work-control");
      expect(h.state.active).toBe(kind !== "stop");
    }
    expect(h.state.requests.work?.outcome).toBe("possibly-sent-or-charged");
    expect(h.state.requests.tts?.outcome).toBe("possibly-sent-or-charged");
    if (kind !== "pause-work" && kind !== "stop-work") expect(maySend(h.state, tts, h.host)).toBe(false);
  },
);

test("qualified onset silences/inhibits locally before STT and no-match never auto-continues", () => {
  const h = harness({ autoSend: true });
  startSpeech(h);
  const tts = request(h.state, "tts");
  const onset = h.send({ type: "onset", token, qualifiedNearEnd: true });
  expect(onset.effects.map((e) => e.type)).toEqual(["cancel-request", "stop-playback", "inhibit-dispatch"]);
  expect(onset.state.status).toBe("interrupted");
  expect(onset.state.requests.stt).toBeNull();
  expect(maySend(onset.state, tts, h.host)).toBe(false);
  expect(h.transcript("").state.status).toBe("interrupted");
  h.send({ type: "settled", request: tts });
  expect(h.state.status).toBe("interrupted");
  expect(h.send({ type: "continue", token }).state.status).toBe("listening");
});

test("unqualified noise cannot interrupt and a half-duplex host holds capture during playback", () => {
  const h = harness({ host: { ...facts(), fullDuplexQualified: false } });
  expect(h.send({ type: "onset", token, qualifiedNearEnd: false }).effects).toEqual([]);
  startSpeech(h);
  expect(h.state.capture).toBe(false);
  expect(h.send({ type: "onset", token, qualifiedNearEnd: true }).effects).toEqual([]);
  expect(h.state.status).toBe("speaking");
  expect(h.send(stop("stop-speaking")).effects.map((e) => e.type)).toContain("stop-playback");
});

test("Stop speaking prevents all future chunks and late ready/playback events until fresh speaking action", () => {
  const h = harness();
  startSpeech(h);
  const tts = request(h.state, "tts");
  const ready = h.send({ type: "tts-ready", token, request: tts });
  expect(ready.effects.map((e) => e.type)).toEqual(["play"]);
  expect(mayPlay(h.state, tts, h.host)).toBe(true);
  expect(h.send({ type: "tts-ready", token, request: tts }).effects).toEqual([]);
  h.send(stop("stop-speaking"));
  expect(mayPlay(h.state, tts, h.host)).toBe(false);
  h.send({ type: "settled", request: tts });
  expect(h.send({ type: "tts-chunk", token, speechId: 1, chunkId: 2, text: "Late chunk." }).effects).toEqual([]);
  expect(h.send({ type: "tts-ready", token, request: tts }).effects).toEqual([]);
  startSpeech(h, 2);
  const current = request(h.state, "tts");
  h.send({ type: "tts-ready", token, request: current });
  h.send({ type: "playback-ended", token, request: tts });
  expect(h.state.requests.tts?.id).toBe(current.id);
  expect(h.send({ type: "tts-chunk", token, speechId: 1, chunkId: 3, text: "Old sequence." }).effects).toEqual([]);
  h.send({ type: "playback-ended", token, request: current });
  expect(h.send({ type: "tts-chunk", token, speechId: 2, chunkId: 2, text: "Current sequence." }).effects[0]?.type).toBe("synthesize");
});

test("never-settling external operations do not delay stop or get a fictitious terminal receipt", () => {
  const h = harness();
  h.send({ type: "segment", token, segmentId: 1 });
  const old = request(h.state, "stt");
  const neverSettles = new Promise<void>(() => {});
  void neverSettles; // No timer or awaiting external settlement in the reducer.
  const stopped = h.send(stop("stop"));
  expect(stopped.state.capture).toBe(false);
  expect(stopped.state.requests.stt?.closed).toBe(true);
  expect(stopped.state.requests.stt?.outcome).toBe("possibly-sent-or-charged");
  const next = { sessionId: "new-session", generation: 2 };
  h.setHost({ ...h.host, grant: grant(next) });
  h.send({ type: "start", ...next, autoSendDiscuss: true });
  h.send({ type: "permission", token: next, granted: true });
  expect(h.state.status).toBe("held");
  expect(h.send({ type: "segment", token: next, segmentId: 1 }).effects).toEqual([]);
  h.send({ type: "transcript", token, request: old, text: "Late old text." });
  expect(h.state.draft).toBe("");
  h.send({ type: "settled", request: old });
  expect(h.state.capture).toBe(false);
  expect(h.send({ type: "continue", token: next }).state.capture).toBe(true);
  const fresh = h.send({ type: "segment", token: next, segmentId: 1 });
  expect(fresh.effects.map((e) => e.type)).toContain("transcribe");
  h.send({ type: "settled", request: old });
  expect(h.state.requests.stt?.generation).toBe(2);
});

test("check-in intents bind stable run/question/character/direction and reject duplicates or revoke", () => {
  const q = question();
  const h = harness({ host: { ...facts(), question: q } });
  for (const patch of [{ runId: "other" }, { questionId: "other" }, { characterId: "same-name-different-id" },
    { directionRevision: 2 }, { questionRevision: 2 }, { authorityRevision: 2 }, { sourceDigest: "other" }]) {
    expect(h.send({ type: "answer", token, question: { ...q, ...patch }, text: "Answer" }).effects).toEqual([]);
  }
  expect(h.send({ type: "answer", token, question: q, text: "" }).effects).toEqual([]);
  expect(h.send({ type: "answer", token, question: q, text: "Character direction." }).effects[0]?.type).toBe("answer-intent");
  expect(h.send({ type: "answer", token, question: q, text: "Duplicate." }).effects).toEqual([]);
  const nextQuestion = { ...q, questionId: "next", directionRevision: 2 };
  h.setHost({ ...h.host, question: nextQuestion, workflowRevoked: true });
  expect(h.send({ type: "answer", token, question: nextQuestion, text: "Late." }).effects).toEqual([]);
  h.setHost({ ...h.host, workflowRevoked: false });
  h.send(stop("stop-work"));
  expect(h.send({ type: "answer", token, question: nextQuestion, text: "Late after stop." }).effects).toEqual([]);
});

test("question de-duplication memory is bounded; host remains the durable answer authority", () => {
  const h = harness();
  for (let i = 0; i < 65; i++) {
    const q = { ...question(), questionId: `synthetic-${i}` };
    h.setHost({ ...h.host, question: q });
    const result = h.send({ type: "answer", token, question: q, text: "Synthetic answer." });
    expect(result.effects.length).toBe(i < 64 ? 1 : 0);
  }
  expect(h.state.answered.length).toBe(64);
});

test("named undo, read chapter, next chapter, repeat question and discard are typed intents", () => {
  const a = { ...action(), kind: "undo" as const };
  const h = harness({ host: { ...facts(), action: a } });
  const commands: Command[] = [{ kind: "read-chapter" }, { kind: "next-chapter" }, { kind: "repeat-question" }];
  for (const command of commands) {
    expect(h.send({ type: "command", token, input: "control", command }).effects[0]?.type).toBe("present-command");
  }
  h.send({ type: "command", token, input: "control", command: { kind: "undo-named-change", action: a } });
  expect(confirmation(h.state).action.kind).toBe("undo");
  h.send({ type: "command", token, input: "control", command: { kind: "discard" } });
  expect(h.state.confirmation).toBeNull();
  expect(h.state.draft).toBe("");
});

test("sequence exhaustion refuses rather than rounding/reusing request or confirmation IDs", () => {
  const h = harness({ host: { ...facts(), action: action() } });
  const exhausted = { ...h.state, sequence: Number.MAX_SAFE_INTEGER };
  expect(reduceVoiceSession(exhausted, { type: "segment", token, segmentId: 1 }, h.host).effects).toEqual([]);
  expect(reduceVoiceSession(exhausted, { type: "prepare", token, action: action() }, h.host).effects).toEqual([]);
});

test("a forged request route cannot pass dispatch or deliver a result under a genuine ID", () => {
  const h = harness();
  h.send({ type: "segment", token, segmentId: 1 });
  const stt = request(h.state, "stt");
  const forged = { ...stt, route: { ...stt.route, destination: "https://foreign.invalid" } };
  expect(maySend(h.state, forged, h.host)).toBe(false);
  expect(h.send({ type: "transcript", token, request: forged, text: "Forged." }).state.draft).toBe("");
  h.send({ type: "settled", request: forged });
  expect(h.state.requests.stt?.id).toBe(stt.id);
});

test("bare yes never sends or answers by itself, even with Discuss auto-send disclosed", () => {
  const h = harness({ autoSend: true });
  expect(h.transcript(" yes ").effects).toEqual([]);
  expect(h.send({ type: "send", token }).effects).toEqual([]);
  expect(h.state.draft).toBe(" yes ");
});

test("loss of full-duplex qualification closes capture before the next read", () => {
  const h = harness();
  startSpeech(h);
  expect(mayCapture(h.state, h.host)).toBe(true);
  h.setHost({ ...h.host, fullDuplexQualified: false });
  expect(mayCapture(h.state, h.host)).toBe(false);
  expect(h.send({ type: "observe" }).effects.map((e) => e.type)).toContain("stop-capture");
  expect(h.state.capture).toBe(false);
});

test("Stop work rejects a late question even after listening is explicitly continued", () => {
  const h = harness({ host: { ...facts(), question: question() } });
  h.send(stop("stop-work"));
  h.send({ type: "continue", token });
  expect(h.send({ type: "answer", token, question: question(), text: "Late answer." }).effects).toEqual([]);
});

test("confirmation readback must cover exact pending text, not just a valid target and digest label", () => {
  const h = harness({ host: { ...facts(), action: action("Earlier text.") } });
  h.transcript("Changed text.");
  expect(h.send({ type: "prepare", token, action: action("Earlier text.") }).state.confirmation).toBeNull();
  h.setHost({ ...h.host, action: action("Changed text.") });
  h.send({ type: "prepare", token, action: action("Changed text.") });
  const c = confirmation(h.state);
  h.send({ type: "confirm", token, confirmation: c });
  const work = request(h.state, "work");
  expect(maySend(h.state, work, h.host)).toBe(true);
  h.setHost({ ...h.host, action: { ...action("Changed text."), digest: "new-approval" } });
  expect(maySend(h.state, work, h.host)).toBe(false);
});

test("a queued answer loses to revoke before host delivery", () => {
  const q = question();
  const h = harness({ host: { ...facts(), question: q } });
  h.send({ type: "answer", token, question: q, text: "Synthetic answer." });
  expect(mayDeliverAnswer(h.state, token, q, h.host)).toBe(true);
  h.setHost({ ...h.host, workflowRevoked: true });
  expect(mayDeliverAnswer(h.state, token, q, h.host)).toBe(false);
});

test("a correction entered while listening holds capture so the next sentence cannot overwrite it", () => {
  const h = harness();
  h.send({ type: "command", token, input: "control", command: { kind: "correct-that", text: "Keep this draft." } });
  expect(h.state.capture).toBe(false);
  expect(h.state.status).toBe("review-needed");
  expect(h.send({ type: "segment", token, segmentId: 1 }).effects).toEqual([]);
  expect(h.state.draft).toBe("Keep this draft.");
});

test("half-duplex Stop speaking reports held capture rather than claiming to listen", () => {
  const h = harness({ host: { ...facts(), fullDuplexQualified: false } });
  startSpeech(h);
  h.send(stop("stop-speaking"));
  expect(h.state.capture).toBe(false);
  expect(h.state.status).toBe("held");
});

test("actual settlement clears processing; a failed receipt stays visible and inhibited", () => {
  const h = harness({ autoSend: true });
  h.transcript("Synthetic request.");
  h.send({ type: "settled", request: request(h.state, "work") });
  expect(h.state.status).toBe("listening");
  h.transcript("Another synthetic request.");
  h.send({ type: "settled", request: request(h.state, "work"), failure: "Synthetic persistence failed." });
  expect(h.state.status).toBe("interrupted");
  expect(h.state.dispatchInhibited).toBe(true);
  expect(h.state.reason).toBe("Synthetic persistence failed.");
});
