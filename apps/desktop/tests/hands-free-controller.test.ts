/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  HANDS_FREE_UNCONNECTED,
  handsFreeAvailability,
  handsFreePhase,
  initialHandsFreeState,
  reduceHandsFree,
  type HandsFreeEvent,
  type HandsFreeFacts,
  type HandsFreeIntent,
  type HandsFreeScope,
  type HandsFreeState,
  type HandsFreeTransition,
} from "@ai-book-studio/app/lib/hands-free";

/*
 * 017 T017: the Discuss hands-free controller, driven entirely by synthetic host facts.
 *
 * Every case here is a promise the UI makes: nothing records before a grant, nothing sends without
 * an explicit confirm, a change of target cannot carry the words with it, and Stop is only reported
 * as Stopped after the host says so. No microphone, provider, clock or device is touched.
 */

const IDENTITY = {
  hostId: "host_synthetic",
  windowId: "synthetic-window",
  frameId: "synthetic-frame",
  origin: "file://",
  libraryId: "library_synthetic",
} as const;

const STT = {
  connectionId: "conn_synthetic_stt",
  provider: "meta",
  model: "synthetic-transcribe",
  destination: "synthetic-stt",
  voice: null,
  revision: 1,
} as const;

const AGENT = {
  connectionId: "conn_synthetic_agent",
  provider: "meta",
  model: "synthetic-chat",
  destination: "synthetic-agent",
  voice: null,
  revision: 1,
} as const;

const SCOPE = {
  bookId: "book_synthetic",
  chapterId: "chapter_synthetic",
  threadId: "thread_synthetic",
  mode: "discuss",
} as const satisfies HandsFreeScope;

function scope(overrides: Partial<HandsFreeScope> = {}): HandsFreeScope {
  return { ...SCOPE, ...overrides };
}

function facts(overrides: Partial<HandsFreeFacts> = {}): HandsFreeFacts {
  return {
    hostRevision: 1,
    now: 1_000,
    identity: IDENTITY,
    routes: { stt: STT, tts: null, agent: AGENT },
    grant: {
      grantId: "grant_synthetic",
      sessionId: "session_synthetic",
      generation: 1,
      hostId: IDENTITY.hostId,
      windowId: IDENTITY.windowId,
      frameId: IDENTITY.frameId,
      origin: IDENTITY.origin,
      active: true,
      audioOnly: true,
      expiresAt: 60_000,
    },
    sourceDigest: "sha256:synthetic-source",
    available: true,
    visible: true,
    unlocked: true,
    ...overrides,
  };
}

function step(
  state: HandsFreeState,
  intent: HandsFreeIntent,
  host: HandsFreeFacts | null = facts(),
  target: HandsFreeScope = SCOPE,
): HandsFreeTransition {
  return reduceHandsFree(state, { ...intent, facts: host, scope: target } as HandsFreeEvent);
}

function stopIdentity(state: HandsFreeState) {
  const { token, attemptId } = state.stop;
  if (!token || attemptId === null) throw new Error("No owned shutdown");
  return { token, attemptId, purpose: "shutdown" as const };
}

/** Start and settle capture, the two events the host adapter supplies. */
function started(host: HandsFreeFacts = facts()): HandsFreeState {
  const start = step(initialHandsFreeState(), { type: "start" }, host);
  expect(start.effects.map((effect) => effect.type)).toEqual(["capture-open"]);
  const token = start.state.session.token;
  if (!token) throw new Error("Fixture failed to start a session");
  return step(start.state, { type: "capture-settled", open: true, token, attemptId: start.state.captureAttempt ?? 0 }, host).state;
}

/** The exact transport operation a result must name to settle its slot. */
function sttOp(state: HandsFreeState): { operationId: number; chunkId: number } {
  const operation = state.transport.slots.stt;
  const chunkId = operation?.chunks[0]?.chunkId;
  if (!operation || chunkId === undefined) throw new Error("No STT operation is outstanding");
  return { operationId: operation.operationId, chunkId };
}

/** Admit only after capture closes, as the host runner does at the adapter boundary. */
function admit(segment: HandsFreeTransition, host: HandsFreeFacts | null = facts(), target: HandsFreeScope = SCOPE): HandsFreeState {
  const effect = segment.effects.find((entry) => entry.type === "transcribe");
  if (!effect) throw new Error("No queued transcription effect");
  return step(segment.state, {
    type: "dispatch-transcribe", requestId: effect.requestId,
    operationId: effect.operationId, chunkId: effect.chunkId, ready: true,
  }, host, target).state;
}

