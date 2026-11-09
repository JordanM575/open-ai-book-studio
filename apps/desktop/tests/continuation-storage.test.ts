import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBody, serializeChapter } from "@ai-book-studio/core/markdown";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { buildCampaignContinuation } from "@ai-book-studio/core/review/campaign-continuation-build";
import {
  continuationIntentPath, continuationManifestPath, continuationSegmentPath
} from "@ai-book-studio/core/review/campaign-continuation-store";
import { campaignInput, planned, withSynthesis } from "../../../packages/core/tests/review/campaign-fixtures";
import { FileSystemLibraryPort } from "../src/main/library/fs-port";
import { Library } from "../src/main/library/store";

const time = "2026-11-08T12:00:00.000Z";
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

async function fixtureLibrary(withCheckpoint = true) {
  const root = await mkdtemp(join(tmpdir(), "continuation-storage-"));
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
  return { root, library, book, plan, built, candidate, body, rawBytes, disk,
    sourceInput: { kind: "current" as const, sourceId: source.sourceId, rawBytes } };
}

describe("desktop campaign continuation storage", () => {
  test("the filesystem adapter creates immutable files with genuine exclusive creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "continuation-wx-"));
    roots.push(root);
    const port = new FileSystemLibraryPort(root);
    const path = toLibraryPath(["books", "book_123456", "reviews", "campaigns", "campaign-one.segments", "s-one.json"]);
    const bytes = new TextEncoder().encode("synthetic segment");
    const first = await port.createImmutableFile(path, bytes);
    expect(first.status).toBe("written");
    expect(await readFile(join(root, "books", "book_123456", "reviews", "campaigns", "campaign-one.segments", "s-one.json")))
      .toEqual(Buffer.from(bytes));
    const divergent = new TextEncoder().encode("different bytes");
    const second = await port.createImmutableFile(path, divergent);
    expect(second.status).toBe("changed");
    expect(second.status === "changed" && second.current?.bytes).toEqual(bytes);
    expect(await readFile(join(root, "books", "book_123456", "reviews", "campaigns", "campaign-one.segments", "s-one.json")))
      .toEqual(Buffer.from(bytes));
    const source = await readFile(new URL("../src/main/library/fs-port.ts", import.meta.url), "utf8");
    expect(source).toContain('"wx"');
    // A linked descendant is refused before creation and the outside target is untouched.
    const outside = await mkdtemp(join(tmpdir(), "continuation-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "keep.json"), "keep");
    await symlink(outside, join(root, "books", "book_123456", "reviews", "campaigns", "linked.segments"), "dir");
    const linked = toLibraryPath(["books", "book_123456", "reviews", "campaigns", "linked.segments", "s-two.json"]);
    await expect(port.createImmutableFile(linked, bytes)).rejects.toMatchObject({ code: "unsupported" });
    expect(await readFile(join(outside, "keep.json"), "utf8")).toBe("keep");
    expect(await readdir(outside)).toEqual(["keep.json"]);
  });

  test("publishes and reads a continuation through the real Library on disk", async () => {
    const f = await fixtureLibrary();
    const store = f.library.campaignContinuations;
    const result = await store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate);
    expect(result.status).toBe("published");
    const manifestDisk = f.disk("books", f.book.id, "reviews", "campaigns", `${f.plan.campaignId}.json`);
    expect(await readFile(manifestDisk)).toEqual(Buffer.from(f.built.manifestBytes));
    for (const segment of f.built.segments) {
      const segmentDisk = f.disk("books", f.book.id, "reviews", "campaigns", `${f.plan.campaignId}.segments`, `${segment.reference.id}.json`);
      expect(await readFile(segmentDisk)).toEqual(Buffer.from(segment.bytes));
    }
    expect((await store.inspectContinuation(f.book.id, f.plan.campaignId)).status).toBe("structural-only");
    const { digest: _digest, ...content } = f.plan;
    const loaded = await store.loadContinuation(f.book.id, f.plan.campaignId, f.plan, ({ path }) => at(content, path));
    expect(loaded.status).toBe("matched-local-plan-only");
    const recovery = await store.inspectContinuationRecovery(f.book.id, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "complete", code: "already-published" });
    const again = await store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate);
    expect(again.status).toBe("already-published");
  });

  test("a divergent segment already on disk refuses and survives; identical republication completes", async () => {
    const f = await fixtureLibrary(false);
    const segment = f.built.segments[0];
    if (!segment) throw new Error("Missing segment");
    const segmentDisk = f.disk("books", f.book.id, "reviews", "campaigns", `${f.plan.campaignId}.segments`, `${segment.reference.id}.json`);
    await mkdir(join(segmentDisk, ".."), { recursive: true });
    await writeFile(segmentDisk, "divergent synthetic bytes");
    const store = f.library.campaignContinuations;
    await expect(store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate))
      .rejects.toMatchObject({ name: "ContinuationStorageError", code: "conflict" });
    expect(await readFile(segmentDisk, "utf8")).toBe("divergent synthetic bytes");
    await expect(readFile(f.disk("books", f.book.id, "reviews", "campaigns", `${f.plan.campaignId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    const recovery = await store.inspectContinuationRecovery(f.book.id, f.plan.campaignId, "operation-one");
    expect(recovery.classifications[0]).toMatchObject({ status: "refused", code: "conflict" });

    const g = await fixtureLibrary(false);
    const gSegment = g.built.segments[0];
    if (!gSegment) throw new Error("Missing segment");
    const port = g.library.libraryPort as FileSystemLibraryPort;
    await port.createImmutableFile(continuationSegmentPath(g.book.id, g.plan.campaignId, gSegment.reference.id), gSegment.bytes);
    expect((await g.library.campaignContinuations.publishContinuation(g.book.id, g.plan.campaignId, g.candidate)).status).toBe("published");
    expect((await g.library.campaignContinuations.inspectContinuationRecovery(g.book.id, g.plan.campaignId, "operation-one"))
      .classifications[0]).toMatchObject({ status: "complete", code: "already-published" });
  });

  test("fault injection at the segment and manifest boundaries leaves recoverable on-disk state", async () => {
    const f = await fixtureLibrary();
    const port = f.library.libraryPort as FileSystemLibraryPort & { createImmutableFile: NonNullable<FileSystemLibraryPort["createImmutableFile"]> };
    const originalCreate = port.createImmutableFile.bind(port);
    let calls = 0;
    port.createImmutableFile = async (path, bytes) => {
      calls += 1;
      if (calls === 3) throw new Error("simulated crash mid-segments");
      return originalCreate(path, bytes);
    };
    const store = f.library.campaignContinuations;
    await expect(store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate))
      .rejects.toMatchObject({ name: "ContinuationStorageError", code: "uncertain" });
    expect((await store.inspectContinuationRecovery(f.book.id, f.plan.campaignId, "operation-one"))
      .classifications[0]).toMatchObject({ status: "recoverable", code: "incomplete-draft" });
    port.createImmutableFile = originalCreate;
    expect((await store.publishContinuation(f.book.id, f.plan.campaignId, f.candidate)).status).toBe("published");

    const g = await fixtureLibrary();
    const gPort = g.library.libraryPort as FileSystemLibraryPort;
    const originalCommit = gPort.commitFile.bind(gPort);
    gPort.commitFile = async (path, bytes, expected) => {
      if (path.join("/") === continuationManifestPath(g.book.id, g.plan.campaignId).join("/")) {
        throw new Error("simulated crash before manifest");
      }
      return originalCommit(path, bytes, expected);
    };
    const gStore = g.library.campaignContinuations;
    await expect(gStore.publishContinuation(g.book.id, g.plan.campaignId, g.candidate))
      .rejects.toMatchObject({ name: "ContinuationStorageError", code: "uncertain" });
    expect((await gStore.inspectContinuationRecovery(g.book.id, g.plan.campaignId, "operation-one"))
      .classifications[0]).toMatchObject({ status: "recoverable", code: "prepared" });
    gPort.commitFile = originalCommit;
    expect((await gStore.publishContinuation(g.book.id, g.plan.campaignId, g.candidate)).status).toBe("published");
    // Intent bytes on disk are exactly the candidate intent, never re-encoded.
    const intentDisk = g.disk(...continuationIntentPath(g.book.id, g.plan.campaignId, "operation-one"));
    expect(await readFile(intentDisk)).toEqual(Buffer.from(g.built.intentBytes));
  });
});
