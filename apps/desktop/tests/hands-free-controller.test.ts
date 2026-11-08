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

/** Start and settle capture, the two events the host adapter supplies. */
function started(host: HandsFreeFacts = facts()): HandsFreeState {
  const start = step(initialHandsFreeState(), { type: "start" }, host);
  expect(start.effects.map((effect) => effect.type)).toEqual(["capture-open"]);
  const token = start.state.session.token;
  if (!token) throw new Error("Fixture failed to start a session");
  return step(start.state, { type: "capture-settled", open: true, token }, host).state;
}

/** Speak one synthetic segment and deliver its transcript. */
function spoke(state: HandsFreeState, text = "The gate was open."): HandsFreeState {
  const segment = step(state, { type: "segment", segmentId: 1 });
  expect(segment.effects.some((effect) => effect.type === "transcribe")).toBe(true);
  return step(segment.state, { type: "transcript", text }).state;
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
      reason: "No audio grant is active for this conversation. Nothing was recorded.",
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
    const open = step(start.state, { type: "capture-settled", open: true, token });
    expect(handsFreePhase(open.state)).toBe("recording");
    expect(open.effects).toEqual([]);
  });

  test("a capture the host cannot open is held, never shown as recording", () => {
    const start = step(initialHandsFreeState(), { type: "start" });
    const token = start.state.session.token;
    if (!token) throw new Error("Fixture failed to start a session");
    const failed = step(start.state, { type: "capture-settled", open: false, token, reason: "No capture adapter." });
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
    expect(segment.state.transport.slots.stt?.chunks[0]?.state).toBe("dispatched");
    expect(segment.state.transport.slots.stt?.chunks[0]?.charge).toEqual({ state: "unknown" });
    expect(handsFreePhase(segment.state)).toBe("transcribing");

    const heard = step(segment.state, { type: "transcript", text: "The gate was open." });
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
    expect(handsFreePhase(moved.state)).toBe("stopped");
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

    const settled = step(stop.state, { type: "stop-settled", ok: true });
    expect(handsFreePhase(settled.state)).toBe("stopped");
    expect(settled.state.note).toBe("Stopped.");
  });

  test("a stop the host does not confirm is never reported as stopped", () => {
    const stop = step(spoke(started()), { type: "stop" });
    const failed = step(stop.state, { type: "stop-settled", ok: false, reason: "Track stop failed." });
    expect(handsFreePhase(failed.state)).toBe("stop-unconfirmed");
    expect(failed.state.note).toContain("Stop was not confirmed");
    expect(failed.state.note).toContain("Track stop failed.");
    expect(step(failed.state, { type: "confirm" }).effects.some((effect) => effect.type === "send-turn")).toBe(false);
  });

  test("stop after dispatch aborts best-effort and keeps the charge unknown", () => {
    const state = started();
    const segment = step(state, { type: "segment", segmentId: 1 });
    expect(segment.state.transport.slots.stt?.chunks[0]?.state).toBe("dispatched");
    const stop = step(segment.state, { type: "stop" });
    expect(stop.effects.some((effect) => effect.type === "abort-transcribe")).toBe(true);
    // The abort is best-effort: the slot is retained until a real receipt, and the dispatched chunk
    // that never reported a price stays unknown rather than becoming a fabricated zero.
    expect(stop.state.transport.slots.stt?.cancelled).toBe(true);
    expect(stop.state.transport.slots.stt?.chunks[0]?.charge).toEqual({ state: "unknown" });
    expect(stop.state.lastReceipt).toBeNull();
    expect(stop.state.transport.receipts).toEqual([]);
  });

  test("a transcript that arrives after stop is ignored and cannot send", () => {
    const stop = step(spoke(started()), { type: "stop" });
    const stopped = step(stop.state, { type: "stop-settled", ok: true });
    const late = step(stopped.state, { type: "transcript", text: "A late sentence." });
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
    const heard = step(again.state, { type: "transcript", text: "A second sentence." }).state;
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
  test("a stop during transcription is a cancellation, not a permanent failure", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const stop = step(segment.state, { type: "stop" });
    const aborted = step(stop.state, { type: "transcript-failed", reason: "The transcription was aborted." });
    expect(aborted.state.session.failures.stt).toBeNull();
    expect(aborted.state.session.requests.stt).toBeNull();
    const stopped = step(aborted.state, { type: "stop-settled", ok: true });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(next.state.session.active).toBe(true);
    expect(next.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(handsFreePhase(next.state)).toBe("starting");
  });

  test("a genuine transcription failure is presented and explicitly acknowledged", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const failed = step(segment.state, { type: "transcript-failed", reason: "Provider failed." });
    expect(failed.state.session.failures.stt?.message).toBe("Provider failed.");
    expect(handsFreePhase(failed.state)).toBe("interrupted");
    const acknowledged = step(failed.state, { type: "acknowledge" });
    expect(acknowledged.state.session.failures.stt).toBeNull();
    const continued = step(acknowledged.state, { type: "continue" });
    expect(continued.effects.some((effect) => effect.type === "capture-open")).toBe(true);
  });

  test("a late successful transcript after stop releases the old request for the next session", () => {
    const segment = step(started(), { type: "segment", segmentId: 1 });
    const stop = step(segment.state, { type: "stop" });
    expect(stop.state.session.requests.stt).toBeNull();
    const late = step(stop.state, { type: "transcript", text: "A late sentence." });
    expect(late.state.session.draft).toBe("");
    const stopped = step(late.state, { type: "stop-settled", ok: true });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(handsFreePhase(next.state)).toBe("starting");
    expect(next.state.session.requests.stt).toBeNull();
  });

  test("a late capture settlement from an earlier session cannot describe a new one", () => {
    const first = step(initialHandsFreeState(), { type: "start" });
    const oldToken = first.state.session.token;
    if (!oldToken) throw new Error("Fixture failed to start a session");
    const stop = step(first.state, { type: "stop" });
    const stopped = step(stop.state, { type: "stop-settled", ok: true });
    const next = step(stopped.state, { type: "start" }, freshGrant());
    expect(next.state.capture).toBe("opening");
    const stale = step(next.state, { type: "capture-settled", open: true, token: oldToken });
    expect(stale.state.capture).toBe("opening");
  });

  test("a target change during a send marks its outcome unknown and never strands the request", () => {
    const confirm = step(spoke(started()), { type: "confirm" });
    const requestId = confirm.state.send.requestId;
    expect(requestId).not.toBeNull();
    const moved = step(
      confirm.state,
      { type: "sync" },
      facts(),
      scope({ threadId: "thread_other" }),
    );
    expect(moved.state.session.requests.work).toBeNull();
    expect(moved.state.send.status).toBe("failed");
    expect(moved.state.send.reason).toContain("outcome is unknown");
    const late = step(moved.state, { type: "send-settled", ok: true, requestId: requestId ?? 0 });
    expect(late.state.send.status).toBe("failed");
  });

  test("Continue retries a held capture and the interrupted state can continue", () => {
    const start = step(initialHandsFreeState(), { type: "start" });
    const token = start.state.session.token;
    if (!token) throw new Error("Fixture failed to start a session");
    const held = step(start.state, { type: "capture-settled", open: false, token, reason: "No device." });
    expect(handsFreePhase(held.state)).toBe("held");
    const retry = step(held.state, { type: "continue" });
    expect(retry.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(retry.state.capture).toBe("opening");

    const segment = step(started(), { type: "segment", segmentId: 1 });
    const interrupted = step(segment.state, { type: "transcript", text: " " });
    expect(handsFreePhase(interrupted.state)).toBe("interrupted");
    const continued = step(interrupted.state, { type: "continue" });
    expect(continued.effects.some((effect) => effect.type === "capture-open")).toBe(true);
    expect(handsFreePhase(continued.state)).not.toBe("interrupted");
  });
});