/** Speak one synthetic segment and deliver its transcript. */
function spoke(state: HandsFreeState, text = "The gate was open."): HandsFreeState {
  const segment = step(state, { type: "segment", segmentId: 1 });
  expect(segment.effects.some((effect) => effect.type === "transcribe")).toBe(true);
  const dispatched = admit(segment);
  return step(dispatched, { type: "transcript", text, ...sttOp(dispatched) }).state;
}

describe("hands-free availability", () => {
  test("no host adapter means nothing can be recorded, and Start does nothing", () => {
    expect(handsFreeAvailability(SCOPE, null)).toEqual({ ready: false, reason: HANDS_FREE_UNCONNECTED });
    const refused = step(initialHandsFreeState(), { type: "start" }, null);
    expect(refused.effects).toEqual([]);
    expect(refused.state.session.active).toBe(false);
    expect(handsFreePhase(refused.state)).toBe("unavailable");
    expect(refused.state.availability).toEqual({ ready: false, reason: HANDS_FREE_UNCONNECTED });
  });

  test("no active grant is refused by name, not by a permission prompt", () => {
    const noGrant = facts({ grant: null });
    expect(handsFreeAvailability(SCOPE, noGrant).ready).toBe(false);
    expect(handsFreeAvailability(SCOPE, noGrant)).toEqual({
      ready: false,
      reason: "No audio grant is active for this conversation.",
    });
    const expired = facts({ now: 70_000 });
    expect(handsFreeAvailability(SCOPE, expired).ready).toBe(false);
    const refused = step(initialHandsFreeState(), { type: "start" }, noGrant);
    expect(refused.effects).toEqual([]);
    expect(handsFreePhase(refused.state)).toBe("unavailable");
  });

  test("a turn needs a real chapter and thread to bind to", () => {
    const noChapter = handsFreeAvailability(scope({ chapterId: null }), facts());
    expect(noChapter.ready).toBe(false);
    if (!noChapter.ready) expect(noChapter.reason).toContain("Open a chapter");
    const noThread = handsFreeAvailability(scope({ threadId: null }), facts());
    expect(noThread.ready).toBe(false);
    if (!noThread.ready) expect(noThread.reason).toContain("thread to join");
    const noRoutes = handsFreeAvailability(SCOPE, facts({ routes: null }));
    expect(noRoutes.ready).toBe(false);
  });
});

describe("session start and binding", () => {
  test("the grant's own session identity becomes the session, and capture opens once", () => {
    const start = step(initialHandsFreeState(), { type: "start" });
    expect(start.effects.map((effect) => effect.type)).toEqual(["capture-open"]);
    expect(start.state.session.token).toEqual({ sessionId: "session_synthetic", generation: 1 });
    expect(start.state.binding).toMatchObject({
      bookId: SCOPE.bookId,
      chapterId: SCOPE.chapterId,
      threadId: SCOPE.threadId,
      mode: "discuss",
      sourceDigest: "sha256:synthetic-source",
    });
    expect(handsFreePhase(start.state)).toBe("starting");
    expect(start.state.session.dispatchInhibited).toBe(false);

    const token = start.state.session.token;
    if (!token) throw new Error("Fixture failed to start a session");
    const open = step(start.state, { type: "capture-settled", open: true, token, attemptId: start.state.captureAttempt ?? 0 });
    expect(handsFreePhase(open.state)).toBe("recording");
    expect(open.effects).toEqual([]);
  });

  test("a capture the host cannot open is held, never shown as recording", () => {
    const start = step(initialHandsFreeState(), { type: "start" });
    const token = start.state.session.token;
    if (!token) throw new Error("Fixture failed to start a session");
    const failed = step(start.state, { type: "capture-settled", open: false, token, attemptId: start.state.captureAttempt ?? 0, reason: "No capture adapter." });
    expect(handsFreePhase(failed.state)).toBe("held");
    expect(failed.state.capture).toBe("failed");
    expect(failed.state.note).toBe("No capture adapter.");
  });

  test("losing the grant ends the session without sending anything", () => {
    const state = started();
    const revoked = step(state, { type: "sync" }, facts({ grant: null }));
    expect(revoked.state.session.active).toBe(false);
    expect(revoked.state.session.dispatchInhibited).toBe(true);
    expect(revoked.effects.some((effect) => effect.type === "capture-close")).toBe(true);
    expect(revoked.effects.some((effect) => effect.type === "send-turn")).toBe(false);
  });
});

