import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { validateAdoptionReceipt, type AdoptionReceipt, type Owner } from "../../src/authoring";
import { adoptionReceiptPath, adoptionReceiptsPath } from "../../src/workflow/paths";
import { AdoptionReceiptStore } from "../../src/workflow/adoption-receipt-store";
import { WorkflowRecordError } from "../../src/workflow/record-error";
import { hash, makeBook, ownerFor, runId, sha256Hex } from "./record-fixtures";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const adoptedAt = "2026-11-07T12:00:00.000Z";

function reference(kind: string, owner: Owner, id: string, revision = 1): Record<string, unknown> {
  return { kind, owner: { ...owner }, id, revision, hash: hash(revision + 1) };
}

function receiptValue(
  bookId: string,
  overrides: Record<string, unknown> = {},
  run = runId
): Record<string, unknown> {
  const owner = ownerFor(bookId, run);
  return {
    schemaVersion: 1,
    kind: "adoption-receipt",
    id: "adoption_00000001",
    owner,
    chapterId: "ch_00000001",
    candidate: reference("artifact", owner, "artifact_00000001", 1),
    resultVersion: 1,
    resultHash: hash(9),
    grant: reference("grant", owner, "grant_00000001", 1),
    direction: reference("direction", owner, "direction_00000001", 1),
    sequence: 1,
    adoptedAt,
    ...overrides
  };
}

async function makeStore() {
  const fixture = await makeBook();
  const { library, book, port } = fixture;
  const store = new AdoptionReceiptStore({
    storage: port,
    runtime: port,
    deviceId: "device_fixture01",
    withBook: library.writeHost.withBook,
    commitFile: library.writeHost.commitFile
  });
  return { ...fixture, store, bookId: book.id };
}

async function refusal(run: Promise<unknown>): Promise<WorkflowRecordError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WorkflowRecordError) return error;
    throw error;
  }
  throw new Error("Expected a WorkflowRecordError refusal");
}

