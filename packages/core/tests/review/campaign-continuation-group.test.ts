import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { bookFilePath } from "../../src/library/paths";
import { toLibraryFilePath } from "../../src/library/path";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import {
  CampaignContinuationStore, ContinuationStorageError,
  continuationGroupMoveIntentPath, continuationIntentPath, continuationManifestPath,
  continuationSegmentPath, continuationTrashIntentsPath, continuationTrashManifestPath,
  continuationTrashSegmentsPath,
  type CampaignContinuationHost, type ContinuationCandidate, type ContinuationStorageErrorCode
} from "../../src/review/campaign-continuation-store";
import { buildReaderRun } from "../../src/review/findings";
import { buildReviewReport, reportRecordBytes } from "../../src/review/record-format";
import { reportPath } from "../../src/review/record-store";
import { encodeCanonicalJson } from "../../src/review/record-json";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

const time = "2026-11-08T12:00:00.000Z";
const later = "2026-11-08T13:00:00.000Z";
const owner = "book_123456";
const otherOwner = "book_654321";
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
    id: "ch_123456", title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version: 3,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
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

describe("campaign continuation group move and cross-book report resolution", () => {
  test("group trash preserves the revision chain and readback after restore", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const manifestBefore = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    if (!manifestBefore) throw new Error("Missing manifest");

    const trashed = await store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-one", groupId: "group-one", createdAt: later
    });
    expect(trashed).toMatchObject({ status: "trashed", operationId: "group-trash-one", groupId: "group-one" });
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    const archivedManifest = await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-one"));
    expect(archivedManifest?.bytes).toEqual(manifestBefore);
    for (const segment of f.built.segments) {
      expect(await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id))).toBeNull();
      const moved = await port.readFile(toLibraryFilePath([
        ...continuationTrashSegmentsPath(owner, f.plan.campaignId, "group-one"), `${segment.reference.id}.json`
      ]));
      expect(moved?.bytes).toEqual(segment.bytes);
    }
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("refused");
    const archived = await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" });
    expect(archived.state).toBe("archived");

    const intent = await store.readContinuationGroupIntent(owner, "group-trash-one");
    if (!intent) throw new Error("Missing group intent");
    expect(intent.intent.action).toBe("trash");
    expect(intent.intent.groupId).toBe("group-one");
    expect((intent.intent.components as Array<{ name: string }>).map((c) => c.name))
      .toEqual(["segments", "publication-intents", "manifest"]);
    const moves = await store.listContinuationGroupMoves(owner);
    expect(moves.total).toBe(1);
    expect(moves.moves[0]?.operationId).toBe("group-trash-one");

    const restored = await store.restoreContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-restore-one", groupId: "group-one", createdAt: later
    });
    expect(restored.status).toBe("restored");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBefore);
    const inspected = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(inspected.status).toBe("structural-only");
    const { digest: _digest, ...content } = f.plan;
    const loaded = await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path));
    expect(loaded.status).toBe("matched-local-plan-only");
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("active");

    // The revision chain still advances from the restored manifest.
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

  test("archive and restore classification distinguishes active, archived, partial and absent", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("absent");
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("active");
    await store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-one", groupId: "group-one", createdAt: later
    });
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("archived");
    // Simulate a partial restore: only the manifest returns, segments stay archived.
    await port.ensureDirectory(toLibraryFilePath(["books", owner, "reviews", "campaigns"]));
    const archivedBytes = (await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-one")))?.bytes;
    if (!archivedBytes) throw new Error("Missing archived manifest");
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), archivedBytes, { kind: "absent" });
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-one" })).state).toBe("partial");
    // Readers show the partial group as refused, never as a complete continuation.
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("refused");
  });

  test("a move that cannot preserve every checked reference refuses and source bytes survive", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const manifestBefore = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    const segment = f.built.segments[0];
    if (!segment || !manifestBefore) throw new Error("Missing fixture segment");
    const tampered = new Uint8Array(segment.bytes);
    tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
    await port.commitFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), tampered, { kind: "any" });
    await expectCode(store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-blocked", groupId: "group-blocked", createdAt: later
    }), "corrupt");
    // Nothing moved and no group intent was retained for the refused preflight.
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBefore);
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id)))?.bytes).toEqual(tampered);
    expect(await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-blocked"))).toBeNull();
    expect(await port.readFile(continuationGroupMoveIntentPath(owner, "group-trash-blocked"))).toBeNull();

    // An occupied destination also refuses before the first move.
    const g = await fixture(false);
    const h = makeHarness();
    await writeBook(h.port, owner);
    await h.store.publishContinuation(owner, g.plan.campaignId, g.candidate);
    const blocker = new TextEncoder().encode("occupied");
    await h.port.commitFile(continuationTrashManifestPath(owner, g.plan.campaignId, "group-one"), blocker, { kind: "absent" });
    await expectCode(h.store.trashContinuationGroup(owner, g.plan.campaignId, {
      operationId: "group-trash-two", groupId: "group-one", createdAt: later
    }), "conflict");
    expect((await h.port.readFile(continuationManifestPath(owner, g.plan.campaignId)))?.bytes).toEqual(g.built.manifestBytes);
    expect((await h.port.readFile(continuationTrashManifestPath(owner, g.plan.campaignId, "group-one")))?.bytes).toEqual(blocker);
  });

  test("cross-book resolution keeps the recorded owner and bounds foreign references", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    await writeBook(port, otherOwner);
    // Two-source, two-book plan: each range stage's envelope names only its source's book.
    const bodyA = normalizeBody("First book synthetic prose.\n");
    const bodyB = normalizeBody("Second book synthetic prose.\n");
    const base = await campaignInput(bodyA);
    const firstBook = base.request.books[0];
    if (!firstBook) throw new Error("Missing fixture book");
    const input = {
      ...base,
      request: {
        ...base.request,
        books: [
          firstBook,
          { ...firstBook, bookId: otherOwner, title: "Second synthetic book" }
        ]
      },
      sources: [
        base.sources[0] as (typeof base.sources)[number],
        {
          sourceId: "source-2",
          saved: { bookId: otherOwner, chapterId: "ch_654321", version: 3, hash: "b".repeat(64), body: bodyB },
          bookTitle: "Second synthetic book", title: "Second chapter", position: 2,
          ranges: [{ start: 0, end: bodyB.length }]
        }
      ],
      policy: { ...base.policy, synthesis: null }
    };
    const plan = await planned(input as Parameters<typeof planned>[0]);
    expect(plan.stages.length).toBeGreaterThanOrEqual(2);
    // Save one schema-1 report per range stage under its recorded owner.
    const receipts: Array<Record<string, unknown> | null> = [];
    for (const stage of plan.stages) {
      const stageOwner = stage.envelope.books[0]?.bookId;
      if (!stageOwner) throw new Error("Missing stage owner");
      const profile = stage.envelope.profile;
      if (!profile) throw new Error("Missing stage profile");
      const run = await buildReaderRun({
        runId: stage.stageId, startedAt: time, completedAt: time, envelope: stage.envelope,
        output: JSON.stringify({ runId: stage.stageId, readerId: profile.id, readerVersion: profile.version, findings: [] })
      });
      const report = await buildReviewReport({
        ownerBookId: stageOwner, run, savedAt: time,
        sha256: async (text) => sha256(new TextEncoder().encode(text))
      });
      const bytes = reportRecordBytes(report);
      await port.commitFile(reportPath(stageOwner, stage.stageId), bytes, { kind: "absent" });
      receipts.push({
        status: "completed", completedCategories: [], at: time,
        actualScopeDigest: stage.envelope.scopeDigest, futureReceiptNote: "keep-receipt",
        report: { ownerBookId: stageOwner, runId: stage.stageId, sha256: sha256(bytes) }
      });
    }
    const checkpoint = {
      checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
      planDigest: plan.digest, capturedAt: time,
      stages: plan.stages.map((stage, index) => ({ stageId: stage.stageId, receipt: receipts[index] ?? null }))
    };
    const built = await buildCampaignContinuation(plan, {
      operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint
    });
    await store.publishContinuation(owner, plan.campaignId,
      { manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments });

    const resolved = await store.resolveContinuationReports(owner, plan.campaignId);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") throw new Error("Expected resolved reports");
    expect(resolved.entries).toHaveLength(plan.stages.length);
    const ownedEntries = resolved.entries.filter((entry) => entry.disposition === "owned");
    const foreignEntries = resolved.entries.filter((entry) => entry.disposition === "foreign");
    expect(ownedEntries.length).toBeGreaterThan(0);
    expect(foreignEntries.length).toBeGreaterThan(0);
    expect(foreignEntries.every((entry) => entry.reference.ownerBookId === otherOwner)).toBe(true);
    expect(resolved.foreign).toBe(foreignEntries.length);
    expect(resolved.unavailable).toBe(0);
    // Foreign reports were read from their recorded owner only: no copy was adopted
    // under the campaign owner, and the checkpoint bytes are untouched.
    for (const entry of foreignEntries) {
      expect(await port.readFile(reportPath(owner, entry.reference.runId))).toBeNull();
    }
    expect((await port.readFile(continuationManifestPath(owner, plan.campaignId)))?.bytes).toEqual(built.manifestBytes);

    // A changed foreign report becomes a bounded unavailable entry, never dropped.
    const foreign = foreignEntries[0];
    if (!foreign) throw new Error("Missing foreign entry");
    const foreignPath = reportPath(otherOwner, foreign.reference.runId);
    const original = (await port.readFile(foreignPath))?.bytes;
    if (!original) throw new Error("Missing foreign report");
    const changed = new Uint8Array(original);
    changed[changed.length - 3] = (changed[changed.length - 3] ?? 0) ^ 0xff;
    await port.commitFile(foreignPath, changed, { kind: "any" });
    const again = await store.resolveContinuationReports(owner, plan.campaignId);
    expect(again.status).toBe("resolved");
    if (again.status === "resolved") {
      expect(again.entries).toHaveLength(plan.stages.length);
      expect(again.entries.find((entry) => entry.reference.runId === foreign.reference.runId)?.disposition)
        .toBe("unavailable");
    }
  });

  test("wrong-owner group moves and report resolution refuse without reading foreign segments", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    await writeBook(port, otherOwner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await expectCode(store.trashContinuationGroup(otherOwner, f.plan.campaignId, {
      operationId: "group-trash-foreign", groupId: "group-foreign", createdAt: later
    }), "not-found");
    expect(await store.resolveContinuationReports(otherOwner, f.plan.campaignId))
      .toEqual({ status: "refused", code: "not-found" });
    // A manifest copied under a foreign folder still names its recorded owner and refuses.
    const bytes = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    if (!bytes) throw new Error("Missing manifest");
    await port.commitFile(continuationManifestPath(otherOwner, f.plan.campaignId), bytes, { kind: "absent" });
    await expectCode(store.trashContinuationGroup(otherOwner, f.plan.campaignId, {
      operationId: "group-trash-copied", groupId: "group-copied", createdAt: later
    }), "corrupt");
    expect(await store.resolveContinuationReports(otherOwner, f.plan.campaignId))
      .toEqual({ status: "refused", code: "corrupt" });
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
  });

  test("supported unknown fields survive a group move byte for byte", async () => {
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
    await store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-unknown", groupId: "group-unknown", createdAt: later
    });
    expect((await port.readFile(continuationTrashManifestPath(owner, f.plan.campaignId, "group-unknown")))?.bytes)
      .toEqual(manifestBytes);
    const movedSegment = await port.readFile(toLibraryFilePath([
      ...continuationTrashSegmentsPath(owner, f.plan.campaignId, "group-unknown"), `${newId}.json`
    ]));
    expect(movedSegment?.bytes).toEqual(newSegmentBytes);
    const movedIntent = await port.readFile(toLibraryFilePath([
      ...continuationTrashIntentsPath(owner, f.plan.campaignId, "group-unknown"), "operation-one.json"
    ]));
    expect(movedIntent?.bytes).toEqual(intentBytes);
    await store.restoreContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-restore-unknown", groupId: "group-unknown", createdAt: later
    });
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBytes);
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, newId)))?.bytes).toEqual(newSegmentBytes);
    expect((await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one")))?.bytes).toEqual(intentBytes);
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
    let directoryMoves = 0;
    const store = new CampaignContinuationStore({
      storage: port, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async (path, bytes, expected) => port.commitFile(path, bytes, expected),
      createImmutableFile: async (path, bytes) => port.createImmutableFile(path, bytes),
      moveDirectory: async (from, to) => {
        directoryMoves += 1;
        if (directoryMoves === 2) throw new Error("simulated crash after segments moved");
        return port.moveDirectory(from, to);
      },
      moveFile: async (from, to) => port.moveFile(from, to)
    });
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await expectCode(store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-partial", groupId: "group-partial", createdAt: later
    }), "uncertain");
    // The manifest never moved, segments are archived, and the intent is retained.
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    expect(await port.readFile(continuationGroupMoveIntentPath(owner, "group-trash-partial"))).not.toBeNull();
    expect((await store.inspectContinuationGroup(owner, f.plan.campaignId, { groupId: "group-partial" })).state)
      .toBe("partial");
    expect((await store.inspectContinuation(owner, f.plan.campaignId)).status).toBe("refused");
  });

  test("group move dispatches on recorded semantics and refuses capability gaps before moving", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    manifest.plannerSemantics = "review-campaign-planner-v99";
    const futureBytes = encodeCanonicalJson(manifest);
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), futureBytes, { kind: "any" });
    await expectCode(store.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-future", groupId: "group-future", createdAt: later
    }), "unsupported");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(futureBytes);
    expect(await port.readFile(continuationGroupMoveIntentPath(owner, "group-trash-future"))).toBeNull();

    // Without genuine no-replace creation the move refuses before any file changes.
    const bare = new CampaignContinuationStore({
      storage: port, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async (path, bytes, expected) => port.commitFile(path, bytes, expected)
    });
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), f.built.manifestBytes, { kind: "any" });
    await expectCode(bare.trashContinuationGroup(owner, f.plan.campaignId, {
      operationId: "group-trash-bare", groupId: "group-bare", createdAt: later
    }), "unsupported-concurrent-writer");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    await expectCode(store.listContinuationGroupMoves(owner, { limit: 201 }), "invalid");
  });
});