describe("transcript, correction and one explicit confirm", () => {
  test("a transcript is editable words, not a sent turn", () => {
    const state = started();
    const segment = step(state, { type: "segment", segmentId: 1 });
    const transcribe = segment.effects.find((effect) => effect.type === "transcribe");
    expect(transcribe).toBeDefined();
    expect(segment.state.transport.slots.stt?.chunks[0]?.state).toBe("queued");
    expect(segment.state.transport.slots.stt?.chunks[0]?.charge).toEqual({ state: "unsent" });
    expect(handsFreePhase(segment.state)).toBe("transcribing");

    const dispatched = admit(segment);
    expect(dispatched.transport.slots.stt?.chunks[0]?.state).toBe("dispatched");
    expect(dispatched.transport.slots.stt?.chunks[0]?.charge).toEqual({ state: "unknown" });
    const heard = step(dispatched, { type: "transcript", text: "The gate was open.", ...sttOp(dispatched) });
    expect(heard.state.session.draft).toBe("The gate was open.");
    expect(handsFreePhase(heard.state)).toBe("correcting");
    expect(heard.effects.some((effect) => effect.type === "send-turn")).toBe(false);
    expect(heard.state.transport.slots.stt).toBeNull();
    expect(heard.state.lastReceipt?.unknownChunks).toBe(1);
  });

  test("a correction edits the draft only", () => {
    const state = spoke(started());
    const corrected = step(state, { type: "correct", text: "The gate was locked." });
    expect(corrected.state.session.draft).toBe("The gate was locked.");
    expect(corrected.effects.some((effect) => effect.type === "send-turn")).toBe(false);
    expect(handsFreePhase(corrected.state)).toBe("correcting");
  });

  test("clearing a correction keeps editing open until explicit discard", () => {
    const cleared = step(spoke(started()), { type: "correct", text: "" });
    expect(cleared.state.session.draft).toBe("");
    expect(handsFreePhase(cleared.state)).toBe("correcting");
    expect(step(cleared.state, { type: "confirm" }).effects).toEqual([]);
    const retyped = step(cleared.state, { type: "correct", text: "Replacement words." });
    expect(retyped.state.session.draft).toBe("Replacement words.");
    expect(handsFreePhase(retyped.state)).toBe("correcting");
    const discarded = step(cleared.state, { type: "discard" });
    expect(handsFreePhase(discarded.state)).toBe("held");
  });

  test("confirm sends exactly one turn to the bound book, chapter and thread", () => {
    const state = spoke(started());
    const confirm = step(state, { type: "confirm" });
    expect(confirm.effects.filter((effect) => effect.type === "send-turn")).toHaveLength(1);
    const turn = confirm.effects.find((effect) => effect.type === "send-turn");
    expect(turn).toEqual({
      type: "send-turn",
      requestId: expect.any(Number),
      turn: {
        text: "The gate was open.",
        bookId: SCOPE.bookId,
        chapterId: SCOPE.chapterId,
        threadId: SCOPE.threadId,
        mode: "discuss",
      },
    });
    expect(handsFreePhase(confirm.state)).toBe("confirming");

    // A second confirm while the first is in flight is refused, so the author sends once.
    const duplicate = step(confirm.state, { type: "confirm" });
    expect(duplicate.effects).toEqual([]);
    expect(duplicate.state.note).toBe("The turn is already being sent.");

    const settled = step(confirm.state, { type: "send-settled", ok: true, requestId: confirm.state.send.requestId ?? 0 });
    expect(settled.state.send.status).toBe("sent");
    expect(settled.state.session.requests.work).toBeNull();
    expect(settled.state.note).toBe("Sent to this conversation.");
    // The draft is gone from the session; a late confirm cannot send it again.
    expect(settled.state.session.draft).toBe("");
    expect(step(settled.state, { type: "confirm" }).effects).toEqual([]);
  });

  test("a refused send keeps the words, says why, and offers no automatic retry", () => {
    const state = spoke(started());
    const confirm = step(state, { type: "confirm" });
    const failed = step(confirm.state, {
      type: "send-settled", ok: false, requestId: confirm.state.send.requestId ?? 0, reason: "Synthetic refusal."
    });
    expect(failed.state.send.status).toBe("failed");
    expect(failed.state.note).toBe("Synthetic refusal.");
    expect(failed.state.preserved).toBe("The gate was open.");
    expect(failed.state.session.dispatchInhibited).toBe(true);
    expect(step(failed.state, {
      type: "send-settled", ok: true, requestId: confirm.state.send.requestId ?? 0
    }).state.send.status).toBe("failed");
  });
});