describe("adoption receipt checked store", () => {
  test("creates a receipt absent-only and reads it back byte-exactly", async () => {
    const { store, bookId, port } = await makeStore();
    const value = receiptValue(bookId);
    const created = await store.createAdoptionReceipt(bookId, runId, value);
    expect(created.status).toBe("created");
    expect(created.record.record.id).toBe("adoption_00000001");
    const stored = await port.readFile(adoptionReceiptPath(bookId, runId, "adoption_00000001"));
    expect(stored).not.toBeNull();
    expect(stored?.bytes).toEqual(created.record.bytes);
    expect(stored?.sha256).toBe(created.record.hash);
    expect(created.record.hash).toBe(sha256Hex(created.record.bytes));
    // canonical: compact sorted keys, no trailing newline
    const text = decoder.decode(created.record.bytes);
    expect(text.endsWith("\n")).toBe(false);
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(text.startsWith('{"adoptedAt":')).toBe(true);
    const read = await store.readAdoptionReceipt(bookId, runId, "adoption_00000001");
    expect(read?.hash).toBe(created.record.hash);
    expect(read?.bytes).toEqual(created.record.bytes);
    expect(read?.record).toEqual(created.record.record);
    expect(await store.readAdoptionReceipt(bookId, runId, "adoption_00000099")).toBeNull();
  });

  test("duplicate candidate refuses rather than overwrites, even with a new receipt id", async () => {
    const { store, bookId, port } = await makeStore();
    const first = await store.createAdoptionReceipt(bookId, runId, receiptValue(bookId));
    const before = await port.readFile(adoptionReceiptPath(bookId, runId, "adoption_00000001"));
    // same candidate artifact, new receipt id and later sequence
    const duplicate = receiptValue(bookId, {
      id: "adoption_00000002",
      sequence: 2,
      adoptedAt: "2026-11-07T12:05:00.000Z"
    });
    const error = await refusal(store.createAdoptionReceipt(bookId, runId, duplicate));
    expect(error.code).toBe("conflict");
    expect(error.savedAs).toContain("/conflicts/");
    expect((await port.readFile(adoptionReceiptPath(bookId, runId, "adoption_00000001")))?.sha256)
      .toBe(before?.sha256);
    // the refused receipt was not published under its own id
    expect(await port.readFile(adoptionReceiptPath(bookId, runId, "adoption_00000002"))).toBeNull();
    // same receipt id, identical bytes also refuses (strict absent-only)
    const again = await refusal(store.createAdoptionReceipt(bookId, runId, receiptValue(bookId)));
    expect(again.code).toBe("conflict");
    expect((await store.readAdoptionReceipt(bookId, runId, "adoption_00000001"))?.hash).toBe(first.record.hash);
  });

  test("duplicate sequence and re-adoption with a new candidate", async () => {
    const { store, bookId } = await makeStore();
    await store.createAdoptionReceipt(bookId, runId, receiptValue(bookId));
    // same sequence, different chapter/candidate refuses
    const owner = ownerFor(bookId);
    const sameSequence = receiptValue(bookId, {
      id: "adoption_00000002",
      chapterId: "ch_00000002",
      candidate: reference("artifact", owner, "artifact_00000002", 1)
    });
    expect((await refusal(store.createAdoptionReceipt(bookId, runId, sameSequence))).code).toBe("conflict");
    // re-adoption of the same chapter with a NEW candidate and next sequence succeeds
    const readopted = receiptValue(bookId, {
      id: "adoption_00000003",
      candidate: reference("artifact", owner, "artifact_00000003", 1),
      resultVersion: 2,
      resultHash: hash(11),
      sequence: 2,
      adoptedAt: "2026-11-07T12:10:00.000Z"
    });
    const created = await store.createAdoptionReceipt(bookId, runId, readopted);
    expect(created.status).toBe("created");
    const listing = await store.listAdoptionReceipts(bookId, runId);
    expect(listing.total).toBe(2);
  });

  test("grant, direction and candidate references that do not validate refuse before any commit", async () => {
    const { store, bookId, port } = await makeStore();
    const owner = ownerFor(bookId);
    const foreign = { ...owner, runId: "run_99999999" };
    const cases: Array<Record<string, unknown>> = [
      receiptValue(bookId, { candidate: reference("artifact", foreign, "artifact_00000001", 1) }),
      receiptValue(bookId, { direction: reference("direction", foreign, "direction_00000001", 1) }),
      receiptValue(bookId, { grant: reference("grant", { ...owner, bookId: "book_99999999" }, "grant_00000001", 1) }),
      receiptValue(bookId, {
        candidate: { kind: "artifact", owner, id: "artifact_00000001", revision: 1, hash: "short" }
      }),
      receiptValue(bookId, { schemaVersion: 2 })
    ];
    for (const value of cases) {
      expect((await refusal(store.createAdoptionReceipt(bookId, runId, value))).code).toBe("invalid");
      expect(await port.readFile(adoptionReceiptPath(bookId, runId, "adoption_00000001"))).toBeNull();
    }
  });

  test("foreign book or run refuses on create, read and list", async () => {
    const { store, bookId, port } = await makeStore();
    const created = await store.createAdoptionReceipt(bookId, runId, receiptValue(bookId));
    expect(created.status).toBe("created");
    // create naming another book
    expect((await refusal(store.createAdoptionReceipt(bookId, runId, receiptValue("book_00000099")))).code)
      .toBe("invalid");
    // plant a foreign receipt file under this run's directory
    const foreignValue = receiptValue("book_00000099", { id: "adoption_00000077" });
    const foreignBytes = encoder.encode(JSON.stringify(foreignValue));
    await port.commitFile(adoptionReceiptPath(bookId, runId, "adoption_00000077"), foreignBytes, { kind: "absent" });
    expect((await refusal(store.readAdoptionReceipt(bookId, runId, "adoption_00000077"))).code)
      .toBe("unavailable");
    expect((await refusal(store.listAdoptionReceipts(bookId, runId))).code).toBe("unavailable");
  });

  test("bounded listing is sorted by sequence and paginated", async () => {
    const { store, bookId } = await makeStore();
    const owner = ownerFor(bookId);
    for (let index = 3; index >= 1; index -= 1) {
      await store.createAdoptionReceipt(bookId, runId, receiptValue(bookId, {
        id: `adoption_0000000${index}`,
        chapterId: `ch_0000000${index}`,
        candidate: reference("artifact", owner, `artifact_0000000${index}`, 1),
        resultHash: hash(20 + index),
        sequence: index,
        adoptedAt: `2026-11-07T12:0${index}:00.000Z`
      }));
    }
    const all = await store.listAdoptionReceipts(bookId, runId);
    expect(all.total).toBe(3);
    expect(all.receipts.map((entry) => entry.record.sequence)).toEqual([1, 2, 3]);
    const page = await store.listAdoptionReceipts(bookId, runId, { offset: 1, limit: 1 });
    expect(page.total).toBe(3);
    expect(page.receipts).toHaveLength(1);
    expect(page.receipts[0]?.record.sequence).toBe(2);
    expect((await refusal(store.listAdoptionReceipts(bookId, runId, { limit: 0 }))).code).toBe("invalid");
    expect((await refusal(store.listAdoptionReceipts(bookId, runId, { limit: 10_000 }))).code).toBe("invalid");
    expect((await refusal(store.listAdoptionReceipts(bookId, runId, { offset: -1 }))).code).toBe("invalid");
    // empty run lists as empty, not an error
    const empty = await store.listAdoptionReceipts(bookId, "run_00000002");
    // run_00000002 has no book queue entry yet; listing an absent directory is empty only when the
    // owning book check passes. The book exists, so an absent run directory lists empty.
    expect(empty.total).toBe(0);
    void adoptionReceiptsPath;
  });

  test("malformed, future and oversized stored receipts refuse untouched", async () => {
    const { store, bookId, port } = await makeStore();
    const path = adoptionReceiptPath(bookId, runId, "adoption_00000001");
    const future = encoder.encode(JSON.stringify(receiptValue(bookId, { schemaVersion: 2 })));
    const seededFuture = await port.commitFile(path, future, { kind: "absent" });
    expect(seededFuture.status).toBe("written");
    if (seededFuture.status !== "written") throw new Error("Synthetic future seed failed");
    expect((await refusal(store.readAdoptionReceipt(bookId, runId, "adoption_00000001"))).code)
      .toBe("newer-schema");
    expect((await port.readFile(path))?.sha256).toBe(seededFuture.snapshot.sha256);

    const corruptPath = adoptionReceiptPath(bookId, runId, "adoption_00000002");
    const seededCorrupt = await port.commitFile(corruptPath, encoder.encode("{invalid"), { kind: "absent" });
    expect(seededCorrupt.status).toBe("written");
    if (seededCorrupt.status !== "written") throw new Error("Synthetic corrupt seed failed");
    expect((await refusal(store.readAdoptionReceipt(bookId, runId, "adoption_00000002"))).code).toBe("corrupt");
    expect((await port.readFile(corruptPath))?.sha256).toBe(seededCorrupt.snapshot.sha256);
  });

  test("counter over stored receipts counts distinct chapters since a marker", async () => {
    const { store, bookId } = await makeStore();
    const owner = ownerFor(bookId);
    const values = [
      receiptValue(bookId),
      receiptValue(bookId, {
        id: "adoption_00000002", chapterId: "ch_00000002",
        candidate: reference("artifact", owner, "artifact_00000002", 1),
        resultHash: hash(21), sequence: 2, adoptedAt: "2026-11-07T12:05:00.000Z"
      }),
      receiptValue(bookId, {
        id: "adoption_00000003",
        candidate: reference("artifact", owner, "artifact_00000003", 1),
        resultVersion: 2, resultHash: hash(22), sequence: 3, adoptedAt: "2026-11-07T12:10:00.000Z"
      })
    ];
    for (const value of values) await store.createAdoptionReceipt(bookId, runId, value);
    const listing = await store.listAdoptionReceipts(bookId, runId, { limit: 256 });
    const receipts = listing.receipts.map((entry) => entry.record) as unknown as AdoptionReceipt[];
    const typedOwner = validateAdoptionReceipt(receiptValue(bookId) as unknown as AdoptionReceipt).owner as unknown as Owner;
    void typedOwner;
    const { countAdoptedChapters } = await import("../../src/authoring");
    const ownerValue = ownerFor(bookId) as unknown as Parameters<typeof countAdoptedChapters>[1];
    expect(countAdoptedChapters(receipts, ownerValue).adoptedChaptersSinceCheckin).toBe(2);
    expect(countAdoptedChapters(receipts, ownerValue, { kind: "sequence", sequence: 1 })
      .adoptedChaptersSinceCheckin).toBe(2);
    expect(countAdoptedChapters(receipts, ownerValue).firstAdoptedChapterOccurred).toBe(true);
    // sha256 helper sanity (stored bytes hash through the runtime)
    const firstEntry = listing.receipts[0];
    if (!firstEntry) throw new Error("Expected a stored receipt");
    expect(createHash("sha256").update(firstEntry.bytes).digest("hex")).toBe(firstEntry.hash);
  });

  test("deep-frozen create input is not mutated", async () => {
    const { store, bookId } = await makeStore();
    const value = receiptValue(bookId);
    const frozen = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const deepFreeze = (input: unknown): void => {
      if (input !== null && typeof input === "object") {
        for (const child of Object.values(input)) deepFreeze(child);
        Object.freeze(input);
      }
    };
    deepFreeze(frozen);
    const created = await store.createAdoptionReceipt(bookId, runId, frozen);
    expect(created.status).toBe("created");
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
