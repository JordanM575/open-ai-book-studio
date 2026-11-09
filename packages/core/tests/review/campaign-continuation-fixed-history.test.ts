import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { bookFilePath } from "../../src/library/paths";
import { historyFilePath } from "../../src/library/history";
import { serializeHistoryRecord } from "../../src/library/history";
import { toLibraryFilePath } from "../../src/library/path";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import {
  CampaignContinuationStore, ContinuationStorageError,
  continuationFixedHistoryMoveIntentPath,
  continuationIntentPath, continuationManifestPath,
  continuationSegmentPath, continuationTrashHistoryPath,
  continuationTrashIntentsPath, continuationTrashManifestPath,
  continuationTrashSegmentsPath,
  type CampaignContinuationHost, type ContinuationCandidate, type ContinuationStorageErrorCode
} from "../../src/review/campaign-continuation-store";
import { encodeCanonicalJson } from "../../src/review/record-json";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const time = "2026-11-08T12:00:00.000Z";
const later = "2026-11-08T13:00:00.000Z";
const owner = "book_123456";
const otherOwner = "book_654321";
const chapterId = "ch_123456";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function at(root: unknown, path: readonly (string | number)[]): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new Error("Bad fixture path");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}

async function writeBook(port: InMemoryLibraryPort, bookId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, id: bookId, title: "Synthetic book", description: "", outline: "",
    createdAt: time, updatedAt: time
  }));
  await port.commitFile(bookFilePath(bookId), bytes, { kind: "absent" });
}

function makeHarness() {
  const port = new InMemoryLibraryPort({ id: "device_fixture01", name: "Fixture device", createdAt: time }, () => time);
  const host: CampaignContinuationHost = {
    storage: port, runtime: port, deviceId: "device_fixture01",
    withBook: async (_bookId, work) => work(),
    commitFile: async (path, bytes, expected) => port.commitFile(path, bytes, expected),
    createImmutableFile: async (path, bytes) => port.createImmutableFile(path, bytes)
  };
  const store = new CampaignContinuationStore(host);
  return { port, store, host };
}

function chapterFile(body: string): Uint8Array {
  return new TextEncoder().encode(serializeChapter({
    id: chapterId, title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version: 3,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
}

async function historyBytes(port: InMemoryLibraryPort, bookId: string, extra: Record<string, unknown> = {}): Promise<{ fileName: string; bytes: Uint8Array }> {
  const body = normalizeBody("Preserved history prose.\n");
  const sourceHash = "a".repeat(64);
  const meta = {
    schemaVersion: 1 as const, kind: "snapshot" as const, id: "hist_123456",
    bookId, chapterId, label: "Preserved draft",
    capturedAt: time, sourceVersion: 3, sourceHash,
    bodyHash: sha256(new TextEncoder().encode(body)),
    ...extra
  };
  const text = await serializeHistoryRecord({ meta: meta as never, content: body }, port);
  return { fileName: "2026-11-08T12-00-00-000Z-preserved-draft.md", bytes: new TextEncoder().encode(text) };
}

async function writeHistory(port: InMemoryLibraryPort, bookId: string, extra: Record<string, unknown> = {}) {
  const { fileName, bytes } = await historyBytes(port, bookId, extra);
  await port.commitFile(historyFilePath({ bookId, chapterId, fileName }), bytes, { kind: "absent" });
  return { fileName, bytes };
}

async function fixture(withCheckpoint = true) {
  const body = normalizeBody("Synthetic chapter prose for storage.\nSecond synthetic line.\n");
  const rawBytes = chapterFile(body);
  const input = withSynthesis(await campaignInput(body));
  const source = input.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.saved = { ...source.saved, hash: sha256(rawBytes) };
  const plan = await planned(input);
  const checkpoint = withCheckpoint
    ? { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId, planDigest: plan.digest,
        capturedAt: time, stages: plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null })) }
    : null;
  const built = await buildCampaignContinuation(plan, { operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint });
  const candidate: ContinuationCandidate = { manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments };
  return { body, rawBytes, input, plan, built, candidate,
    sourceInput: { kind: "current" as const, sourceId: source.sourceId, rawBytes } };
}