describe("target changes discard the words", () => {
  test("a different conversation ends the session and cannot send the old draft", () => {
    const state = spoke(started());
    const moved = step(state, { type: "sync" }, facts(), scope({ threadId: "thread_other" }));
    expect(moved.state.session.active).toBe(false);
    expect(moved.state.session.draft).toBe("");
    expect(moved.state.binding).toBeNull();
    expect(moved.state.preserved).toBe("The gate was open.");
    expect(handsFreePhase(moved.state)).toBe("stopping");
    expect(moved.state.note).toContain("changed");

    const confirmed = step(moved.state, { type: "confirm" }, facts(), scope({ threadId: "thread_other" }));
    expect(confirmed.effects.some((effect) => effect.type === "send-turn")).toBe(false);
  });

  test("a confirm that arrives after the target moved is refused even without an observation", () => {
    const state = spoke(started());
    const confirmed = step(state, { type: "confirm" }, facts(), scope({ chapterId: "chapter_other" }));
    expect(confirmed.effects.some((effect) => effect.type === "send-turn")).toBe(false);
    expect(confirmed.state.note).toBe("The book, chapter or conversation changed. Nothing was sent.");
  });
});

describe("truthful stop", () => {
  test.each([true, false].flatMap((sendOk) => [true, false].flatMap((closeOk) =>
    ["send-first", "close-first"].map((order) => [sendOk, closeOk, order] as const))))(
    "a dispatched send and closure retain independent receipts (send=%s close=%s %s)",
    (sendOk, closeOk, order) => {
      const confirmed = step(spoke(started()), { type: "confirm" }).state;
      const requestId = confirmed.send.requestId;
      if (requestId === null) throw new Error("No dispatched turn");
      const dispatched = step(confirmed, { type: "send-dispatched", requestId }).state;
      const stopping = step(dispatched, { type: "stop" }).state;
      const close = { type: "stop-settled" as const, ok: closeOk, ...stopIdentity(stopping),
        ...(!closeOk ? { reason: "Track still open." } : {}) };
      const send = { type: "send-settled" as const, ok: sendOk, requestId,
        ...(!sendOk ? { reason: "Turn failed after dispatch." } : {}) };
      const first = step(stopping, order === "send-first" ? send : close).state;
      const settled = step(first, order === "send-first" ? close : send).state;
      expect(settled.send.status).toBe(sendOk ? "sent" : "failed");
      expect(settled.note).toBe(sendOk ? "Sent to this conversation." : "Turn failed after dispatch.");
      expect(settled.stop.status).toBe(closeOk ? "stopped" : "failed");
      expect(handsFreePhase(settled)).toBe(closeOk ? "stopped" : "stop-unconfirmed");
      if (!closeOk) expect(settled.stop.reason).toBe("Track still open.");
    },
  );

  test("stop says stopping until the host settles, then stopped", () => {
    const state = spoke(started());
    const stop = step(state, { type: "stop" });
    expect(handsFreePhase(stop.state)).toBe("stopping");
    expect(stop.state.session.active).toBe(false);
    expect(stop.state.session.dispatchInhibited).toBe(true);
    expect(stop.effects.some((effect) => effect.type === "capture-close")).toBe(true);
    expect(stop.state.preserved).toBe("The gate was open.");

    const lateConfirm = step(stop.state, { type: "confirm" });
    expect(lateConfirm.effects.some((effect) => effect.type === "send-turn")).toBe(false);

    const settled = step(stop.state, { type: "stop-settled", ok: true, ...stopIdentity(stop.state) });
    expect(handsFreePhase(settled.state)).toBe("stopped");
    expect(settled.state.note).toBe("Stopped.");
  });

  test("a stop the host does not confirm is never reported as stopped", () => {
    const stop = step(spoke(started()), { type: "stop" });
    const failed = step(stop.state, { type: "stop-settled", ok: false, ...stopIdentity(stop.state), reason: "Track stop failed." });
    expect(handsFreePhase(failed.state)).toBe("stop-unconfirmed");
    expect(failed.state.note).toContain("Stop was not confirmed");
    expect(failed.state.note).toContain("Track stop failed.");
    expect(step(failed.state, { type: "confirm" }).effects.some((effect) => effect.type === "send-turn")).toBe(false);
  });

  test("stop after dispatch aborts best-effort and keeps the charge unknown", () => {
    const state = started();
    const segment = step(state, { type: "segment", segmentId: 1 });
    const dispatched = admit(segment);
    expect(dispatched.transport.slots.stt?.chunks[0]?.state).toBe("dispatched");
    const stop = step(dispatched, { type: "stop" });
    expect(stop.effects.some((effect) => effect.type === "abort-transcribe")).toBe(true);
    // The abort is best-effort: the slot is retained until a real receipt, and the dispatched chunk
    // that never reported a price stays unknown rather than becoming a fabricated zero.
    expect(stop.state.transport.slots.stt?.cancelled).toBe(true);
    expect(stop.state.transport.slots.stt?.chunks[0]?.charge).toEqual({ state: "unknown" });
    expect(stop.state.lastReceipt).toBeNull();
    expect(stop.state.transport.receipts).toEqual([]);
  });

  test("Stop before admission settles queued audio as unsent and a late admission cannot reopen it", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const stop = step(segment.state, { type: "stop" });
    expect(stop.state.transport.slots.stt).toBeNull();
    expect(stop.state.session.requests.stt).toBeNull();
    expect(stop.state.lastReceipt).toMatchObject({ unsentChunks: 1, unknownChunks: 0, outcome: "cancellation" });
    expect(stop.effects.some((effect) => effect.type === "abort-transcribe")).toBe(false);
    const late = admit({ ...segment, state: stop.state });
    expect(late.transport).toEqual(stop.state.transport);
    expect(late.session.active).toBe(false);
  });

  test("fresh permission, route, visibility and scope changes refuse queued audio without a send", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const changedHosts = [
      null, facts({ grant: null }), facts({ now: 70_000 }), facts({ visible: false }),
      facts({ unlocked: false }), facts({ sourceDigest: "sha256:changed" }),
      facts({ routes: { stt: { ...STT, revision: 2 }, tts: null, agent: AGENT } }),
    ];
    for (const host of changedHosts) {
      const denied = admit(segment, host);
      expect(denied.transport.slots.stt).toBeNull();
      expect(denied.session.requests.stt).toBeNull();
      expect(denied.lastReceipt).toMatchObject({ unsentChunks: 1, unknownChunks: 0 });
    }
    const moved = admit(segment, facts(), scope({ threadId: "thread_other" }));
    expect(moved.transport.slots.stt).toBeNull();
    expect(moved.lastReceipt).toMatchObject({ unsentChunks: 1, unknownChunks: 0 });
  });

  test("foreign or duplicate transcript results cannot consume another operation", () => {
    const dispatched = admit(step(started(), { type: "segment", segmentId: 1 }));
    const operation = sttOp(dispatched);
    for (const identity of [
      { ...operation, operationId: operation.operationId + 1 },
      { ...operation, chunkId: operation.chunkId + 1 },
    ]) {
      const foreign = step(dispatched, { type: "transcript", text: "Foreign words.", ...identity });
      expect(foreign.state.session.draft).toBe("");
      expect(foreign.state.session.requests.stt).toEqual(dispatched.session.requests.stt);
      expect(foreign.state.transport).toEqual(dispatched.transport);
      const failure = step(dispatched, { type: "transcript-failed", reason: "Foreign failure.", ...identity });
      expect(failure.state.session.failures.stt).toBeNull();
      expect(failure.state.transport).toEqual(dispatched.transport);
    }
    const completed = step(dispatched, { type: "transcript", text: "First words.", ...operation }).state;
    const discarded = step(completed, { type: "discard" }).state;
    const resumed = step(discarded, { type: "continue" }).state;
    const next = admit(step(resumed, { type: "segment", segmentId: 2 }));
    const late = step(next, { type: "transcript", text: "Late duplicate.", ...operation });
    expect(late.state.transport).toEqual(next.transport);
    expect(late.state.session.requests.stt).toEqual(next.session.requests.stt);
    expect(late.state.session.draft).toBe("");
  });

  test("a transcript that arrives after stop is ignored and cannot send", () => {
    const stop = step(spoke(started()), { type: "stop" });
    const stopped = step(stop.state, { type: "stop-settled", ok: true, ...stopIdentity(stop.state) });
    // No operation is outstanding here: the success already settled it, so this duplicate cannot
    // name a real slot and must be ignored without touching another operation.
    const late = step(stopped.state, {
      type: "transcript", text: "A late sentence.", operationId: 999, chunkId: 1
    });
    expect(late.effects).toEqual([]);
    expect(late.state.ignoredTranscripts).toBe(1);
    expect(late.state.session.draft).toBe("");
    expect(late.state.note).toContain("ignored");
    expect(step(late.state, { type: "confirm" }).effects).toEqual([]);
  });

  test("stop with nothing running settles immediately without inventing a session", () => {
    const stop = step(initialHandsFreeState(), { type: "stop" });
    expect(stop.effects).toEqual([]);
    expect(stop.state.note).toBe("Nothing was recording.");
    expect(handsFreePhase(stop.state)).toBe("stopped");
  });
});

