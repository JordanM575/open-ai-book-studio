import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBody, serializeChapter } from "@ai-book-studio/core/markdown";
import { buildCampaignContinuation } from "@ai-book-studio/core/review/campaign-continuation-build";
import type { ContinuationCheckinCounts } from "@ai-book-studio/core/review/campaign-continuation-checkin";
import { encodeCanonicalJson } from "@ai-book-studio/core/review/record-json";
import { campaignInput, planned, withSynthesis } from "../../../packages/core/tests/review/campaign-fixtures";
import { Library } from "../src/main/library/store";
import {
  readContinuationCheckin, ContinuationCheckinError,
  type CoordinatorIdentity
} from "../src/main/continuation-checkin";

/*
 * Library-level host reading for the 039 T018 seam 6b check-in: a synthetic
 * checked campaign in a temporary library, mapped through the accepted 6a
 * contract. The 037 coordinator identity is host-supplied here exactly as the
 * main process will supply it; no real library, profile or provider is used.
 */

const time = "2026-11-08T12:00:00.000Z";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (n = 1) => n.toString(16).padStart(64, "0");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const coordinator = (bookId: string): CoordinatorIdentity => {
  const owner = { libraryRegistration: "lib_fixture", bookId, runId: "run_fixture" };
  return { owner, direction: { kind: "direction", owner, id: "direction_fixture", revision: 1, hash: hash(7) } };
};

async function checkedLibrary() {
  const root = await mkdtemp(join(tmpdir(), "continuation-checkin-"));
  roots.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Synthetic check-in book" });
  const body = normalizeBody("Synthetic chapter prose for check-in mapping.\nSecond synthetic line.\n");
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
  const checkpoint = {
    checkpointVersion: 1, owner: { bookId: plan.ownerBookId }, campaignId: plan.campaignId,
    planDigest: plan.digest, capturedAt: time,
    stages: plan.stages.map((stage, index) => ({
      stageId: stage.stageId,
      receipt: index === 0
        ? { status: "completed", completedCategories: [...plan.categories], at: time, actualScopeDigest: null, report: null }
        : null
    }))
  };
  const built = await buildCampaignContinuation(plan, {
    operationId: "operation-one", createdAt: time, updatedAt: time, checkpoint
  });
  await library.campaignContinuations.publishContinuation(book.id, plan.campaignId, {
    manifestBytes: built.manifestBytes, intentBytes: built.intentBytes, segments: built.segments
  });
  const disk = (...segments: string[]) => join(root, ...segments);
  return { root, library, book, plan, built, disk };
}

const refusal = async (promise: Promise<unknown>): Promise<ContinuationCheckinError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ContinuationCheckinError) return error;
    throw error;
  }
  throw new Error("Expected a typed check-in refusal");
};

describe("continuation check-in host reading (039 T018 seam 6b)", () => {
  test("maps a checked campaign in a temp library from the codec's own counters", async () => {
    const { library, book, plan, built } = await checkedLibrary();
    const checkin = await readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId }, coordinator(book.id));
    const manifest = JSON.parse(new TextDecoder().decode(built.manifestBytes)) as {
      revision: number; counts: ContinuationCheckinCounts; segmentCount: number; segmentBytes: number; tokenCount: number;
    };
    expect(checkin.campaignId).toBe(plan.campaignId);
    expect(checkin.ownerBookId).toBe(book.id);
    expect(checkin.revision).toBe(manifest.revision);
    expect(checkin.counts).toEqual(manifest.counts);
    expect(checkin.segments).toMatchObject({
      count: manifest.segmentCount, bytes: manifest.segmentBytes, tokens: manifest.tokenCount
    });
    // Scalar/byte counters are never relabelled as words (6a gap 1).
    expect("targetWords" in checkin).toBe(false);
    expect("wordCount" in checkin).toBe(false);
    expect(checkin.checkpoint?.receipts.completed).toBe(1);
    expect(checkin.checkpoint?.completedStageIds).toEqual(plan.stages.slice(0, 1).map((stage) => stage.stageId));
    expect(checkin.coordinator.owner).toEqual(coordinator(book.id).owner);
    // The renderer-facing value carries data only: no library path leaks in.
    expect(JSON.stringify(checkin)).not.toContain("books/");
  });

  test("a stale expectation refuses as conflict, never as a mapped result", async () => {
    const { library, book, plan } = await checkedLibrary();
    const staleRevision = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId, expected: { revision: 99 } }, coordinator(book.id)));
    expect(staleRevision.code).toBe("conflict");
    const staleHash = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId, expected: { manifestHash: hash(42) } },
      coordinator(book.id)));
    expect(staleHash.code).toBe("conflict");
  });

  test("a partial campaign group refuses as uncertain, never as complete", async () => {
    const { library, book, plan, disk } = await checkedLibrary();
    // Splitting the group (intents gone, manifest and segments intact and
    // still verifying) is partial: inspection maps, the group gate refuses.
    await rm(disk("books", book.id, "reviews", "campaigns", `${plan.campaignId}.intents`), {
      recursive: true, force: true
    });
    const partial = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId }, coordinator(book.id)));
    expect(partial.code).toBe("uncertain");
  });

  test("cross-book coordinator identity refuses as corrupt; an unknown campaign as not-found", async () => {
    const { library, book, plan } = await checkedLibrary();
    const foreign = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId }, coordinator("book_654321")));
    expect(foreign.code).toBe("corrupt");
    const missing = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: "campaign-missing" }, coordinator(book.id)));
    expect(missing.code).toBe("not-found");
  });

  test("a future semantics label refuses as unsupported, without mapping it", async () => {
    const { library, book, plan, built, disk } = await checkedLibrary();
    const manifest = JSON.parse(new TextDecoder().decode(built.manifestBytes)) as Record<string, unknown>;
    manifest.plannerSemantics = "review-campaign-planner-v99";
    await writeFile(
      disk("books", book.id, "reviews", "campaigns", `${plan.campaignId}.json`),
      encodeCanonicalJson(manifest));
    const future = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId }, coordinator(book.id)));
    expect(future.code).toBe("unsupported");
    expect(await readFile(disk("books", book.id, "reviews", "campaigns", `${plan.campaignId}.json`)))
      .toEqual(Buffer.from(encodeCanonicalJson(manifest)));
  });

  test("with no 037 coordinator identity supplied, the host refuses truthfully instead of inventing one", async () => {
    const { library, book, plan } = await checkedLibrary();
    const missing = await refusal(readContinuationCheckin(
      library, { bookId: book.id, campaignId: plan.campaignId }, null));
    expect(missing.code).toBe("unsupported");
    expect(missing.message).toContain("037");
  });
});
