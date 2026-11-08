import { expect, test } from "bun:test";
import {
  initialTransportLedger, mayDispatch, reduceTransport, type Route, type TransportEvent,
  type TransportFacts, type TransportLedger, type TransportTransition,
} from "../../src/voice-session";
import { route as fixtureRoute, token } from "./fixtures";

const route = (revision = 1): Route => ({ ...fixtureRoute("synthetic-tts"), revision });
const facts = (overrides: Partial<TransportFacts> = {}): TransportFacts => ({
  now: 1_000, session: token, route: route(), permitted: true, ...overrides,
});

function harness() {
  let ledger: TransportLedger = initialTransportLedger();
  const send = (event: TransportEvent): TransportTransition => {
    const result = reduceTransport(ledger, event);
    ledger = result.ledger;
    return result;
  };
  return { send, get ledger(): TransportLedger { return ledger; } };
}

function begin(host: ReturnType<typeof harness>, kind: "stt" | "tts", planned: number) {
  const result = host.send({ type: "begin", kind, planned, facts: facts() });
  const operation = result.ledger.slots[kind];
  if (!operation) throw new Error(`Fixture failed to begin ${kind}`);
  return operation;
}

function dispatched(host: ReturnType<typeof harness>, kind: "stt" | "tts", planned = 1) {
  const operation = begin(host, kind, planned);
  host.send({ type: "chunk", operationId: operation.operationId });
  const send = host.send({
    type: "dispatch", operationId: operation.operationId, chunkId: 1, facts: facts(),
  });
  return { operationId: operation.operationId, send };
}

test("operation and chunk IDs are monotonic and every send effect carries the pinned route and session", () => {
  const h = harness();
  const stt = begin(h, "stt", 1);
  const tts = begin(h, "tts", 2);
  expect([stt.operationId, tts.operationId]).toEqual([1, 2]);

  expect(h.send({ type: "chunk", operationId: tts.operationId }).ledger.slots.tts?.chunks[0]?.chunkId).toBe(1);
  const first = h.send({
    type: "dispatch", operationId: tts.operationId, chunkId: 1, facts: facts(),
  });
  expect(first.effects).toEqual([{
    type: "send", operationId: tts.operationId, chunkId: 1, kind: "tts", route: route(),
  }]);
  expect(first.ledger.slots.tts?.chunks[0]).toMatchObject({ chunkId: 1, state: "dispatched" });

  // One request at a time: a second chunk cannot be allocated over an outstanding one.
  const overlap = h.send({ type: "chunk", operationId: tts.operationId });
  expect(overlap.effects).toEqual([]);
  expect(overlap.ledger.reason).toContain("one request at a time");

  h.send({ type: "settle", operationId: tts.operationId, chunkId: 1, outcome: "success", costUsd: 0.25 });
  expect(h.send({ type: "chunk", operationId: tts.operationId }).ledger.slots.tts?.chunks[1]?.chunkId).toBe(2);
  const second = h.send({
    type: "dispatch", operationId: tts.operationId, chunkId: 2, facts: facts(),
  });
  expect(second.effects).toHaveLength(1);
  expect(second.effects[0]).toMatchObject({ type: "send", chunkId: 2, kind: "tts" });
  expect(h.send({
    type: "settle", operationId: tts.operationId, chunkId: 2, outcome: "success",
  }).ledger.receipts[0]).toMatchObject({ outcome: "success", reportedUsd: 0.25, unknownChunks: 1 });
});