describe("after-send correction", () => {
  test("correcting words after a sent turn holds instead of silently sending", () => {
    const state = spoke(started());
    const confirm = step(state, { type: "confirm" });
    const sent = step(confirm.state, { type: "send-settled", ok: true, requestId: confirm.state.send.requestId ?? 0 }).state;
    const again = step(sent, { type: "segment", segmentId: 2 });
    const dispatched = admit(again);
    const heard = step(dispatched, { type: "transcript", text: "A second sentence.", ...sttOp(dispatched) }).state;
    const corrected = step(heard, { type: "correct", text: "A corrected sentence." });
    expect(corrected.state.session.correctionPending).toBe(true);
    expect(corrected.state.note).toContain("Continue before sending");
    const refused = step(corrected.state, { type: "confirm" });
    expect(refused.effects.some((effect) => effect.type === "send-turn")).toBe(false);
    expect(refused.state.note).toContain("Continue first");

    const continued = step(corrected.state, { type: "continue" });
    expect(continued.state.session.correctionPending).toBe(false);
    // Continue clears the hold; it never sends by itself.
    expect(continued.effects.some((effect) => effect.type === "send-turn")).toBe(false);
    const confirmed = step(continued.state, { type: "confirm" });
    expect(confirmed.effects.filter((effect) => effect.type === "send-turn")).toHaveLength(1);
    expect(confirmed.effects.find((effect) => effect.type === "send-turn")).toMatchObject({
      turn: { text: "A corrected sentence.", threadId: SCOPE.threadId },
    });
  });
});