async function expectCode(promise: Promise<unknown>, code: ContinuationStorageErrorCode) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationStorageError);
    expect((error as ContinuationStorageError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ContinuationStorageError ${code}`);
}

describe("campaign continuation fixed-history group move", () => {
  test("fixed-history trash preserves the revision chain and readback after restore", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const hist = await writeHistory(port, owner);
    const manifestBefore = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    if (!manifestBefore) throw new Error("Missing manifest");

    const trashed = await store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-one", groupId: "group-one", createdAt: later
    });
    expect(trashed).toMatchObject({ status: "trashed", operationId: "fixed-trash-one", groupId: "group-one" });
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    expect(await port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist.fileName }))).toBeNull();
    const archivedManifest = await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-one"));
    expect(archivedManifest?.bytes).toEqual(manifestBefore);
    const archivedHistory = await port.readFile(toLibraryFilePath([...continuationTrashHistoryPath(owner, "group-one"), chapterId, hist.fileName]));
    expect(archivedHistory?.bytes).toEqual(hist.bytes);
    for (const segment of f.built.segments) {
      expect(await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id))).toBeNull();
      const moved = await port.readFile(toLibraryFilePath([
        ...continuationTrashSegmentsPath(owner, f.plan.campaignId, "group-one"), `${segment.reference.id}.json`
      ]));
      expect(moved?.bytes).toEqual(segment.bytes);
    }
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("refused");
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("archived");

    const intent = await store.readContinuationFixedHistoryIntent(owner, "fixed-trash-one");
    if (!intent) throw new Error("Missing fixed-history intent");
    expect(intent.intent.action).toBe("trash");
    expect(intent.intent.groupId).toBe("group-one");
    expect((intent.intent.components as Array<{ name: string }>).map((c) => c.name))
      .toEqual(["history", "segments", "publication-intents", "manifest"]);
    expect((await store.listContinuationFixedHistoryMoves(owner)).total).toBe(1);

    const restored = await store.restoreContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-restore-one", groupId: "group-one", createdAt: later
    });
    expect(restored.status).toBe("restored");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBefore);
    expect((await port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist.fileName })))?.bytes).toEqual(hist.bytes);
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("structural-only");
    const { digest: _digest, ...content } = f.plan;
    const loaded = await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path));
    expect(loaded.status).toBe("matched-local-plan-only");
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("active");

    const checkpoint = { checkpointVersion: 1, owner: { bookId: f.plan.ownerBookId }, campaignId: f.plan.campaignId,
      planDigest: f.plan.digest, capturedAt: later,
      stages: f.plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null })) };
    const files = new Map(f.built.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
    const second = await buildCampaignContinuation(f.plan, {
      operationId: "operation-two", createdAt: time, updatedAt: later, checkpoint,
      previous: { manifestBytes: f.built.manifestBytes, plan: f.plan, readSegment: (id) => files.get(id) }
    });
    const secondResult = await store.publishContinuation(owner, f.plan.campaignId,
      { manifestBytes: second.manifestBytes, intentBytes: second.intentBytes, segments: second.segments });
    expect(secondResult).toMatchObject({ status: "published", revision: 2 });
  });

  test("fixed-history classification distinguishes active, archived, partial and absent", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await writeHistory(port, owner);
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("absent");
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    // History was written before publish; after publish the group is active (history + continuation present).
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("active");
    await store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-one", groupId: "group-one", createdAt: later
    });
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("archived");
    const archivedBytes = (await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-one")))?.bytes;
    if (!archivedBytes) throw new Error("Missing archived manifest");
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), archivedBytes, { kind: "absent" });
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("partial");
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("refused");
  });

  test("a divergent member refuses before the first move and source bytes survive", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const hist = await writeHistory(port, owner);
    const manifestBefore = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    const segment = f.built.segments[0];
    if (!segment || !manifestBefore) throw new Error("Missing fixture segment");
    const tampered = new Uint8Array(segment.bytes);
    tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
    await port.commitFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), tampered, { kind: "any" });
    await expectCode(store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-blocked", groupId: "group-blocked", createdAt: later
    }), "corrupt");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBefore);
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id)))?.bytes).toEqual(tampered);
    expect((await port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist.fileName })))?.bytes).toEqual(hist.bytes);
    expect(await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-blocked"))).toBeNull();
    expect(await port.readFile(continuationFixedHistoryMoveIntentPath(owner, "fixed-trash-blocked"))).toBeNull();

    // Divergent history body (hash no longer matches) also refuses.
    const h2 = makeHarness();
    await writeBook(h2.port, owner);
    const g = await fixture(false);
    await h2.store.publishContinuation(owner, g.plan.campaignId, g.candidate);
    const hist2 = await writeHistory(h2.port, owner);
    const badHistory = new TextEncoder().encode(new TextDecoder().decode(hist2.bytes).replace("Preserved history prose.", "Tampered history prose."));
    await h2.port.commitFile(historyFilePath({ bookId: owner, chapterId, fileName: hist2.fileName }), badHistory, { kind: "any" });
    await expectCode(h2.store.trashContinuationFixedHistory(owner, g.plan.campaignId, {
      operationId: "fixed-trash-badhist", groupId: "group-badhist", createdAt: later
    }), "corrupt");
    expect((await h2.port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist2.fileName })))?.bytes).toEqual(badHistory);
    expect((await h2.port.readFile(continuationManifestPath(owner, g.plan.campaignId)))?.bytes).toEqual(g.built.manifestBytes);

    // Occupied destination refuses before the first move.
    const h3 = makeHarness();
    await writeBook(h3.port, owner);
    const k = await fixture(false);
    await h3.store.publishContinuation(owner, k.plan.campaignId, k.candidate);
    await writeHistory(h3.port, owner);
    const blocker = new TextEncoder().encode("occupied");
    await h3.port.commitFile(continuationTrashManifestPath(owner, k.plan.campaignId, "group-one"), blocker, { kind: "absent" });
    await expectCode(h3.store.trashContinuationFixedHistory(owner, k.plan.campaignId, {
      operationId: "fixed-trash-two", groupId: "group-one", createdAt: later
    }), "conflict");
    expect((await h3.port.readFile(continuationManifestPath(owner, k.plan.campaignId)))?.bytes).toEqual(k.built.manifestBytes);
    expect((await h3.port.readFile(continuationTrashManifestPath(owner, k.plan.campaignId, "group-one")))?.bytes).toEqual(blocker);
  });

  test("future labels and wrong owner refuse before any move with source bytes preserved", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    await writeBook(port, otherOwner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const hist = await writeHistory(port, owner);
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    manifest.plannerSemantics = "review-campaign-planner-v99";
    const futureBytes = encodeCanonicalJson(manifest);
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), futureBytes, { kind: "any" });
    await expectCode(store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-future", groupId: "group-future", createdAt: later
    }), "unsupported");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(futureBytes);
    expect((await port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist.fileName })))?.bytes).toEqual(hist.bytes);
    expect(await port.readFile(continuationFixedHistoryMoveIntentPath(owner, "fixed-trash-future"))).toBeNull();

    // Future history schema refuses as well.
    const h2 = makeHarness();
    await writeBook(h2.port, owner);
    const g = await fixture(false);
    await h2.store.publishContinuation(owner, g.plan.campaignId, g.candidate);
    const futureHistory = new TextEncoder().encode(
      "---\nschemaVersion: 2\nkind: snapshot\nid: hist_123456\nbookId: " + owner + "\nchapterId: " + chapterId +
      "\nlabel: Future\ncapturedAt: " + time + "\nsourceVersion: 3\nsourceHash: " + "a".repeat(64) +
      "\nbodyHash: " + "b".repeat(64) + "\n---\n\nFuture body.\n");
    await h2.port.commitFile(historyFilePath({ bookId: owner, chapterId, fileName: "future.md" }), futureHistory, { kind: "absent" });
    await expectCode(h2.store.trashContinuationFixedHistory(owner, g.plan.campaignId, {
      operationId: "fixed-trash-futurehist", groupId: "group-futurehist", createdAt: later
    }), "unsupported");
    expect((await h2.port.readFile(continuationManifestPath(owner, g.plan.campaignId)))?.bytes).toEqual(g.built.manifestBytes);

    // Wrong owner: no continuation under the caller, and a copied manifest names another owner.
    await expectCode(store.trashContinuationFixedHistory(otherOwner, f.plan.campaignId, {
      operationId: "fixed-trash-foreign", groupId: "group-foreign", createdAt: later
    }), "not-found");
    const bytes = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    if (!bytes) throw new Error("Missing manifest");
    // Restore the good manifest under owner before copying the foreign case.
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), f.built.manifestBytes, { kind: "any" });
    await port.commitFile(continuationManifestPath(otherOwner, f.plan.campaignId), bytes, { kind: "absent" });
    await expectCode(store.trashContinuationFixedHistory(otherOwner, f.plan.campaignId, {
      operationId: "fixed-trash-copied", groupId: "group-copied", createdAt: later
    }), "corrupt");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
  });

  test("a compatibly differing semantics label moves byte-identically", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const hist = await writeHistory(port, owner);
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    manifest.plannerSemantics = "review-campaign-planner-v0";
    const compatBytes = encodeCanonicalJson(manifest);
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), compatBytes, { kind: "any" });
    const trashed = await store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-compat", groupId: "group-compat", createdAt: later
    });
    expect(trashed.status).toBe("trashed");
    expect((await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-compat")))?.bytes).toEqual(compatBytes);
    expect((await port.readFile(toLibraryFilePath([...continuationTrashHistoryPath(owner, "group-compat"), chapterId, hist.fileName])))?.bytes).toEqual(hist.bytes);
    const restored = await store.restoreContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-restore-compat", groupId: "group-compat", createdAt: later
    });
    expect(restored.status).toBe("restored");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(compatBytes);
  });

  test("supported unknown fields survive a fixed-history move byte for byte", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    const first = f.built.segments[0];
    if (!first) throw new Error("Missing segment");
    const segmentJson = JSON.parse(new TextDecoder().decode(first.bytes)) as Record<string, unknown>;
    const { id: _oldId, ...oldBody } = segmentJson;
    const newBody = { ...oldBody, futureSegmentNote: "keep-segment" };
    const newId = `s-${sha256(encodeCanonicalJson(newBody))}`;
    const newSegmentBytes = encodeCanonicalJson({ ...newBody, id: newId });
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    const descriptor = manifest.plan as Record<string, unknown>;
    const references = descriptor.segments as Array<Record<string, unknown>>;
    const reference = references.find((entry) => entry.id === first.reference.id);
    if (!reference) throw new Error("Missing reference");
    const delta = newSegmentBytes.length - first.bytes.length;
    reference.id = newId;
    reference.bytes = newSegmentBytes.length;
    reference.sha256 = sha256(newSegmentBytes);
    descriptor.segmentBytes = (descriptor.segmentBytes as number) + delta;
    manifest.segmentBytes = (manifest.segmentBytes as number) + delta;
    manifest.futureManifestNote = "keep-manifest";
    const manifestBytes = encodeCanonicalJson(manifest);
    const intent = clone(JSON.parse(new TextDecoder().decode(f.built.intentBytes))) as Record<string, unknown>;
    intent.candidate = { encoding: "base64", bytes: manifestBytes.length, sha256: sha256(manifestBytes),
      data: Buffer.from(manifestBytes).toString("base64") };
    intent.futureIntentNote = "keep-intent";
    const intentBytes = encodeCanonicalJson(intent);
    const candidate: ContinuationCandidate = {
      manifestBytes, intentBytes,
      segments: f.built.segments.map((segment) => segment.reference.id === first.reference.id
        ? { reference: { id: newId }, bytes: newSegmentBytes }
        : { reference: segment.reference, bytes: segment.bytes })
    };
    await store.publishContinuation(owner, f.plan.campaignId, candidate);
    const hist = await writeHistory(port, owner, { futureHistoryNote: "keep-history" });
    await store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-unknown", groupId: "group-unknown", createdAt: later
    });
    expect((await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-unknown")))?.bytes).toEqual(manifestBytes);
    const movedSegment = await port.readFile(toLibraryFilePath([
      ...continuationTrashSegmentsPath(owner, f.plan.campaignId, "group-unknown"), `${newId}.json`
    ]));
    expect(movedSegment?.bytes).toEqual(newSegmentBytes);
    const movedIntent = await port.readFile(toLibraryFilePath([
      ...continuationTrashIntentsPath(owner, f.plan.campaignId, "group-unknown"), "operation-one.json"
    ]));
    expect(movedIntent?.bytes).toEqual(intentBytes);
    const movedHistory = await port.readFile(toLibraryFilePath([...continuationTrashHistoryPath(owner, "group-unknown"), chapterId, hist.fileName]));
    expect(movedHistory?.bytes).toEqual(hist.bytes);
    await store.restoreContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-restore-unknown", groupId: "group-unknown", createdAt: later
    });
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBytes);
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, newId)))?.bytes).toEqual(newSegmentBytes);
    expect((await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one")))?.bytes).toEqual(intentBytes);
    expect((await port.readFile(historyFilePath({ bookId: owner, chapterId, fileName: hist.fileName })))?.bytes).toEqual(hist.bytes);
    const inspected = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(inspected.status).toBe("structural-only");
    if (inspected.status === "structural-only") {
      expect(inspected.manifest.futureManifestNote).toBe("keep-manifest");
    }
  });

  test("a failure after the first component move is uncertain and leaves a partial group", async () => {
    const port = new InMemoryLibraryPort({ id: "device_fixture01", name: "Fixture device", createdAt: time }, () => time);
    await writeBook(port, owner);
    const f = await fixture(false);
    await writeHistory(port, owner);
    let directoryMoves = 0;
    const store = new CampaignContinuationStore({
      storage: port, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async (path, bytes, expected) => port.commitFile(path, bytes, expected),
      createImmutableFile: async (path, bytes) => port.createImmutableFile(path, bytes),
      moveDirectory: async (from, to) => {
        directoryMoves += 1;
        if (directoryMoves === 2) throw new Error("simulated crash after history moved");
        return port.moveDirectory(from, to);
      },
      moveFile: async (from, to) => port.moveFile(from, to)
    });
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await expectCode(store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-partial", groupId: "group-partial", createdAt: later
    }), "uncertain");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    expect(await port.readFile(continuationFixedHistoryMoveIntentPath(owner, "fixed-trash-partial"))).not.toBeNull();
    expect((await store.inspectContinuationFixedHistory(owner, f.plan.campaignId, { groupId: "group-partial" })).state).toBe("partial");
    // History moved but the continuation parts never did, so the continuation
    // itself still verifies; only the fixed-history group reads as partial.
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("structural-only");
  });

  test("fixed-history move dispatches and refuses capability gaps before moving", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await writeHistory(port, owner);
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    manifest.plannerSemantics = "review-campaign-planner-v99";
    const futureBytes = encodeCanonicalJson(manifest);
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), futureBytes, { kind: "any" });
    await expectCode(store.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-future2", groupId: "group-future2", createdAt: later
    }), "unsupported");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(futureBytes);
    expect(await port.readFile(continuationFixedHistoryMoveIntentPath(owner, "fixed-trash-future2"))).toBeNull();

    const bare = new CampaignContinuationStore({
      storage: port, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async (path, bytes, expected) => port.commitFile(path, bytes, expected)
    });
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), f.built.manifestBytes, { kind: "any" });
    await expectCode(bare.trashContinuationFixedHistory(owner, f.plan.campaignId, {
      operationId: "fixed-trash-bare", groupId: "group-bare", createdAt: later
    }), "unsupported-concurrent-writer");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    await expectCode(store.listContinuationFixedHistoryMoves(owner, { limit: 201 }), "invalid");
  });
});