test.each([
  ["route revision", { route: route(2) }],
  ["permission revocation", { permitted: false }],
  ["session replacement", { session: { sessionId: "synthetic-session", generation: 2 } }],
] as const)("per-chunk check refuses the next chunk after %s without sending", (_label, override) => {
  const h = harness();
  const { operationId } = dispatched(h, "tts", 2);
  h.send({ type: "settle", operationId, chunkId: 1, outcome: "success", costUsd: 0.02 });
  h.send({ type: "chunk", operationId });

  expect(mayDispatch(h.ledger, operationId, 2, facts(override))).toBe(false);
  const refused = h.send({ type: "dispatch", operationId, chunkId: 2, facts: facts(override) });
  expect(refused.effects).toEqual([]);
  expect(refused.ledger.slots.tts).toBeNull();
  expect(refused.ledger.receipts[0]).toMatchObject({
    outcome: "refusal", reportedUsd: 0.02, unknownChunks: 0, unsentChunks: 1,
  });
  expect(refused.ledger.reason).toContain("No request was sent");
});

test("cancellation before dispatch releases the slot immediately and fabricates no charge", () => {
  const h = harness();
  const operation = begin(h, "stt", 1);
  h.send({ type: "chunk", operationId: operation.operationId });
  const cancelled = h.send({ type: "cancel", operationId: operation.operationId, reason: "Author stopped." });
  expect(cancelled.effects).toEqual([]);
  expect(cancelled.ledger.slots.stt).toBeNull();
  expect(cancelled.ledger.receipts[0]).toMatchObject({
    outcome: "cancellation", reportedUsd: 0, unknownChunks: 0, unsentChunks: 1,
  });
  expect(cancelled.ledger.receipts[0]?.operation.cancelReason).toBe("Author stopped.");
  expect(begin(h, "stt", 1).operationId).toBe(2);
});

test("cancellation after dispatch aborts best-effort, retains the slot and ignores late content", () => {
  const h = harness();
  const { operationId, send } = dispatched(h, "stt");
  expect(send.effects).toHaveLength(1);
  const cancelled = h.send({ type: "cancel", operationId, reason: "New session." });
  expect(cancelled.effects).toEqual([{ type: "abort", operationId, chunkId: 1, reason: "New session." }]);
  expect(cancelled.ledger.slots.stt?.cancelled).toBe(true);
  expect(cancelled.ledger.receipts).toEqual([]);
  // Owned-slot retention: no replacement request may overlap an unresolved paid call.
  expect(h.send({ type: "begin", kind: "stt", planned: 1, facts: facts() }).ledger.slots.stt?.operationId)
    .toBe(operationId);

  const late = h.send({ type: "settle", operationId, chunkId: 1, outcome: "success", costUsd: 0.04 });
  expect(late.effects).toEqual([]);
  expect(late.ledger.slots.stt).toBeNull();
  expect(late.ledger.receipts[0]).toMatchObject({
    outcome: "cancellation", reportedUsd: 0.04, unknownChunks: 0, unsentChunks: 0,
  });
  // A second cancellation cannot emit another abort or a second receipt.
  expect(h.send({ type: "cancel", operationId, reason: "Again." }).effects).toEqual([]);
  expect(h.ledger.receipts).toHaveLength(1);
});

test("duplicate and late settlements never double-count a charge or release another slot", () => {
  const h = harness();
  const first = dispatched(h, "stt");
  h.send({ type: "settle", operationId: first.operationId, chunkId: 1, outcome: "success", costUsd: 0.01 });
  expect(h.ledger.receipts[0]?.reportedUsd).toBe(0.01);
  const duplicate = h.send({
    type: "settle", operationId: first.operationId, chunkId: 1, outcome: "success", costUsd: 99,
  });
  expect(duplicate.ledger.receipts).toHaveLength(1);
  expect(duplicate.ledger.receipts[0]?.reportedUsd).toBe(0.01);

  const second = dispatched(h, "stt");
  expect(second.operationId).toBe(2);
  const late = h.send({
    type: "settle", operationId: first.operationId, chunkId: 1, outcome: "failure", failure: "Late.",
  });
  expect(late.effects).toEqual([]);
  expect(late.ledger.slots.stt?.operationId).toBe(second.operationId);
  expect(late.ledger.receipts).toHaveLength(1);
  expect(late.ledger.slots.stt?.chunks[0]?.state).toBe("dispatched");
});

