import { describe, expect, test } from "bun:test";
import type { Reference } from "../../src/authoring/contracts";
import type { CommitFileResult, FileExpectation, LibraryPath } from "../../src/library/port";
import { WorkflowRecordError } from "../../src/workflow/record-error";
import { adoptionReceiptPath, adoptionReceiptsPath } from "../../src/workflow/paths";
import { at, effectRecord, hash, makeBook, ownerFor, reference, runId } from "./record-fixtures";

/**
 * Publisher-level adoption receipts (037 FR-017 / T032 partial).
 *
 * The confirmation point wired here is the checked effect record saved through
 * `library.workflowRecords.saveEffect` with phase "confirmed" and a receipt of
 * `{ outcome: "confirmed", resultVersion, resultHash, at }`. That record carries
 * owner, candidate, target chapter and result version/hash; it does not carry a
 * grant or direction reference, so the caller supplies those two references
 * explicitly. Synthetic in-memory libraries only.
 */

const otherRun = "run_00000002";

function confirmedEffect(bookId: string, overrides: Record<string, unknown> = {}) {
  return effectRecord(bookId, {
    phase: "confirmed",
    intent: {
      at,
      baseVersion: 0,
      baseHash: null,
      intendedHash: hash(10),
      intendedBytes: 128,
      safety: null
    },
    receipt: { outcome: "confirmed", at, resultVersion: 1, resultHash: hash(9) },
    ...overrides
  });
}

function grantFor(bookId: string, run = runId): Reference<"grant"> {
  return reference("grant", ownerFor(bookId, run), "grant_00000001", 1) as unknown as Reference<"grant">;
}

function directionFor(bookId: string, run = runId): Reference<"direction"> {
  return reference("direction", ownerFor(bookId, run), "direction_00000001", 1) as unknown as Reference<"direction">;
}

function candidateFor(bookId: string, id = "artifact_00000001", run = runId): Reference<"artifact"> {
  return reference("artifact", ownerFor(bookId, run), id, 1) as unknown as Reference<"artifact">;
}

function key(path: LibraryPath): string {
  return path.join("/");
}

async function saveConfirmedEffect(
  library: Awaited<ReturnType<typeof makeBook>>["library"],
  bookId: string,
  overrides: Record<string, unknown> = {},
  run = runId
) {
  const saved = await library.workflowRecords.saveEffect(bookId, run, confirmedEffect(bookId, overrides));
  expect(saved.status).toBe("saved");
  return saved;
}