function freshGrant(): HandsFreeFacts {
  const grant = facts().grant;
  if (!grant) throw new Error("Fixture has no grant");
  return facts({ grant: { ...grant, generation: 2 } });
}

describe("stop and recovery settlement identity", () => {
  test.each([true, false])("R3: old hold/shutdown receipts cannot settle a newer Stop (ok=%s)", (ok) => {
    const hold = step(started(), { type: "segment", segmentId: 1 });
    const oldClose = hold.effects.find((effect) => effect.type === "capture-close");
    if (!oldClose) throw new Error("Missing hold close");
    const stop = step(hold.state, { type: "stop" });
    const oldStop = stopIdentity(stop.state);
    const heldReceipt = step(stop.state, { ...oldClose, type: "stop-settled", ok });
    expect(heldReceipt.state.stop.status).toBe("stopping");
    expect(step(stop.state, { type: "start" }, freshGrant()).effects).toEqual([]);
    const stopped = step(stop.state, { type: "stop-settled", ok: true, ...oldStop });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    const nextStop = step(next.state, { type: "stop" }, freshGrant());
    const foreignToken = step(nextStop.state, { type: "stop-settled", ...stopIdentity(nextStop.state),
      token: oldStop.token, ok }, freshGrant());
    expect(foreignToken.state.stop).toEqual(nextStop.state.stop);
    for (const receipt of [oldClose, oldStop]) {
      const stale = step(nextStop.state, { ...receipt, type: "stop-settled", ok }, freshGrant());
      expect(stale.state.stop).toEqual(nextStop.state.stop);
    }
    const failed = step(nextStop.state, { type: "stop-settled", ok: false,
      ...stopIdentity(nextStop.state), reason: "New generation still open." }, freshGrant());
    expect(handsFreePhase(failed.state)).toBe("stop-unconfirmed");
    expect(failed.state.stop.reason).toBe("New generation still open.");
  });

  test.each([true, false])("R3: same-session old attempt cannot settle a retried Stop (ok=%s)", (ok) => {
    const stop = step(started(), { type: "stop" });
    const oldIdentity = stopIdentity(stop.state);
    const failed = step(stop.state, { type: "stop-settled", ...oldIdentity, ok: false, reason: "Still open." });
    const retry = step(failed.state, { type: "stop" });
    expect(retry.state.stop.attemptId).toBeGreaterThan(oldIdentity.attemptId);
    expect(retry.state.stop.token).toEqual(oldIdentity.token);
    const stale = step(retry.state, { type: "stop-settled", ...oldIdentity, ok });
    expect(stale.state.stop.status).toBe("stopping");
    const actual = step(stale.state, { type: "stop-settled", ...stopIdentity(retry.state), ok: false, reason: "Retry failed." });
    expect(actual.state.stop.reason).toBe("Retry failed.");
  });

  test("R2: same-token earlier capture attempt cannot settle a newer Continue", () => {
    const first = step(initialHandsFreeState(), { type: "start" });
    const token = first.state.session.token;
    if (!token) throw new Error("Missing token");
    const failed = step(first.state, { type: "capture-settled", token,
      attemptId: first.state.captureAttempt ?? 0, open: false });
    const retry = step(failed.state, { type: "continue" });
    expect(retry.state.captureAttempt).not.toBe(first.state.captureAttempt);
    for (const open of [true, false]) {
      const stale = step(retry.state, { type: "capture-settled", token,
        attemptId: first.state.captureAttempt ?? 0, open });
      expect(stale.state.capture).toBe("opening");
    }
  });

  test("an unavailable Start preserves monotonic request identity and cannot bypass active capture cleanup", () => {
    const active = started();
    const revoked = step(active, { type: "start" }, facts({ grant: null }));
    expect(revoked.effects.filter((effect) => effect.type === "capture-close")).toHaveLength(1);
    expect(revoked.state.stop.status).toBe("stopping");
    const sent = step(spoke(active), { type: "confirm" });
    const receipt = step(sent.state, { type: "send-settled", ok: true, requestId: sent.state.send.requestId ?? 0 });
    const stop = step(receipt.state, { type: "stop" });
    const stopped = step(stop.state, { type: "stop-settled", ...stopIdentity(stop.state), ok: true });
    const unavailable = step(stopped.state, { type: "start" }, facts({ grant: null }));
    expect(unavailable.state.session.sequence).toBe(receipt.state.session.sequence);
  });

  test("R5: an old transport receipt never releases a foreign same-session core request", () => {
    const dispatched = admit(step(started(), { type: "segment", segmentId: 1 }));
    const old = dispatched.session.requests.stt;
    if (!old) throw new Error("Missing STT request");
    // Adversarial receipt fixture: core identity differs even though session/generation match.
    const foreign = { ...old, id: old.id + 1 };
    const state = { ...dispatched, session: { ...dispatched.session,
      requests: { ...dispatched.session.requests, stt: foreign } } };
    for (const event of [
      { type: "transcript" as const, text: "Old words.", ...sttOp(dispatched) },
      { type: "transcript-failed" as const, reason: "Old failure.", ...sttOp(dispatched) },
    ]) {
      const receipt = step(state, event);
      expect(receipt.state.transport.slots.stt).toBeNull();
      expect(receipt.state.session.requests.stt?.id).toBe(foreign.id);
      expect(receipt.state.session.draft).toBe("");
      expect(receipt.state.session.failures.stt).toBeNull();
      expect(receipt.state.lastReceipt?.unknownChunks).toBe(1);
    }
  });

  test("a stop during transcription is a cancellation, not a permanent failure", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const stop = step(admit(segment), { type: "stop" });
    const aborted = step(stop.state, { type: "transcript-failed", reason: "The transcription was aborted.", ...sttOp(stop.state) });
    expect(aborted.state.session.failures.stt).toBeNull();
    expect(aborted.state.session.requests.stt).toBeNull();
    const stopped = step(aborted.state, { type: "stop-settled", ok: true, ...stopIdentity(stop.state) });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(next.state.session.active).toBe(true);
    expect(next.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(handsFreePhase(next.state)).toBe("starting");
  });

  test("a genuine transcription failure is presented and explicitly acknowledged", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const dispatched = admit(segment);
    const failed = step(dispatched, { type: "transcript-failed", reason: "Provider failed.", ...sttOp(dispatched) });
    expect(failed.state.session.failures.stt?.message).toBe("Provider failed.");
    expect(handsFreePhase(failed.state)).toBe("interrupted");
    const acknowledged = step(failed.state, { type: "acknowledge" });
    expect(acknowledged.state.session.failures.stt).toBeNull();
    const continued = step(acknowledged.state, { type: "continue" });
    expect(continued.effects.some((effect) => effect.type === "capture-open")).toBe(true);
  });

  test("a late successful transcript after stop releases the old request for the next session", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const stop = step(admit(segment), { type: "stop" });
    expect(stop.state.session.requests.stt).toBeNull();
    const late = step(stop.state, { type: "transcript", text: "A late sentence.", ...sttOp(stop.state) });
    expect(late.state.session.draft).toBe("");
    expect(late.state.transport.slots.stt).toBeNull();
    const stopped = step(late.state, { type: "stop-settled", ok: true, ...stopIdentity(stop.state) });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(handsFreePhase(next.state)).toBe("starting");
    expect(next.state.session.requests.stt).toBeNull();
  });

  test("a target change while recording tells the host to close capture", () => {
    const recording = started();
    expect(handsFreePhase(recording)).toBe("recording");
    const moved = step(recording, { type: "sync" }, facts(), scope({ threadId: "thread_other" }));
    expect(moved.effects.filter((effect) => effect.type === "capture-close")).toHaveLength(1);
    expect(handsFreePhase(moved.state)).toBe("stopping");
    const stopped = step(
      moved.state, { type: "stop-settled", ok: true, ...stopIdentity(moved.state) }, facts(), scope({ threadId: "thread_other" })
    );
    expect(handsFreePhase(stopped.state)).toBe("stopped");
  });

  test("a late capture settlement from an earlier session cannot describe a new one", () => {
    const first = step(initialHandsFreeState(), { type: "start" });
    const oldToken = first.state.session.token;
    if (!oldToken) throw new Error("Fixture failed to start a session");
    const stop = step(first.state, { type: "stop" });
    const stopped = step(stop.state, { type: "stop-settled", ok: true, ...stopIdentity(stop.state) });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(next.state.capture).toBe("opening");
    const stale = step(next.state, { type: "capture-settled", open: true, token: oldToken, attemptId: first.state.captureAttempt ?? 0 });
    expect(stale.state.capture).toBe("opening");
  });

  test("a target change during a dispatched send retains its attributable outcome", () => {
    const confirm = step(spoke(started()), { type: "confirm" });
    const requestId = confirm.state.send.requestId;
    expect(requestId).not.toBeNull();
    const moved = step(
      step(confirm.state, { type: "send-dispatched", requestId: requestId ?? 0 }).state,
      { type: "sync" },
      facts(),
      scope({ threadId: "thread_other" }),
    );
    expect(moved.state.session.requests.work).toBeNull();
    expect(moved.state.send.status).toBe("sending");
    expect(moved.state.note).toContain("outcome is unknown");
    const late = step(moved.state, { type: "send-settled", ok: true, requestId: requestId ?? 0 });
    expect(late.state.send.status).toBe("sent");
  });

  test("Continue retries a held capture and the interrupted state can continue", () => {
    const start = step(initialHandsFreeState(), { type: "start" });
    const token = start.state.session.token;
    if (!token) throw new Error("Fixture failed to start a session");
    const held = step(start.state, { type: "capture-settled", open: false, token, attemptId: start.state.captureAttempt ?? 0, reason: "No device." });
    expect(handsFreePhase(held.state)).toBe("held");
    const retry = step(held.state, { type: "continue" });
    expect(retry.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(retry.state.capture).toBe("opening");

    const segment = step(started(), { type: "segment", segmentId: 1 });
    const dispatched = admit(segment);
    const interrupted = step(dispatched, { type: "transcript", text: " ", ...sttOp(dispatched) });
    expect(handsFreePhase(interrupted.state)).toBe("interrupted");
    const continued = step(interrupted.state, { type: "continue" });
    expect(continued.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(handsFreePhase(continued.state)).not.toBe("interrupted");
  });
});
