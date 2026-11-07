import { expect, test } from "bun:test";
import { initialVoiceSession, mayCapture, mayDeliverAnswer, mayPlay, maySend, reduceVoiceSession,
  type QuestionBinding, type Request, type RequestKind, type VoiceSession } from "../../src/voice-session";
import { action, facts, grant, harness, token } from "./fixtures";

const question: QuestionBinding = { runId: "run", questionId: "question", characterId: "character",
  directionRevision: 1, questionRevision: 1, sourceDigest: "synthetic-source-hash", authorityRevision: 1 };
function pending(state: VoiceSession, kind: RequestKind): Request {
  const request = state.requests[kind];
  if (!request) throw new Error(`Missing ${kind} fixture request`);
  return request;
}
function speech(h: ReturnType<typeof harness>, id = 1): Request {
  h.send({ type: "start-speaking", token, speechId: id });
  h.send({ type: "tts-chunk", token, speechId: id, chunkId: 1, text: "Synthetic speech" });
  return pending(h.state, "tts");
}
function operation(h: ReturnType<typeof harness>, kind: RequestKind): Request {
  if (kind === "tts") return speech(h);
  if (kind === "stt") h.send({ type: "segment", token, segmentId: 1 });
  else h.transcript("Synthetic work");
  return pending(h.state, kind);
}

test.each(["pause-work", "stop-work", "stop", "stop-listening", "stop-speaking"] as const)(
  "permission completion preserves the distinct %s control", (kind) => {
    const host = { ...facts(), action: action(), question };
    let state = reduceVoiceSession(initialVoiceSession(), { type: "start", ...token, autoSendDiscuss: true }, host).state;
    state = reduceVoiceSession(state, { type: "command", token, input: "control", command: { kind } }, host).state;
    const permission = reduceVoiceSession(state, { type: "permission", token, granted: true }, host);
    state = permission.state;
    const ended = kind === "stop" || kind === "stop-listening";
    const inhibited = kind !== "stop-speaking";
    expect(state.active).toBe(!ended);
    expect(state.dispatchInhibited).toBe(inhibited);
    expect(state.speechEnabled).toBe(false);
    expect(mayCapture(state, host)).toBe(!ended);
    if (inhibited) {
      const started = reduceVoiceSession(state, { type: "start-speaking", token, speechId: 1 }, host);
      const chunk = reduceVoiceSession(started.state, { type: "tts-chunk", token, speechId: 1, chunkId: 1, text: "Queued speech" }, host);
      expect(chunk.effects).toEqual([]);
      expect(chunk.state.requests.tts).toBeNull();
      expect(reduceVoiceSession(state, { type: "prepare", token, action: host.action }, host).state.confirmation).toBeNull();
      expect(reduceVoiceSession(state, { type: "answer", token, question, text: "Queued answer" }, host).effects).toEqual([]);
      expect(mayDeliverAnswer(state, token, question, host)).toBe(false);
      if (!ended) {
        expect(state.status).toBe("interrupted");
        const continued = reduceVoiceSession(state, { type: "continue", token }, host).state;
        expect(continued.dispatchInhibited).toBe(false);
        const answered = reduceVoiceSession(continued, { type: "answer", token, question, text: "Explicit answer" }, host);
        expect(answered.effects.some(e => e.type === "answer-intent")).toBe(kind === "pause-work");
      } else expect(permission.effects).toEqual([]);
    }
  },
);

test.each(["stt", "tts", "work"] as const)("%s failed receipts survive Stop, lifecycle, prompt and reactivation", (kind) => {
  for (const boundary of ["stop", "stop-listening", "hide", "permission-pending", "new-session"] as const) {
    const h = harness({ autoSend: true });
    const request = operation(h, kind);
    if (boundary === "hide") h.send({ type: "end", token, reason: "hide" });
    else h.send({ type: "command", token, input: "control", command: { kind: boundary === "stop-listening" ? boundary : "stop" } });
    const nextToken = { sessionId: "new-session", generation: 2 };
    if (boundary === "new-session" || boundary === "permission-pending") {
      h.setHost({ ...h.host, grant: grant(nextToken) });
      h.send({ type: "start", ...nextToken, autoSendDiscuss: true });
      if (boundary === "new-session") {
        h.send({ type: "permission", token: nextToken, granted: true });
        h.send({ type: "command", token: nextToken, input: "control", command: { kind: "correct-that", text: "New draft" } });
      }
    }
    const before = h.state;
    const heldRequest = pending(before, kind);
    const failure = `Synthetic ${kind} failed after ${boundary}`;
    const result = h.send({ type: "settled", request, failure });
    expect(result.state.requests[kind]).toBeNull();
    expect(result.state.failures[kind]).toEqual({ request: heldRequest, message: failure });
    expect(result.state.failures[kind]?.request).toMatchObject({ ...token, id: request.id, kind });
    expect(Object.isFrozen(result.state.failures[kind])).toBe(true);
    expect(result.state.active).toBe(before.active);
    expect(result.state.status).toBe(before.status);
    expect(result.state.capture).toBe(before.capture);
    expect(result.state.draft).toBe(before.draft);
    expect(result.effects).toEqual([]);
    expect(h.send({ type: "settled", request, failure: "Duplicate cannot overwrite" }).state.failures[kind]?.message).toBe(failure);
    h.send({ type: "acknowledge-failure", request: { ...request, id: request.id + 1 } });
    expect(h.state.failures[kind]?.message).toBe(failure);
    h.send({ type: "acknowledge-failure", request });
    expect(h.state.failures[kind]).toBeNull();
    expect(h.state.capture).toBe(before.capture);
    expect(h.state.draft).toBe(before.draft);
  }
});