describe("Library publisher adoption receipts", () => {
  test("exposes the adoption receipt store on LibraryService", async () => {
    const { library, book } = await makeBook();
    expect(library.adoptionReceipts).toBeDefined();
    const empty = await library.adoptionReceipts.listAdoptionReceipts(book.id, runId);
    expect(empty.total).toBe(0);
  });

  test("records exactly one receipt on confirmed adoption with exact field binding", async () => {
    const { library, book } = await makeBook();
    await saveConfirmedEffect(library, book.id);

    const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });

    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") throw new Error("Expected a recorded receipt");
    const receipt = result.receipt.record;
    expect(receipt.owner).toEqual(ownerFor(book.id));
    expect(receipt.chapterId).toBe("ch_00000001");
    expect(receipt.candidate).toEqual(candidateFor(book.id));
    expect(receipt.resultVersion).toBe(1);
    expect(receipt.resultHash).toBe(hash(9));
    expect(receipt.grant).toEqual(grantFor(book.id));
    expect(receipt.direction).toEqual(directionFor(book.id));
    expect(receipt.sequence).toBe(1);
    expect(receipt.adoptedAt).toBe(at);

    const listing = await library.adoptionReceipts.listAdoptionReceipts(book.id, runId);
    expect(listing.total).toBe(1);
    expect(listing.receipts[0]?.hash).toBe(result.receipt.hash);
    expect(listing.receipts[0]?.bytes).toEqual(result.receipt.bytes);
  });

  test("sequence increments monotonically across two adoptions and does not reuse after listing", async () => {
    const { library, book } = await makeBook();
    const owner = ownerFor(book.id);
    await saveConfirmedEffect(library, book.id);
    const first = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });
    expect(first.status).toBe("recorded");
    if (first.status !== "recorded") throw new Error("Expected first receipt");
    expect(first.receipt.record.sequence).toBe(1);

    // Listing between adoptions must not reset or reuse the sequence.
    expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, runId)).total).toBe(1);

    await library.workflowRecords.saveEffect(book.id, runId, confirmedEffect(book.id, {
      id: "effect_00000002",
      candidate: reference("artifact", owner, "artifact_00000002", 1),
      target: { kind: "new-chapter", chapterId: "ch_00000002", path: "chapters/0002-scene.md" },
      receipt: { outcome: "confirmed", at, resultVersion: 1, resultHash: hash(19) }
    }));
    const second = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000002", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });
    expect(second.status).toBe("recorded");
    if (second.status !== "recorded") throw new Error("Expected second receipt");
    expect(second.receipt.record.sequence).toBe(2);

    const listing = await library.adoptionReceipts.listAdoptionReceipts(book.id, runId);
    expect(listing.receipts.map((entry) => entry.record.sequence)).toEqual([1, 2]);
  });

  test("concurrent confirmed adoptions allocate distinct monotonic sequences", async () => {
    const { library, book } = await makeBook();
    const owner = ownerFor(book.id);
    await saveConfirmedEffect(library, book.id);
    await library.workflowRecords.saveEffect(book.id, runId, confirmedEffect(book.id, {
      id: "effect_00000002",
      candidate: reference("artifact", owner, "artifact_00000002", 1),
      target: { kind: "new-chapter", chapterId: "ch_00000002", path: "chapters/0002-scene.md" },
      receipt: { outcome: "confirmed", at, resultVersion: 1, resultHash: hash(19) }
    }));

    const [first, second] = await Promise.all([
      library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
        grant: grantFor(book.id),
        direction: directionFor(book.id)
      }),
      library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000002", {
        grant: grantFor(book.id),
        direction: directionFor(book.id)
      })
    ]);
    expect(first.status).toBe("recorded");
    expect(second.status).toBe("recorded");
    const sequences = [first, second]
      .map((result) => (result.status === "recorded" ? result.receipt.record.sequence : 0))
      .sort();
    expect(sequences).toEqual([1, 2]);
  });

  test("duplicate confirmation records no second receipt and does not fail spuriously", async () => {
    const { library, book } = await makeBook();
    await saveConfirmedEffect(library, book.id);
    const refs = { grant: grantFor(book.id), direction: directionFor(book.id) };

    const first = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", refs);
    const duplicate = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", refs);

    expect(first.status).toBe("recorded");
    expect(duplicate.status).toBe("already-recorded");
    if (first.status !== "recorded" || duplicate.status !== "already-recorded") {
      throw new Error("Expected recorded then already-recorded");
    }
    expect(duplicate.receipt.record.id).toBe(first.receipt.record.id);
    expect(duplicate.receipt.record.sequence).toBe(first.receipt.record.sequence);
    expect(duplicate.receipt.hash).toBe(first.receipt.hash);
    expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, runId)).total).toBe(1);
  });

  test("conflicting existing receipt for the same candidate fails truthfully and does not roll back adoption", async () => {
    const { library, book } = await makeBook();
    await saveConfirmedEffect(library, book.id);
    // A different recorded adoption already exists for this exact candidate.
    const owner = ownerFor(book.id);
    await library.adoptionReceipts.createAdoptionReceipt(book.id, runId, {
      schemaVersion: 1,
      kind: "adoption-receipt",
      id: "adoption_00000077",
      owner,
      chapterId: "ch_00000001",
      candidate: reference("artifact", owner, "artifact_00000001", 1),
      resultVersion: 1,
      resultHash: hash(42),
      grant: reference("grant", owner, "grant_00000001", 1),
      direction: reference("direction", owner, "direction_00000001", 1),
      sequence: 1,
      adoptedAt: at
    });

    const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });

    expect(result.status).toBe("confirmed-unrecorded");
    if (result.status !== "confirmed-unrecorded") throw new Error("Expected confirmed-unrecorded");
    expect(result.code).toBe("conflict");
    expect(result.message).toContain("adoption is confirmed");
    expect(result.message).toContain("not recorded");
    expect("receipt" in result).toBe(false);
    // The adopted effect remains confirmed: receipt failure never rolls it back.
    expect((await library.workflowRecords.readEffect(book.id, runId, "effect_00000001"))?.record.phase)
      .toBe("confirmed");
    const listing = await library.adoptionReceipts.listAdoptionReceipts(book.id, runId);
    expect(listing.total).toBe(1);
    expect(listing.receipts[0]?.record.id).toBe("adoption_00000077");
    expect(listing.receipts[0]?.record.resultHash).toBe(hash(42));
  });

  test("uncertain write followed by byte-exact read-back reports recorded", async () => {
    const { library, book, port } = await makeBook();
    await saveConfirmedEffect(library, book.id);
    const original = port.commitFile.bind(port);
    port.commitFile = async (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> => {
      const result = await original(path, bytes, expected);
      if (key(path).includes("/adoptions/") && result.status === "written") {
        return { status: "changed", current: result.snapshot, publication: "uncertain" };
      }
      return result;
    };

    const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });

    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") throw new Error("Expected recorded after read-back");
    expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, runId)).total).toBe(1);
    const stored = await port.readFile(
      adoptionReceiptPath(book.id, runId, result.receipt.record.id)
    );
    expect(stored?.bytes).toEqual(result.receipt.bytes);
  });

  test("uncertain write with mismatched read-back fails truthfully and claims no receipt", async () => {
    const { library, book, port } = await makeBook();
    await saveConfirmedEffect(library, book.id);
    const original = port.commitFile.bind(port);
    let mismatchedHash = "";
    port.commitFile = async (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> => {
      if (key(path).includes("/adoptions/") && expected.kind === "absent") {
        // Publish different bytes and report the publication as uncertain.
        const different = new TextEncoder().encode(
          JSON.stringify({ ...JSON.parse(new TextDecoder().decode(bytes)), resultHash: hash(99) })
        );
        const result = await original(path, different, expected);
        if (result.status === "written") {
          mismatchedHash = result.snapshot.sha256;
          return { status: "changed", current: result.snapshot, publication: "uncertain" };
        }
      }
      return original(path, bytes, expected);
    };

    const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });

    expect(result.status).toBe("confirmed-unrecorded");
    if (result.status !== "confirmed-unrecorded") throw new Error("Expected confirmed-unrecorded");
    expect(result.code).toBe("uncertain");
    expect("receipt" in result).toBe(false);
    // The mismatched bytes were never overwritten or claimed as the receipt.
    expect(mismatchedHash).not.toBe("");
    const listingPaths = await port.listDirectory(adoptionReceiptsPath(book.id, runId));
    expect(listingPaths).toHaveLength(1);
    const stored = await port.readFile(
      adoptionReceiptPath(book.id, runId, listingPaths[0]?.name.replace(/\.json$/, "") ?? "")
    );
    expect(stored?.sha256).toBe(mismatchedHash);
  });

  test("foreign book and run receipts are never counted or listed through this surface", async () => {
    const { library, book } = await makeBook();
    const otherBook = await library.createBook({ title: "Synthetic other book" });
    await saveConfirmedEffect(library, book.id);
    const recorded = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: grantFor(book.id),
      direction: directionFor(book.id)
    });
    expect(recorded.status).toBe("recorded");

    expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, otherRun)).total).toBe(0);
    expect((await library.adoptionReceipts.listAdoptionReceipts(otherBook.id, runId)).total).toBe(0);
    expect(await library.adoptionReceipts.readAdoptionReceipt(otherBook.id, runId, "adoption_00000001"))
      .toBeNull();

    // Recording through a foreign book cannot borrow this book's confirmed effect.
    let foreignError: unknown = null;
    try {
      await library.recordConfirmedAdoptionReceipt(otherBook.id, runId, "effect_00000001", {
        grant: grantFor(otherBook.id),
        direction: directionFor(otherBook.id)
      });
    } catch (error) {
      foreignError = error;
    }
    expect(foreignError).toBeInstanceOf(WorkflowRecordError);
    expect((await library.adoptionReceipts.listAdoptionReceipts(otherBook.id, runId)).total).toBe(0);
  });

  test.each(["prepared", "publish-intent", "not-published"] as const)(
    "no receipt on %s outcome, only confirmed",
    async (phase) => {
      const { library, book } = await makeBook();
      const intent = phase === "prepared"
        ? null
        : {
            at,
            baseVersion: 0,
            baseHash: null,
            intendedHash: hash(10),
            intendedBytes: 128,
            safety: null
          };
      const receipt = phase === "not-published"
        ? { outcome: "not-published" as const, at }
        : null;
      await library.workflowRecords.saveEffect(book.id, runId, effectRecord(book.id, {
        phase,
        intent,
        receipt
      }));

      const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
        grant: grantFor(book.id),
        direction: directionFor(book.id)
      });

      expect(result.status).toBe("not-confirmed");
      if (result.status === "not-confirmed") expect(result.phase).toBe(phase);
      expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, runId)).total).toBe(0);
    }
  );

  test("a grant or direction the receipt cannot bind is not fabricated", async () => {
    const { library, book } = await makeBook();
    await saveConfirmedEffect(library, book.id);
    const foreign = { ...ownerFor(book.id), runId: otherRun };

    const result = await library.recordConfirmedAdoptionReceipt(book.id, runId, "effect_00000001", {
      grant: reference("grant", foreign, "grant_00000001", 1) as unknown as Reference<"grant">,
      direction: directionFor(book.id)
    });

    expect(result.status).toBe("confirmed-unrecorded");
    if (result.status !== "confirmed-unrecorded") throw new Error("Expected confirmed-unrecorded");
    expect(result.code).toBe("invalid");
    expect((await library.adoptionReceipts.listAdoptionReceipts(book.id, runId)).total).toBe(0);
  });
});
