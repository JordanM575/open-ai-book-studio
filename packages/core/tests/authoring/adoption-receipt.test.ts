import { describe, expect, test } from "bun:test";
import {
  ADOPTION_RECEIPT_LIMITS,
  countAdoptedChapters,
  validateAdoptionReceipt,
  type AdoptionReceipt
} from "../../src/authoring";
import { hash, owner, ref } from "./fixtures";

const adoptedAt = "2026-11-07T12:00:00.000Z";
const adoptedAtLater = "2026-11-07T12:05:00.000Z";

function receipt(overrides: Partial<AdoptionReceipt> = {}): AdoptionReceipt {
  return {
    schemaVersion: 1,
    kind: "adoption-receipt",
    id: "adoption_00000001",
    owner: { ...owner },
    chapterId: "ch_00000001",
    candidate: ref("artifact", "artifact_00000001", 1),
    resultVersion: 1,
    resultHash: hash(9),
    grant: ref("grant", "grant_00000001", 1),
    direction: ref("direction", "direction_00000001", 1),
    sequence: 1,
    adoptedAt,
    ...overrides
  };
}

describe("adoption receipt validation", () => {
  test("well-formed receipt validates, is frozen and does not alias input", () => {
    const input = receipt();
    const validated = validateAdoptionReceipt(input);
    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(validated.candidate).not.toBe(input.candidate);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.candidate)).toBe(true);
    expect(Object.isFrozen(validated.owner)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    input.sequence = 99;
    expect(validated.sequence).toBe(1);
  });

  test("unknown version refuses without coercion", () => {
    expect(() => validateAdoptionReceipt({ ...receipt(), schemaVersion: 2 } as unknown as AdoptionReceipt))
      .toThrow("unsupported-version");
    expect(() => validateAdoptionReceipt({ ...receipt(), schemaVersion: 0 } as unknown as AdoptionReceipt))
      .toThrow("unsupported-version");
    expect(() => validateAdoptionReceipt({ ...receipt(), schemaVersion: "1" } as unknown as AdoptionReceipt))
      .toThrow();
  });

  test("unknown kind and malformed envelope refuse", () => {
    expect(() => validateAdoptionReceipt({ ...receipt(), kind: "effect" } as unknown as AdoptionReceipt)).toThrow();
    expect(() => validateAdoptionReceipt(null as unknown as AdoptionReceipt)).toThrow();
    expect(() => validateAdoptionReceipt([] as unknown as AdoptionReceipt)).toThrow();
    expect(() => validateAdoptionReceipt({ ...receipt(), id: "receipt_00000001" })).toThrow();
    expect(() => validateAdoptionReceipt({ ...receipt(), id: "../adoption_00000001" })).toThrow();
  });

  test("malformed candidate, grant and direction references refuse", () => {
    const foreignOwner = { ...owner, runId: "run_99999999" };
    expect(() => validateAdoptionReceipt(receipt({
      candidate: { ...ref("artifact", "artifact_00000001", 1), owner: foreignOwner }
    }))).toThrow("foreign-reference");
    expect(() => validateAdoptionReceipt(receipt({
      direction: { ...ref("direction", "direction_00000001", 1), owner: foreignOwner }
    }))).toThrow("foreign-reference");
    expect(() => validateAdoptionReceipt(receipt({
      grant: { ...ref("grant", "grant_00000001", 1), owner: { ...owner, bookId: "book_99999999" } }
    }))).toThrow("foreign-reference");
    // wrong kinds
    expect(() => validateAdoptionReceipt(receipt({
      candidate: ref("task", "artifact_00000001", 1) as unknown as AdoptionReceipt["candidate"]
    }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({
      direction: ref("artifact", "direction_00000001", 1) as unknown as AdoptionReceipt["direction"]
    }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({
      grant: ref("direction", "grant_00000001", 1) as unknown as AdoptionReceipt["grant"]
    }))).toThrow();
  });

  test("hash and version shapes refuse without coercion", () => {
    expect(() => validateAdoptionReceipt(receipt({
      candidate: { ...ref("artifact", "artifact_00000001", 1), hash: "ABC" }
    }))).toThrow("invalid-digest");
    expect(() => validateAdoptionReceipt(receipt({
      candidate: { ...ref("artifact", "artifact_00000001", 1), hash: "A".repeat(64) }
    }))).toThrow("invalid-digest");
    expect(() => validateAdoptionReceipt(receipt({ resultHash: "not-a-hash" }))).toThrow("invalid-digest");
    expect(() => validateAdoptionReceipt(receipt({ resultHash: "g".repeat(64) }))).toThrow("invalid-digest");
    expect(() => validateAdoptionReceipt(receipt({ resultVersion: 0 }))).toThrow("invalid-integer");
    expect(() => validateAdoptionReceipt(receipt({ resultVersion: 1.5 }))).toThrow("invalid-integer");
    expect(() => validateAdoptionReceipt(receipt({
      candidate: { ...ref("artifact", "artifact_00000001", 1), revision: 0 }
    }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({ chapterId: "../ch_00000001" }))).toThrow("invalid-id");
    expect(() => validateAdoptionReceipt(receipt({ chapterId: "" }))).toThrow();
  });

  test("caller-supplied ordering is bounded and never clock-derived", () => {
    expect(validateAdoptionReceipt(receipt({ sequence: 1 })).sequence).toBe(1);
    expect(validateAdoptionReceipt(receipt({ sequence: ADOPTION_RECEIPT_LIMITS.maxSequence })).sequence)
      .toBe(ADOPTION_RECEIPT_LIMITS.maxSequence);
    expect(() => validateAdoptionReceipt(receipt({ sequence: 0 }))).toThrow("invalid-integer");
    expect(() => validateAdoptionReceipt(receipt({ sequence: -1 }))).toThrow("invalid-integer");
    expect(() => validateAdoptionReceipt(receipt({ sequence: 1.5 }))).toThrow("invalid-integer");
    expect(() => validateAdoptionReceipt(receipt({ sequence: ADOPTION_RECEIPT_LIMITS.maxSequence + 1 })))
      .toThrow("invalid-integer");
    // adoptedAt must be exact millisecond UTC; malformed calendars refuse
    expect(() => validateAdoptionReceipt(receipt({ adoptedAt: "2026-11-07T12:00:00Z" }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({ adoptedAt: "2026-02-30T12:00:00.000Z" }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({ adoptedAt: "2026-13-01T12:00:00.000Z" }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({ adoptedAt: "not-a-date" }))).toThrow();
    expect(() => validateAdoptionReceipt(receipt({ adoptedAt: 123 as unknown as string }))).toThrow();
    expect(validateAdoptionReceipt(receipt({ adoptedAt: "2024-02-29T00:00:00.000Z" })).adoptedAt)
      .toBe("2024-02-29T00:00:00.000Z");
  });

  test("deep-frozen input is accepted without mutation", () => {
    const frozen = receipt();
    Object.freeze(frozen.candidate.owner);
    Object.freeze(frozen.candidate);
    Object.freeze(frozen.owner);
    Object.freeze(frozen.grant);
    Object.freeze(frozen.direction);
    Object.freeze(frozen);
    const validated = validateAdoptionReceipt(frozen);
    expect(validated.sequence).toBe(1);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});

describe("adoption counter", () => {
  function threeReceipts(): AdoptionReceipt[] {
    return [
      validateAdoptionReceipt(receipt()) as unknown as AdoptionReceipt,
      validateAdoptionReceipt(receipt({
        id: "adoption_00000002",
        chapterId: "ch_00000002",
        candidate: ref("artifact", "artifact_00000002", 1),
        resultVersion: 1,
        resultHash: hash(10),
        sequence: 2,
        adoptedAt: adoptedAtLater
      })) as unknown as AdoptionReceipt,
      validateAdoptionReceipt(receipt({
        id: "adoption_00000003",
        chapterId: "ch_00000001",
        candidate: ref("artifact", "artifact_00000003", 1),
        resultVersion: 2,
        resultHash: hash(11),
        sequence: 3,
        adoptedAt: "2026-11-07T12:10:00.000Z"
      })) as unknown as AdoptionReceipt
    ];
  }

  test("absent marker counts distinct chapters from the beginning and signals first adoption", () => {
    const receipts = threeReceipts();
    const before = JSON.stringify(receipts);
    const result = countAdoptedChapters(receipts, owner);
    // ch_00000001 adopted twice (seq 1 and 3) counts once; ch_00000002 once => 2 distinct
    expect(result.adoptedChaptersSinceCheckin).toBe(2);
    expect(result.firstAdoptedChapterOccurred).toBe(true);
    expect(JSON.stringify(receipts)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("sequence marker is exclusive: receipts at the marker are not recounted", () => {
    const receipts = threeReceipts();
    expect(countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 1 })
      .adoptedChaptersSinceCheckin).toBe(2);
    // seq 2 is ch_00000002, seq 3 is ch_00000001 again => both distinct => 2
    expect(countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 2 })
      .adoptedChaptersSinceCheckin).toBe(1);
    // only seq 3 remains, which is ch_00000001
    expect(countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 3 })
      .adoptedChaptersSinceCheckin).toBe(0);
    expect(countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 0 })
      .adoptedChaptersSinceCheckin).toBe(2);
    // first-adopted signal is independent of the window
    expect(countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 3 })
      .firstAdoptedChapterOccurred).toBe(true);
  });

  test("adoptedAt marker is exclusive and uses exact timestamp ordering", () => {
    const receipts = threeReceipts();
    expect(countAdoptedChapters(receipts, owner, { kind: "adoptedAt", adoptedAt })
      .adoptedChaptersSinceCheckin).toBe(2);
    expect(countAdoptedChapters(receipts, owner, { kind: "adoptedAt", adoptedAt: adoptedAtLater })
      .adoptedChaptersSinceCheckin).toBe(1);
    expect(countAdoptedChapters(receipts, owner, { kind: "adoptedAt", adoptedAt: "2026-11-07T12:10:00.000Z" })
      .adoptedChaptersSinceCheckin).toBe(0);
  });

  test("re-adoption of the same chapter counts once per marker window", () => {
    const receipts = threeReceipts();
    // window after seq 1 contains ch_00000002 and ch_00000001 (re-adopted) => 2 distinct, not 2 receipts for ch1
    const window = countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 1 });
    expect(window.adoptedChaptersSinceCheckin).toBe(2);
    // a chapter adopted twice inside one window still counts once
    const sameChapterTwice = [
      receipts[0] as AdoptionReceipt,
      receipts[2] as AdoptionReceipt
    ];
    expect(countAdoptedChapters(sameChapterTwice, owner).adoptedChaptersSinceCheckin).toBe(1);
  });

  test("no adoptions yields zero and no first-adopted signal", () => {
    const result = countAdoptedChapters([], owner);
    expect(result.adoptedChaptersSinceCheckin).toBe(0);
    expect(result.firstAdoptedChapterOccurred).toBe(false);
    expect(countAdoptedChapters([], owner, { kind: "sequence", sequence: 5 }).firstAdoptedChapterOccurred)
      .toBe(false);
  });

  test("foreign book or run receipts refuse", () => {
    const foreign = validateAdoptionReceipt(receipt({
      id: "adoption_00000009",
      owner: { ...owner, bookId: "book_99999999" },
      candidate: { ...ref("artifact", "artifact_00000009", 1), owner: { ...owner, bookId: "book_99999999" } },
      grant: { ...ref("grant", "grant_00000009", 1), owner: { ...owner, bookId: "book_99999999" } },
      direction: { ...ref("direction", "direction_00000009", 1), owner: { ...owner, bookId: "book_99999999" } }
    })) as unknown as AdoptionReceipt;
    expect(() => countAdoptedChapters([foreign], owner)).toThrow();
    expect(() => countAdoptedChapters(threeReceipts(), { ...owner, runId: "run_99999999" })).toThrow();
  });

  test("malformed markers and receipt sets refuse", () => {
    const receipts = threeReceipts();
    expect(() => countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: -1 })).toThrow();
    expect(() => countAdoptedChapters(receipts, owner, { kind: "sequence", sequence: 1.5 })).toThrow();
    expect(() => countAdoptedChapters(receipts, owner, { kind: "adoptedAt", adoptedAt: "bad" })).toThrow();
    expect(() => countAdoptedChapters(receipts, owner, { kind: "bogus" } as never)).toThrow();
    expect(() => countAdoptedChapters(null as unknown as AdoptionReceipt[], owner)).toThrow();
  });
});