test("failure acknowledgement is exact and bounded; it neither resumes nor erases a replacement receipt", () => {
  const h = harness();
  const first = speech(h);
  h.send({ type: "settled", request: first, failure: "Synthetic first failure" });
  expect(h.send({ type: "continue", token }).state.dispatchInhibited).toBe(true);
  expect(h.state.reason).toContain("acknowledge");
  h.send({ type: "command", token, input: "control", command: { kind: "stop-listening" } });
  const nextToken = { sessionId: "next-session", generation: 2 };
  h.setHost({ ...h.host, grant: grant(nextToken) });
  h.send({ type: "start", ...nextToken, autoSendDiscuss: false });
  h.send({ type: "permission", token: nextToken, granted: true });
  expect(h.state.failures.tts?.request.id).toBe(first.id);
  expect(h.state.dispatchInhibited).toBe(true);
  h.send({ type: "start-speaking", token: nextToken, speechId: 2 });
  expect(h.send({ type: "tts-chunk", token: nextToken, speechId: 2, chunkId: 1, text: "No reuse" }).effects).toEqual([]);
  h.send({ type: "acknowledge-failure", request: first });
  expect(h.state.dispatchInhibited).toBe(true);
  h.send({ type: "continue", token: nextToken });
  h.send({ type: "start-speaking", token: nextToken, speechId: 2 });
  h.send({ type: "tts-chunk", token: nextToken, speechId: 2, chunkId: 1, text: "Explicit new speech" });
  const second = pending(h.state, "tts");
  h.send({ type: "settled", request: second, failure: "x".repeat(65_537) });
  const failure = h.state.failures.tts;
  expect(failure?.message).toBe("The external operation failed. Review its host receipt before continuing.");
  h.send({ type: "acknowledge-failure", request: first });
  expect(h.state.failures.tts).toBe(failure);
  expect(Object.values(h.state.failures).filter(Boolean)).toHaveLength(1);
});

test.each([true, false])("work settlement preserves queued/ready playback with full duplex %s", (fullDuplexQualified) => {
  for (const readyFirst of [true, false]) {
    const h = harness({ autoSend: true, host: { ...facts(), fullDuplexQualified } });
    h.transcript("Synthetic work");
    const work = pending(h.state, "work");
    const tts = speech(h);
    if (readyFirst) h.send({ type: "tts-ready", token, request: tts });
    h.send({ type: "settled", request: work });
    expect(h.state.status).toBe("speaking");
    if (!readyFirst) {
      expect(maySend(h.state, tts, h.host)).toBe(true);
      h.send({ type: "tts-ready", token, request: tts });
    }
    expect(mayPlay(h.state, tts, h.host)).toBe(true);
    const capture = h.state.capture;
    h.send({ type: "playback-ended", token, request: tts });
    expect(h.state.requests.tts).toBeNull();
    expect(h.state.playbackReady).toBe(false);
    expect(h.state.capture).toBe(capture);
    expect(h.state.status).toBe(fullDuplexQualified ? "listening" : "held");
    expect(h.send({ type: "continue", token }).state.capture).toBe(true);
  }
});

test.each(["pause-work", "stop-work", "correct-that"] as const)("%s cannot strand actual playback completion", (kind) => {
  const h = harness({ autoSend: true });
  h.transcript("Original work");
  const work = pending(h.state, "work");
  const tts = speech(h);
  h.send({ type: "tts-ready", token, request: tts });
  expect(mayPlay(h.state, tts, h.host)).toBe(true);
  const command = kind === "correct-that" ? { kind, text: "New direction" } : { kind };
  h.send({ type: "command", token, input: "control", command });
  expect(mayPlay(h.state, tts, h.host)).toBe(false);
  const capture = h.state.capture;
  h.send({ type: "playback-ended", token, request: tts });
  expect(h.state.requests.tts).toBeNull();
  expect(h.state.dispatchInhibited).toBe(true);
  expect(h.state.status).toBe("interrupted");
  expect(h.state.capture).toBe(capture);
  h.send({ type: "settled", request: work });
  const continued = h.send({ type: "continue", token });
  expect(continued.state.dispatchInhibited).toBe(false);
  expect(continued.effects.some(e => e.type === "new-direction")).toBe(kind === "correct-that");
});

test("playback receipts release only admitted exact TTS, including after Stop/new generation", () => {
  const h = harness();
  const tts = speech(h);
  h.send({ type: "playback-ended", token, request: tts });
  expect(h.state.requests.tts?.id).toBe(tts.id);
  h.send({ type: "tts-ready", token, request: tts });
  h.send({ type: "command", token, input: "control", command: { kind: "stop" } });
  const nextToken = { sessionId: "next-session", generation: 2 };
  h.setHost({ ...h.host, grant: grant(nextToken) });
  h.send({ type: "start", ...nextToken, autoSendDiscuss: false });
  h.send({ type: "permission", token: nextToken, granted: true });
  const capture = h.state.capture;
  h.send({ type: "playback-ended", token: nextToken, request: tts });
  expect(h.state.requests.tts?.id).toBe(tts.id);
  h.send({ type: "playback-ended", token, request: tts });
  expect(h.state.requests.tts).toBeNull();
  expect(h.state.capture).toBe(capture);
  expect(h.state.speechEnabled).toBe(false);
  h.send({ type: "start-speaking", token: nextToken, speechId: 2 });
  h.send({ type: "tts-chunk", token: nextToken, speechId: 2, chunkId: 1, text: "New speech" });
  const second = pending(h.state, "tts");
  h.send({ type: "tts-ready", token: nextToken, request: second });
  h.send({ type: "playback-ended", token, request: tts });
  expect(h.state.requests.tts?.id).toBe(second.id);
  expect(mayPlay(h.state, second, h.host)).toBe(true);
});
