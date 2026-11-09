import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBody, serializeChapter } from "../../src/markdown";
import { bookFilePath } from "../../src/library/paths";
import type { LibraryPort } from "../../src/library/port";
import { readSyncJournal } from "../../src/sync/journal";
import { buildCampaignContinuation } from "../../src/review/campaign-continuation-build";
import {
  CAMPAIGN_PLANNER_SEMANTICS, COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS
} from "../../src/review/campaign-continuation-replan";
import {
  CampaignContinuationStore, ContinuationStorageError, continuationIntentPath, continuationManifestPath,
  continuationSegmentPath, continuationSegmentsPath, continuationIntentsPath,
  type CampaignContinuationHost, type ContinuationCandidate, type ContinuationStorageErrorCode
} from "../../src/review/campaign-continuation-store";
import { requireCampaignPlan, type CampaignPlan } from "../../src/review/campaign-planner";
import { encodeCanonicalJson } from "../../src/review/record-json";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";
import { makeBook } from "./record-fixtures";

const time = "2026-11-08T12:00:00.000Z";
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

interface Faults {
  immutableCalls: number;
  failImmutableAt: number | null;
  failManifest: boolean;
  crashAfterManifest: boolean;
  commitPaths: string[];
  segmentCommitCalls: number;
}

function makeHarness() {
  const port = new InMemoryLibraryPort({ id: "device_fixture01", name: "Fixture device", createdAt: time }, () => time);
  const faults: Faults = { immutableCalls: 0, failImmutableAt: null, failManifest: false, crashAfterManifest: false, commitPaths: [], segmentCommitCalls: 0 };
  const host: CampaignContinuationHost = {
    storage: port, runtime: port, deviceId: "device_fixture01",
    withBook: async (_bookId, work) => work(),
    commitFile: async (path, bytes, expected) => {
      faults.commitPaths.push(path.join("/"));
      if (path.join("/").includes(".segments/")) faults.segmentCommitCalls += 1;
      if (faults.failManifest) throw new Error("simulated crash before manifest");
      const result = await port.commitFile(path, bytes, expected);
      if (faults.crashAfterManifest) throw new Error("simulated crash after manifest before readback");
      return result;
    },
    createImmutableFile: async (path, bytes) => {
      faults.immutableCalls += 1;
      if (faults.failImmutableAt === faults.immutableCalls) throw new Error("simulated crash");
      return port.createImmutableFile(path, bytes);
    }
  };
  const store = new CampaignContinuationStore(host);
  return { port, store, host, faults };
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

type BuiltContinuation = Awaited<ReturnType<typeof buildCampaignContinuation>>;

// A hand-crafted candidate that claims revision 3 directly on top of the revision-1
// manifest: its base hash names the real prior bytes, but its base revision claims a
// revision 2 that never existed. Only the store's revision-continuity gate can refuse it.
function revisionSkipCandidate(built: BuiltContinuation, operationId: string): ContinuationCandidate {
  const manifest = clone(JSON.parse(new TextDecoder().decode(built.manifestBytes))) as Record<string, unknown>;
  manifest.revision = 3;
  manifest.publicationId = operationId;
  manifest.base = { kind: "sha256", value: sha256(built.manifestBytes), revision: 2 };
  const manifestBytes = encodeCanonicalJson(manifest);
  const intent = clone(JSON.parse(new TextDecoder().decode(built.intentBytes))) as Record<string, unknown>;
  intent.id = operationId;
  intent.expectedBase = manifest.base;
  intent.candidate = { encoding: "base64", bytes: manifestBytes.length, sha256: sha256(manifestBytes),
    data: Buffer.from(manifestBytes).toString("base64") };
  return { manifestBytes, intentBytes: encodeCanonicalJson(intent), segments: built.segments };
}

function semanticsManifest(manifestBytes: Uint8Array, semantics: string): Uint8Array {
  const manifest = clone(JSON.parse(new TextDecoder().decode(manifestBytes))) as Record<string, unknown>;
  manifest.plannerSemantics = semantics;
  return encodeCanonicalJson(manifest);
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

describe("campaign continuation storage publication and recovery", () => {
  test("publishes intent first, then immutable segments, then the manifest, with verified readback", async () => {
    const { port, store, faults } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    const result = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(result.status).toBe("published");
    expect(result.publicationId).toBe("operation-one");
    // Only the manifest uses the checked commit; segments and intent never do.
    expect(faults.segmentCommitCalls).toBe(0);
    expect(faults.commitPaths).toEqual([`books/${owner}/reviews/campaigns/${f.plan.campaignId}.json`]);
    expect(faults.immutableCalls).toBe(1 + f.built.segments.length);
    const manifest = await port.readFile(continuationManifestPath(owner, f.plan.campaignId));
    expect(manifest?.bytes).toEqual(f.built.manifestBytes);
    const intent = await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one"));
    expect(intent?.bytes).toEqual(f.built.intentBytes);
    for (const segment of f.built.segments) {
      const stored = await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id));
      expect(stored?.bytes).toEqual(segment.bytes);
    }
    const inspected = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(inspected.status).toBe("structural-only");
    const { digest: _digest, ...content } = f.plan;
    const loaded = await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path));
    expect(loaded.status).toBe("matched-local-plan-only");
    if (loaded.status === "matched-local-plan-only") expect(loaded.plan).toBe(f.plan);
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "complete", code: "already-published", candidateRetained: true });
    const intents = await store.listContinuationIntents(owner, f.plan.campaignId);
    expect(intents).toMatchObject({ total: 1, issues: [] });
    expect(intents.intents[0]?.operationId).toBe("operation-one");
    const segments = await store.listContinuationSegments(owner, f.plan.campaignId);
    expect(segments.total).toBe(f.built.segments.length);
  });

  test("publishes through LibraryService with its queue and journal", async () => {
    const { library, book, port } = await makeBook();
    const f = await fixture();
    // Retarget the synthetic plan to the book LibraryService actually created.
    const input = withSynthesis(await campaignInput(f.body));
    const source = input.sources[0];
    if (!source) throw new Error("Missing fixture source");
    source.saved = { ...source.saved, bookId: book.id, hash: sha256(f.rawBytes) };
    input.ownerBookId = book.id;
    if (input.request.books[0]) input.request.books[0].bookId = book.id;
    const plan = await planned(input);
    const built = await buildCampaignContinuation(plan, { operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint: null });
    const result = await library.campaignContinuations.publishContinuation(book.id, plan.campaignId,
      { manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments });
    expect(result.status).toBe("published");
    expect((await library.campaignContinuations.inspectContinuation(book.id, plan.campaignId)).status).toBe("structural-only");
    const journal = await readSyncJournal(port, library.deviceId);
    expect(journal?.files[`books/${book.id}/reviews/campaigns/${plan.campaignId}.json`]?.sha256).toBe(result.manifestHash);
    const segment = built.segments[0];
    if (!segment) throw new Error("Missing segment");
    expect(journal?.files[`books/${book.id}/reviews/campaigns/${plan.campaignId}.segments/${segment.reference.id}.json`]?.sha256)
      .toBe(sha256(segment.bytes));
  });

  test("publishes a second revision against the exact prior manifest hash", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const later = "2026-11-08T13:00:00.000Z";
    const checkpoint = { checkpointVersion: 1, owner: { bookId: f.plan.ownerBookId }, campaignId: f.plan.campaignId,
      planDigest: f.plan.digest, capturedAt: later,
      stages: f.plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null })) };
    const files = new Map(f.built.segments.map(({ reference, bytes }) => [reference.id, bytes] as const));
    const second = await buildCampaignContinuation(f.plan, {
      operationId: "operation-two", createdAt: time, updatedAt: later, checkpoint,
      previous: { manifestBytes: f.built.manifestBytes, plan: f.plan, readSegment: (id) => files.get(id) }
    });
    const result = await store.publishContinuation(owner, f.plan.campaignId,
      { manifestBytes: second.manifestBytes, intentBytes: second.intentBytes, segments: second.segments });
    expect(result).toMatchObject({ status: "published", publicationId: "operation-two", revision: 2 });
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(second.manifestBytes);
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId);
    expect(recovery.classifications.map((entry) => entry.code)).toContain("already-published");
    // A stale first-revision republication now conflicts with the newer active manifest.
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "conflict");
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(second.manifestBytes);
  });

  test("a revision-skipping candidate refuses as a conflict and the active bytes survive", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, revisionSkipCandidate(f.built, "operation-skip")), "conflict");
    // The active manifest is still the exact revision-1 bytes, and the refused
    // candidate wrote no intent of its own.
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    expect(await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-skip"))).toBeNull();
  });

  test("a skipped-revision prepared candidate does not classify as prepared", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const skipped = revisionSkipCandidate(f.built, "operation-skip");
    await port.createImmutableFile(continuationIntentPath(owner, f.plan.campaignId, "operation-skip"), skipped.intentBytes);
    for (const segment of skipped.segments) {
      await port.createImmutableFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), segment.bytes);
    }
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-skip");
    expect(recovery.classifications[0]).toMatchObject({ status: "refused", code: "conflict", candidateRetained: true });
    expect(recovery.classifications[0]?.code).not.toBe("prepared");
  });

  test("refuses publication on an adapter without genuine no-replace creation, before any write", async () => {
    const port = new InMemoryLibraryPort({ id: "device_fixture01", name: "Fixture device", createdAt: time }, () => time);
    await writeBook(port, owner);
    const f = await fixture(false);
    let commitCalls = 0;
    const store = new CampaignContinuationStore({
      storage: port, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async (path, bytes, expected) => { commitCalls += 1; return port.commitFile(path, bytes, expected); }
      // No createImmutableFile: a check-then-rename commit must not be substituted for it.
    });
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "unsupported-concurrent-writer");
    expect(commitCalls).toBe(0);
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    expect(await port.listDirectory(continuationIntentsPath(owner, f.plan.campaignId))).toEqual([]);
    expect(await port.listDirectory(continuationSegmentsPath(owner, f.plan.campaignId))).toEqual([]);
  });

  test("crash before the intent classifies as an incomplete draft, never as published", async () => {
    const { port, store, faults } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    faults.failImmutableAt = 1;
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "uncertain");
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.manifest.present).toBe(false);
    expect(recovery.classifications[0]).toMatchObject({ status: "recoverable", code: "incomplete-draft", candidateRetained: false });
  });

  test("crash mid-segments classifies as an incomplete draft with the missing segments named", async () => {
    const { port, store, faults } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    expect(f.built.segments.length).toBeGreaterThanOrEqual(2);
    faults.failImmutableAt = 3; // intent, first segment, then crash on the second segment
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "uncertain");
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    expect(await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one"))).not.toBeNull();
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]?.status).toBe("recoverable");
    expect(recovery.classifications[0]?.code).toBe("incomplete-draft");
    expect(recovery.classifications[0]?.missingSegmentIds.length).toBeGreaterThan(0);
    // Explicit republication of the same candidate now completes from the retained intent.
    faults.failImmutableAt = null;
    const republished = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(republished.status).toBe("published");
  });

  test("crash after all segments but before the manifest classifies as prepared", async () => {
    const { port, store, faults } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    faults.failManifest = true;
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "uncertain");
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "recoverable", code: "prepared", candidateRetained: true });
    faults.failManifest = false;
    const republished = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(republished.status).toBe("published");
  });

  test("an oversize file at the manifest path classifies recovery as refused uncertain, never prepared", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    await port.createImmutableFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one"), f.candidate.intentBytes);
    for (const segment of f.candidate.segments) {
      await port.createImmutableFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), segment.bytes);
    }
    const before = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(before.manifest).toEqual({ present: false, sha256: null, unreadable: false });
    expect(before.classifications[0]).toMatchObject({ status: "recoverable", code: "prepared", candidateRetained: true });
    // One byte over the manifest bound: the file occupies the publication pointer
    // but cannot be read through it, so it must not read as absence.
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), new Uint8Array(262_145), { kind: "any" });
    const singledOut = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(singledOut.manifest).toEqual({ present: true, sha256: null, unreadable: true });
    expect(singledOut.classifications[0]).toMatchObject({ status: "refused", code: "uncertain", candidateRetained: true });
    expect(singledOut.classifications[0]?.code).not.toBe("prepared");
    expect(singledOut.classifications[0]?.code).not.toBe("incomplete-draft");
    const aggregate = await store.inspectContinuationRecovery(owner, f.plan.campaignId);
    expect(aggregate.manifest).toEqual({ present: true, sha256: null, unreadable: true });
    expect(aggregate.classifications[0]).toMatchObject({ status: "refused", code: "uncertain" });
  });

  test("crash after the manifest but before readback is complete on recovery, not republished", async () => {
    const { port, store, faults } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    faults.crashAfterManifest = true;
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "uncertain");
    // The manifest did land, but the interrupted call must not have claimed publication.
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(f.built.manifestBytes);
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "complete", code: "already-published" });
    faults.crashAfterManifest = false;
    const again = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(again.status).toBe("already-published");
  });

  test("a pre-existing segment with different bytes refuses and is never overwritten", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    const segment = f.built.segments[0];
    if (!segment) throw new Error("Missing segment");
    const divergent = new Uint8Array(segment.bytes);
    divergent[10] = (divergent[10] ?? 0) ^ 0xff;
    await port.commitFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), divergent, { kind: "absent" });
    await expectCode(store.publishContinuation(owner, f.plan.campaignId, f.candidate), "conflict");
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id)))?.bytes).toEqual(divergent);
    expect(await port.readFile(continuationManifestPath(owner, f.plan.campaignId))).toBeNull();
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "refused", code: "conflict" });
    expect(recovery.classifications[0]?.divergentSegmentIds).toContain(segment.reference.id);
  });

  test("identical pre-existing segments are tolerated on republication", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    // Simulate an interrupted attempt that wrote only the identical segments.
    for (const segment of f.built.segments) {
      await port.createImmutableFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), segment.bytes);
    }
    const result = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(result.status).toBe("published");
    const again = await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(again.status).toBe("already-published");
  });

  test("tampered segment and manifest bytes refuse on inspection, load and recovery", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const segment = f.built.segments[0];
    if (!segment) throw new Error("Missing segment");
    const tampered = new Uint8Array(segment.bytes);
    tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
    await port.commitFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), tampered, { kind: "any" });
    expect(await store.inspectContinuation(owner, f.plan.campaignId)).toEqual({ status: "refused", code: "corrupt" });
    const { digest: _d, ...content } = f.plan;
    expect((await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path))).status).toBe("refused");
    const recovery = await store.inspectContinuationRecovery(owner, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]?.status).toBe("refused");
    expect(recovery.classifications[0]?.divergentSegmentIds).toContain(segment.reference.id);

    // Restore the segment, then tamper a manifest segment reference instead.
    await port.commitFile(continuationSegmentPath(owner, f.plan.campaignId, segment.reference.id), segment.bytes, { kind: "any" });
    const manifest = clone(JSON.parse(new TextDecoder().decode(f.built.manifestBytes))) as Record<string, unknown>;
    const planDescriptor = manifest.plan as Record<string, unknown>;
    const references = planDescriptor.segments as Array<Record<string, unknown>>;
    if (references[0]) references[0].sha256 = "0".repeat(64);
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId), encodeCanonicalJson(manifest), { kind: "any" });
    expect(await store.inspectContinuation(owner, f.plan.campaignId)).toEqual({ status: "refused", code: "corrupt" });
  });

  test("a continuation is readable only by its recorded owner and campaign", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    await writeBook(port, otherOwner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    expect(await store.inspectContinuation(otherOwner, f.plan.campaignId)).toEqual({ status: "refused", code: "not-found" });
    const { digest: _d, ...content } = f.plan;
    expect((await store.loadContinuation(otherOwner, f.plan.campaignId, f.plan, ({ path }) => at(content, path))).status).toBe("refused");
    // Publishing another book's candidate under this book writes nothing for this book.
    await expectCode(store.publishContinuation(otherOwner, f.plan.campaignId, f.candidate), "corrupt");
    expect(await port.readFile(continuationManifestPath(otherOwner, f.plan.campaignId))).toBeNull();
    // A manifest copied under a foreign folder still names its recorded owner and refuses.
    const bytes = (await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes;
    if (!bytes) throw new Error("Missing manifest");
    await port.commitFile(continuationManifestPath(otherOwner, f.plan.campaignId), bytes, { kind: "absent" });
    expect(await store.inspectContinuation(otherOwner, f.plan.campaignId)).toEqual({ status: "refused", code: "corrupt" });
  });

  test("supported unknown fields in manifest, segment and intent records survive publication exactly", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    const first = f.built.segments[0];
    if (!first) throw new Error("Missing segment");
    // Craft a segment with a supported unknown field: it joins the semantic ID, while the
    // reference raw hash covers the exact new file bytes including the ID.
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
    const result = await store.publishContinuation(owner, f.plan.campaignId, candidate);
    expect(result.status).toBe("published");
    expect((await port.readFile(continuationSegmentPath(owner, f.plan.campaignId, newId)))?.bytes).toEqual(newSegmentBytes);
    expect((await port.readFile(continuationManifestPath(owner, f.plan.campaignId)))?.bytes).toEqual(manifestBytes);
    expect((await port.readFile(continuationIntentPath(owner, f.plan.campaignId, "operation-one")))?.bytes).toEqual(intentBytes);
    const inspected = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(inspected.status).toBe("structural-only");
    if (inspected.status === "structural-only") {
      expect(inspected.manifest.futureManifestNote).toBe("keep-manifest");
      expect(inspected.streams[0]?.segments[0]?.hasUnknownFields).toBe(true);
    }
    const readIntent = await store.readContinuationIntent(owner, f.plan.campaignId, "operation-one");
    if (!readIntent) throw new Error("Missing retained intent");
    expect((readIntent.intent as Record<string, unknown>).futureIntentNote).toBe("keep-intent");
  });

  test("dispatches current, compatible and future semantics through the storage reader", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture(false);
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    const current = await store.inspectContinuation(owner, f.plan.campaignId);
    expect(current.status).toBe("structural-only");
    if (current.status === "structural-only") expect(current.compatibility).toBe("serve-unchanged");

    const compatibleLabel = COMPATIBLE_CAMPAIGN_PLANNER_SEMANTICS[0];
    if (!compatibleLabel) throw new Error("Expected a compatible label");
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId),
      semanticsManifest(f.built.manifestBytes, compatibleLabel), { kind: "any" });
    expect(await store.inspectContinuation(owner, f.plan.campaignId)).toMatchObject({
      status: "replan-required", recordedPlannerSemantics: compatibleLabel
    });
    const { digest: _d, ...content } = f.plan;
    expect(await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path)))
      .toEqual({ status: "refused", code: "replan-required" });
    const replanned = await store.replanContinuation(owner, f.plan.campaignId, {
      sources: [f.sourceInput], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
    });
    expect(replanned.status).toBe("matched-local-plan-only");
    if (replanned.status === "matched-local-plan-only") {
      expect(replanned.plan.digest).toBe(f.plan.digest);
      expect(() => requireCampaignPlan(replanned.plan)).not.toThrow();
      expect(() => requireCampaignPlan(clone(replanned.plan) as CampaignPlan)).toThrow();
    }

    // Future semantics refuse before any segment file is read.
    await port.commitFile(continuationManifestPath(owner, f.plan.campaignId),
      semanticsManifest(f.built.manifestBytes, "review-campaign-planner-v99"), { kind: "any" });
    let segmentReads = 0;
    const originalRead = port.readFile.bind(port);
    port.readFile = async (path, options) => {
      if (path.join("/").includes(".segments/")) segmentReads += 1;
      return originalRead(path, options);
    };
    try {
      expect(await store.inspectContinuation(owner, f.plan.campaignId)).toEqual({ status: "refused", code: "unsupported" });
      expect((await store.loadContinuation(owner, f.plan.campaignId, f.plan, ({ path }) => at(content, path))).status).toBe("refused");
      expect((await store.replanContinuation(owner, f.plan.campaignId, {
        sources: [f.sourceInput], prompt: f.input.request.prompt, priorFeedback: f.input.request.priorFeedback
      })).status).toBe("refused");
    } finally {
      port.readFile = originalRead;
    }
    expect(segmentReads).toBe(0);
    expect(CAMPAIGN_PLANNER_SEMANTICS).toBe("review-campaign-planner-v1");
  });

  test("inventories are bounded and paged instead of truncating silently", async () => {
    const { port, store } = makeHarness();
    await writeBook(port, owner);
    const f = await fixture();
    await store.publishContinuation(owner, f.plan.campaignId, f.candidate);
    await expectCode(store.listContinuationIntents(owner, f.plan.campaignId, { limit: 201 }), "invalid");
    await expectCode(store.listContinuationSegments(owner, f.plan.campaignId, { offset: -1 }), "invalid");
    const page = await store.listContinuationSegments(owner, f.plan.campaignId, { offset: 0, limit: 1 });
    expect(page.total).toBe(f.built.segments.length);
    expect(page.segments).toHaveLength(1);

    // A directory beyond the format inventory ceiling refuses before any file is read.
    const entries = Array.from({ length: 65_537 }, (_value, index) => ({ name: `operation-${index}.json`, kind: "file" as const }));
    let fileReads = 0;
    const stubStorage = {
      readFile: async (path: Parameters<LibraryPort["readFile"]>[0], options?: { maxBytes: number }) => {
        fileReads += 1;
        return port.readFile(path, options);
      },
      listDirectory: async () => entries,
      inspectDirectory: async () => entries,
      stat: async () => null,
      ensureDirectory: async () => {},
      commitFile: async () => { throw new Error("unused"); },
      moveFile: async () => {},
      moveDirectory: async () => {},
      removeFile: async () => {},
      removeDirectory: async () => {},
      deviceInfo: async () => ({ id: "device_fixture01", name: "Fixture device", createdAt: time })
    } as unknown as LibraryPort;
    const stubStore = new CampaignContinuationStore({
      storage: stubStorage, runtime: port, deviceId: "device_fixture01",
      withBook: async (_id, work) => work(),
      commitFile: async () => { throw new Error("unused"); },
      createImmutableFile: async (path, bytes) => port.createImmutableFile(path, bytes)
    });
    fileReads = 0;
    await expectCode(stubStore.listContinuationIntents(owner, f.plan.campaignId), "too-large");
    // Only the owning book read happened; no inventory file was opened.
    expect(fileReads).toBe(1);
  });
});
