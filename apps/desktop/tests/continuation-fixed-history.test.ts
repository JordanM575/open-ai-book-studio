import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBody, serializeChapter } from "@ai-book-studio/core/markdown";
import { serializeHistoryRecord } from "@ai-book-studio/core/library/history";
import { buildCampaignContinuation } from "@ai-book-studio/core/review/campaign-continuation-build";
import {
  continuationManifestPath, continuationTrashManifestPath
} from "@ai-book-studio/core/review/campaign-continuation-store";
import { campaignInput, planned, withSynthesis } from "../../../packages/core/tests/review/campaign-fixtures";
import { Library } from "../src/main/library/store";

const time = "2026-11-08T12:00:00.000Z";
const later = "2026-11-08T13:00:00.000Z";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function at(root: unknown, path: readonly (string | number)[]): unknown {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== "object") throw new Error("Bad fixture path");
    value = Object.getOwnPropertyDescriptor(value, String(part))?.value;
  }
  return value;
}

async function fixtureLibrary(withCheckpoint = false) {
  const root = await mkdtemp(join(tmpdir(), "continuation-fixed-history-"));
  roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Synthetic continuation book" });
  const body = normalizeBody("Synthetic chapter prose for storage.\nSecond synthetic line.\n");
  const rawBytes = new TextEncoder().encode(serializeChapter({
    id: "ch_123456", title: "Synthetic chapter", order: 1, arc: "middle", purpose: "", synopsis: "",
    notes: "", isPrologue: false, color: null, version: 3,
    createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-02T00:00:00.000Z"
  }, body));
  const input = withSynthesis(await campaignInput(body));
  const source = input.sources[0];
  if (!source) throw new Error("Missing fixture source");
  source.saved = { ...source.saved, bookId: book.id, hash: sha256(rawBytes) };
  input.ownerBookId = book.id;
  if (input.request.books[0]) input.request.books[0].bookId = book.id;
  const plan = await planned(input);
  const checkpoint = withCheckpoint
    ? { checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId, planDigest: plan.digest,
        capturedAt: time, stages: plan.stages.map((stage) => ({ stageId: stage.stageId, receipt: null })) }
    : null;
  const built = await buildCampaignContinuation(plan, { operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint });
  const candidate = { manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments };
  const disk = (...segments: string[]) => join(root, ...segments);
  const historyBody = normalizeBody("Preserved history prose.\n");
  const historyText = await serializeHistoryRecord({
    meta: {
      schemaVersion: 1, kind: "snapshot", id: "hist_123456", bookId: book.id, chapterId: "ch_123456",
      label: "Preserved draft", capturedAt: time, sourceVersion: 3, sourceHash: "a".repeat(64),
      bodyHash: sha256(new TextEncoder().encode(historyBody))
    } as never,
    content: historyBody
  }, { sha256: async (bytes: Uint8Array) => sha256(bytes) } as never);
  const historyFileName = "2026-11-08T12-00-00-000Z-preserved-draft.md";
  const historyDisk = disk("books", book.id, "history", "ch_123456", historyFileName);
  await mkdir(join(historyDisk, ".."), { recursive: true });
  await writeFile(historyDisk, historyText);
  return { root, library, book, plan, built, candidate, body, rawBytes, disk, historyDisk, historyText, historyFileName };
}

describe("desktop campaign continuation fixed-history move", () => {
  test("trashes and restores a fixed-history group on disk with chain and readback intact", async () => {
    const f = await fixtureLibrary();
    const store = f.library.campaignContinuations;
    await store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate);
    const manifestDisk = f.disk("books", f.book.id, "reviews", "campaigns", `${f.plan.campaignId}.json`);
    expect(await readFile(manifestDisk)).toEqual(Buffer.from(f.built.manifestBytes));

    const trashed = await store.trashContinuationFixedHistory(f.book.id, f.plan.campaignId, {
      operationId: "fixed-trash-one", groupId: "group-one", createdAt: later
    });
    expect(trashed.status).toBe("trashed");
    await expect(readFile(manifestDisk)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(f.historyDisk)).rejects.toMatchObject({ code: "ENOENT" });
    const archivedDisk = f.disk(...continuationTrashManifestPath(f.book.id, f.plan.campaignId, "group-one"));
    expect(await readFile(archivedDisk)).toEqual(Buffer.from(f.built.manifestBytes));
    const archivedHistory = f.disk(".studio", "trash", f.book.id, "reviews", "campaign-group-one",
      "history", "ch_123456", f.historyFileName);
    expect(await readFile(archivedHistory, "utf8")).toBe(f.historyText);
    for (const segment of f.built.segments) {
      const archivedSegment = f.disk(".studio", "trash", f.book.id, "reviews", "campaign-group-one",
        "campaigns", `${f.plan.campaignId}.segments`, `${segment.reference.id}.json`);
      expect(await readFile(archivedSegment)).toEqual(Buffer.from(segment.bytes));
    }
    expect((await store.inspectContinuationFixedHistory(f.book.id, f.plan.campaignId, { groupId: "group-one" })).state)
      .toBe("archived");
    expect((await store.inspectContinuation(f.book.id, f.plan.campaignId)).status).toBe("refused");

    const restored = await store.restoreContinuationFixedHistory(f.book.id, f.plan.campaignId, {
      operationId: "fixed-restore-one", groupId: "group-one", createdAt: later
    });
    expect(restored.status).toBe("restored");
    expect(await readFile(manifestDisk)).toEqual(Buffer.from(f.built.manifestBytes));
    expect(await readFile(f.historyDisk, "utf8")).toBe(f.historyText);
    expect((await store.inspectContinuation(f.book.id, f.plan.campaignId)).status).toBe("structural-only");
    const { digest: _digest, ...content } = f.plan;
    const loaded = await store.loadContinuation(f.book.id, f.plan.campaignId, f.plan, ({ path }) => at(content, path));
    expect(loaded.status).toBe("matched-local-plan-only");
    expect((await store.inspectContinuationFixedHistory(f.book.id, f.plan.campaignId, { groupId: "group-one" })).state)
      .toBe("active");
  });

  test("a divergent member refuses the fixed-history move on disk and source bytes survive", async () => {
    const f = await fixtureLibrary();
    const store = f.library.campaignContinuations;
    await store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate);
    const segment = f.built.segments[0];
    if (!segment) throw new Error("Missing segment");
    const segmentDisk = f.disk("books", f.book.id, "reviews", "campaigns",
      `${f.plan.campaignId}.segments`, `${segment.reference.id}.json`);
    await writeFile(segmentDisk, "divergent synthetic bytes");
    await expect(store.trashContinuationFixedHistory(f.book.id, f.plan.campaignId, {
      operationId: "fixed-trash-blocked", groupId: "group-blocked", createdAt: later
    })).rejects.toMatchObject({ name: "ContinuationStorageError", code: "corrupt" });
    expect(await readFile(segmentDisk, "utf8")).toBe("divergent synthetic bytes");
    expect(await readFile(f.historyDisk, "utf8")).toBe(f.historyText);
    const manifestDisk = f.disk(...continuationManifestPath(f.book.id, f.plan.campaignId));
    expect(await readFile(manifestDisk)).toEqual(Buffer.from(f.built.manifestBytes));
    await expect(readFile(f.disk(...continuationTrashManifestPath(f.book.id, f.plan.campaignId, "group-blocked"))))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