test("unknown and partial charges stay attributable and are never reported as a zero charge", () => {
  const h = harness();
  const operation = begin(h, "tts", 3);
  h.send({ type: "chunk", operationId: operation.operationId });
  h.send({ type: "dispatch", operationId: operation.operationId, chunkId: 1, facts: facts() });
  h.send({ type: "settle", operationId: operation.operationId, chunkId: 1, outcome: "success", costUsd: 0.1 });
  h.send({ type: "chunk", operationId: operation.operationId });
  h.send({ type: "dispatch", operationId: operation.operationId, chunkId: 2, facts: facts() });
  h.send({ type: "settle", operationId: operation.operationId, chunkId: 2, outcome: "success", costUsd: null });
  h.send({ type: "chunk", operationId: operation.operationId });
  h.send({ type: "dispatch", operationId: operation.operationId, chunkId: 3, facts: facts() });
  const settled = h.send({ type: "settle", operationId: operation.operationId, chunkId: 3, outcome: "success" });

  const receipt = settled.ledger.receipts[0];
  expect(receipt).toMatchObject({ reportedUsd: 0.1, unknownChunks: 2, unsentChunks: 0 });
  expect(receipt?.operation.chunks.map((chunk) => chunk.charge)).toEqual([
    { state: "reported", usd: 0.1 }, { state: "unknown" }, { state: "unknown" },
  ]);
  expect(receipt?.operation.operationId).toBe(operation.operationId);
  expect(Object.isFrozen(receipt)).toBe(true);
});

test("one operation per kind: STT backpressure does not block an independent TTS slot", () => {
  const h = harness();
  const stt = begin(h, "stt", 1);
  const refused = h.send({ type: "begin", kind: "stt", planned: 1, facts: facts() });
  expect(refused.ledger.slots.stt?.operationId).toBe(stt.operationId);
  expect(refused.ledger.reason).toContain("still settling");
  expect(begin(h, "tts", 1).operationId).toBe(2);

  h.send({ type: "settle", operationId: stt.operationId, chunkId: 0, outcome: "success" });
  // A settlement for a chunk that never existed is ignored, so the STT slot stays held.
  expect(h.ledger.slots.stt?.operationId).toBe(stt.operationId);
  expect(h.ledger.receipts).toHaveLength(0);
});

test("a refusal frees its own slot without an automatic retry", () => {
  const h = harness();
  const operation = begin(h, "stt", 1);
  h.send({ type: "chunk", operationId: operation.operationId });
  const refused = h.send({
    type: "dispatch", operationId: operation.operationId, chunkId: 1, facts: facts({ permitted: false }),
  });
  expect(refused.effects).toEqual([]);
  expect(refused.ledger.receipts[0]?.outcome).toBe("refusal");
  expect(refused.ledger.slots.stt).toBeNull();
  const next = begin(h, "stt", 1);
  expect(next.operationId).toBe(2);
  expect(h.ledger.receipts).toHaveLength(1);
});

test("a failure receipt keeps one bounded message and does not invent a charge", () => {
  const h = harness();
  const { operationId } = dispatched(h, "stt");
  const failed = h.send({
    type: "settle", operationId, chunkId: 1, outcome: "failure", failure: "x".repeat(65_537),
  });
  expect(failed.ledger.receipts[0]).toMatchObject({
    outcome: "failure", reportedUsd: 0, unknownChunks: 1, unsentChunks: 0,
    failure: "The external operation failed. Review its host receipt before continuing.",
  });
});

test("planned counts and receipts are locally bounded", () => {
  const h = harness();
  for (const planned of [0, 257]) {
    const refused = h.send({ type: "begin", kind: "stt", planned, facts: facts() });
    expect(refused.ledger.slots.stt).toBeNull();
    expect(refused.ledger.reason).toContain("local bound");
  }
  expect(h.send({
    type: "begin", kind: "stt", planned: 1, facts: facts({ permitted: false }),
  }).ledger.reason).toContain("not ready");
});
