import { describe, expect, test } from "bun:test";
import {
  createRun,
  decodeWorkflowRecord,
  encodeWorkflowRecord,
  readIrreversibleChoicePending,
  reduceRun,
  type Graph,
  type Owner,
  type WorkflowRecord,
  type WorkflowReference,
} from "../../src/authoring";
import { hash, owner, ref, step } from "./fixtures";

const at = "2026-11-07T00:00:00.000Z";
const base = { kind: "absent" as const, revision: 0 as const };

function wref<K extends string>(kind: K, id: string, revision = 1) {
  return {
    kind,
    owner: { ...owner },
    id,
    revision,
    hash: hash(revision + 1),
  } as unknown as WorkflowReference;
}

function questionRecord(overrides: Record<string, unknown> = {}): WorkflowRecord {
  return {
    schemaVersion: 1,
    kind: "question",
    owner: { ...owner },
    id: "question_00000001",
    revision: 1,
    base,
    generation: 1,
    keys: ["mara"],
    affected: ["task_00000001"],
    characterId: null,
    evidence: [],
    options: [{ id: "option_1", label: "Leave", consequence: "The town forgets." }],
    state: "open",
    answer: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  } as unknown as WorkflowRecord;
}

function bytesOf(record: WorkflowRecord): Uint8Array {
  return encodeWorkflowRecord(record);
}
function decode(bytes: Uint8Array): WorkflowRecord {
  return decodeWorkflowRecord(bytes, { kind: "question", owner }) as unknown as WorkflowRecord;
}

describe("irreversible classification — wire extension", () => {
  test("pre-extension record without the marker remains valid and reads as unclassified", () => {
    const legacy = questionRecord();
    expect(Object.hasOwn(legacy, "irreversibleChoice")).toBe(false);
    const decoded = decode(bytesOf(legacy));
    expect(decoded).toEqual(legacy);
    expect((decoded as Record<string, unknown>).irreversibleChoice).toBeUndefined();
    // Absence is not a positive claim: the pending reader counts nothing.
    const pending = readIrreversibleChoicePending([decoded as never], owner);
    expect(pending.irreversibleChoicePending).toBe(false);
    expect(pending.openIrreversibleCount).toBe(0);
    expect(pending.openIrreversibleQuestionIds).toEqual([]);
  });

  test("explicit true and false classifications round-trip through the wire", () => {
    for (const value of [true, false]) {
      const record = questionRecord({ irreversibleChoice: value });
      const decoded = decode(bytesOf(record));
      expect((decoded as Record<string, unknown>).irreversibleChoice).toBe(value);
      expect([...encodeWorkflowRecord(decoded)]).toEqual([...bytesOf(record)]);
      expect(Object.isFrozen(decoded)).toBe(true);
    }
  });

  test("malformed classification refuses without coercion", () => {
    for (const bad of ["true", "irreversible", 1, 0, null, {}, [], "yes"]) {
      const record = questionRecord({ irreversibleChoice: bad });
      expect(() => encodeWorkflowRecord(record)).toThrow("invalid-irreversible-choice");
      const raw = new TextEncoder().encode(JSON.stringify(record));
      expect(() => decodeWorkflowRecord(raw, { kind: "question", owner })).toThrow(
        "invalid-irreversible-choice"
      );
    }
  });

  test("irreversibility is never inferred from consequences, keys, character or option wording", () => {
    // A question whose prose *sounds* irreversible but carries no explicit
    // marker must not count. Free text, character identity and impact keys
    // are not classification.
    const suggestive = questionRecord({
      characterId: "mara",
      keys: ["mara", "ending"],
      options: [
        {
          id: "option_1",
          label: "Kill Mara forever — irreversible ending",
          consequence: "This irreversible choice ends the book permanently.",
        },
      ],
    });
    const decoded = decode(bytesOf(suggestive));
    const pending = readIrreversibleChoicePending([decoded as never], owner);
    expect(pending.irreversibleChoicePending).toBe(false);
    expect(pending.openIrreversibleCount).toBe(0);
  });

  test("unknown schema versions still refuse", () => {
    const future = questionRecord({ schemaVersion: 2, irreversibleChoice: true });
    expect(() => encodeWorkflowRecord(future)).toThrow("unsupported-schema");
  });
});

describe("irreversible classification — in-memory graph agreement", () => {
  function graphInput(): Graph {
    return {
      version: 1,
      owner: { ...owner },
      policyDigest: hash(),
      generation: 1,
      direction: ref("direction", "direction_0"),
      tasks: [
        {
          ref: ref("task", "a"),
          role: "drafter",
          completion: "candidate",
          dependsOn: [],
          impact: { complete: true, keys: ["mara"] },
        },
      ],
    };
  }

  test("a question action may carry the explicit classification; absence means unclassified", () => {
    let state = createRun(graphInput());
    state = step(state, {
      type: "question",
      questionId: "q_classified",
      keys: ["mara"],
      irreversibleChoice: true,
    } as never);
    expect(state.questions[0]?.irreversibleChoice).toBe(true);

    let plain = createRun(graphInput());
    plain = step(plain, { type: "question", questionId: "q_plain", keys: ["mara"] });
    expect(plain.questions[0]?.irreversibleChoice).toBe(false);
  });

  test("malformed in-memory classification refuses", () => {
    const state = createRun(graphInput());
    expect(() =>
      step(state, {
        type: "question",
        questionId: "q_bad",
        keys: ["mara"],
        irreversibleChoice: "yes",
      } as never)
    ).toThrow("invalid-irreversible-choice");
  });

  test("classification does not change blockedByQuestion semantics", async () => {
    const { taskStatuses } = await import("../../src/authoring");
    let classified = createRun(graphInput());
    classified = step(classified, {
      type: "question",
      questionId: "q1",
      keys: ["mara"],
      irreversibleChoice: true,
    } as never);
    let plain = createRun(graphInput());
    plain = step(plain, { type: "question", questionId: "q1", keys: ["mara"] });
    // Both open questions block the affected task identically.
    expect(taskStatuses(classified).a).toBe("blocked");
    expect(taskStatuses(plain).a).toBe("blocked");
  });
});

describe("pure pending reader — irreversibleChoicePending", () => {
  function decoded(overrides: Record<string, unknown> = {}): WorkflowRecord {
    return decode(bytesOf(questionRecord(overrides)));
  }

  test("open + explicitly classified is pending", () => {
    const pending = readIrreversibleChoicePending(
      [decoded({ irreversibleChoice: true }) as never],
      owner
    );
    expect(pending.irreversibleChoicePending).toBe(true);
    expect(pending.openIrreversibleCount).toBe(1);
    expect(pending.openIrreversibleQuestionIds).toEqual(["question_00000001"]);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.openIrreversibleQuestionIds)).toBe(true);
  });

  test("open + unclassified (absent or explicit false) is not pending", () => {
    expect(
      readIrreversibleChoicePending([decoded() as never], owner).irreversibleChoicePending
    ).toBe(false);
    expect(
      readIrreversibleChoicePending([decoded({ irreversibleChoice: false }) as never], owner)
        .irreversibleChoicePending
    ).toBe(false);
  });

  test("answered, superseded and withdrawn classified questions never count", () => {
    const direction = wref("direction", "direction_00000001", 1);
    const answered = decoded({
      irreversibleChoice: true,
      state: "answered",
      answer: {
        exactText: "Keep her alive.",
        confirmedText: "Keep her alive.",
        direction,
        answeredAt: at,
      },
    });
    const superseded = decoded({
      id: "question_00000002",
      irreversibleChoice: true,
      state: "superseded",
    });
    const withdrawn = decoded({
      id: "question_00000003",
      irreversibleChoice: true,
      state: "withdrawn",
    });
    for (const record of [answered, superseded, withdrawn]) {
      const pending = readIrreversibleChoicePending([record as never], owner);
      expect(pending.irreversibleChoicePending).toBe(false);
      expect(pending.openIrreversibleCount).toBe(0);
    }
  });

  test("multiple questions: any open classified match counts, with sorted evidence ids", () => {
    const records = [
      decoded({ id: "question_00000003", irreversibleChoice: true }),
      decoded({ id: "question_00000001" }),
      decoded({ id: "question_00000002", irreversibleChoice: true }),
      decoded({ id: "question_00000004", irreversibleChoice: true, state: "withdrawn" }),
    ];
    const pending = readIrreversibleChoicePending(records as never, owner);
    expect(pending.irreversibleChoicePending).toBe(true);
    expect(pending.openIrreversibleCount).toBe(2);
    expect(pending.openIrreversibleQuestionIds).toEqual([
      "question_00000002",
      "question_00000003",
    ]);
  });

  test("evidence exposes only ids and counts — no question prose", () => {
    const record = decoded({ irreversibleChoice: true });
    const pending = readIrreversibleChoicePending([record as never], owner);
    const serialized = JSON.stringify(pending);
    expect(serialized).not.toContain("Leave");
    expect(serialized).not.toContain("town forgets");
    expect(serialized).not.toContain("mara");
    expect(Object.keys(pending).sort()).toEqual([
      "irreversibleChoicePending",
      "openIrreversibleCount",
      "openIrreversibleQuestionIds",
    ]);
  });

  test("silence is not an answer: an open question with no answer record stays pending", () => {
    // No dismissal/silence field exists; only the recorded state decides.
    // An open classified question whose answer is null is still pending.
    const record = decoded({ irreversibleChoice: true, state: "open", answer: null });
    const pending = readIrreversibleChoicePending([record as never], owner);
    expect(pending.irreversibleChoicePending).toBe(true);
    // The wire itself refuses to relabel silence as an answer.
    expect(() =>
      encodeWorkflowRecord(questionRecord({ state: "answered", answer: null }))
    ).toThrow("invalid-question-state");
    expect(() =>
      encodeWorkflowRecord(
        questionRecord({
          state: "open",
          answer: {
            exactText: "x",
            confirmedText: "x",
            direction: wref("direction", "direction_00000001", 1),
            answeredAt: at,
          },
        })
      )
    ).toThrow("invalid-question-state");
  });

  test("foreign, wrong-kind, unknown-state, duplicate and malformed inputs refuse", () => {
    const foreignOwner: Owner = { ...owner, runId: "run_99999999" };
    const foreign = questionRecord({
      owner: foreignOwner,
      irreversibleChoice: true,
    });
    const foreignBytes = new TextEncoder().encode(JSON.stringify(foreign));
    // Wire decode against the expected owner already refuses foreign records;
    // the reader must also refuse a decoded foreign record handed to it.
    expect(() => decodeWorkflowRecord(foreignBytes, { kind: "question", owner })).toThrow(
      "foreign-owner"
    );
    expect(() =>
      readIrreversibleChoicePending(
        [{ id: "question_00000001", state: "open", irreversibleChoice: true, owner: foreignOwner } as never],
        owner
      )
    ).toThrow("foreign-owner");
    expect(() =>
      readIrreversibleChoicePending(
        [{ id: "question_00000001", state: "open", irreversibleChoice: true, kind: "effect" } as never],
        owner
      )
    ).toThrow("foreign-kind");
    expect(() =>
      readIrreversibleChoicePending(
        [{ id: "question_00000001", state: "future-state", irreversibleChoice: true } as never],
        owner
      )
    ).toThrow("unknown-question-state");
    expect(() =>
      readIrreversibleChoicePending(
        [{ id: "question_00000001", state: "open", irreversibleChoice: "yes" } as never],
        owner
      )
    ).toThrow("invalid-irreversible-choice");
    const one = decoded({ irreversibleChoice: true });
    expect(() => readIrreversibleChoicePending([one as never, one as never], owner)).toThrow(
      "duplicate-question"
    );
    expect(() => readIrreversibleChoicePending(null as never, owner)).toThrow();
    expect(() => readIrreversibleChoicePending([one as never], { ...owner, bookId: "bad id!" })).toThrow();
  });

  test("accepts a listing-shaped result and snapshot wrappers without prose leakage", () => {
    const record = decoded({ irreversibleChoice: true });
    const snapshot = { record, bytes: new Uint8Array(), hash: hash(1) };
    const fromSnapshots = readIrreversibleChoicePending([snapshot as never], owner);
    expect(fromSnapshots.irreversibleChoicePending).toBe(true);
    const listing = { bookId: owner.bookId, runId: owner.runId, offset: 0, limit: 256, total: 1, questions: [snapshot] };
    const fromListing = readIrreversibleChoicePending(listing as never, owner);
    expect(fromListing).toEqual(fromSnapshots);
  });

  test("a question's own classification wins over a nested record extension", () => {
    const record = questionRecord({
      irreversibleChoice: false,
      record: { id: "question_00000002", state: "open", irreversibleChoice: true },
    });
    const decodedRecord = decode(bytesOf(record));
    expect((decodedRecord as Record<string, unknown>).irreversibleChoice).toBe(false);
    const pending = readIrreversibleChoicePending([decodedRecord as never], owner);
    expect(pending.irreversibleChoicePending).toBe(false);
    expect(pending.openIrreversibleCount).toBe(0);
    expect(pending.openIrreversibleQuestionIds).toEqual([]);
  });

  test("deep-frozen inputs are not mutated and empty input is not pending", () => {
    const record = decoded({ irreversibleChoice: true });
    const frozenRecord = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    const freezeDeep = (v: unknown): void => {
      if (v !== null && typeof v === "object") {
        for (const child of Object.values(v)) freezeDeep(child);
        Object.freeze(v);
      }
    };
    freezeDeep(frozenRecord);
    const before = JSON.stringify(frozenRecord);
    const input = Object.freeze([frozenRecord]);
    const pending = readIrreversibleChoicePending(input as never, owner);
    expect(pending.irreversibleChoicePending).toBe(true);
    expect(JSON.stringify(frozenRecord)).toBe(before);
    expect(Object.isFrozen(frozenRecord)).toBe(true);

    expect(readIrreversibleChoicePending([], owner)).toEqual({
      irreversibleChoicePending: false,
      openIrreversibleCount: 0,
      openIrreversibleQuestionIds: [],
    });
  });

  test("in-memory graph questions feed the reader by id/state/classification", () => {
    let state = createRun({
      version: 1,
      owner: { ...owner },
      policyDigest: hash(),
      generation: 1,
      direction: ref("direction", "direction_0"),
      tasks: [
        {
          ref: ref("task", "a"),
          role: "drafter",
          completion: "candidate",
          dependsOn: [],
          impact: { complete: true, keys: ["mara"] },
        },
      ],
    });
    state = step(state, {
      type: "question",
      questionId: "q_graph",
      keys: ["mara"],
      irreversibleChoice: true,
    } as never);
    const question = state.questions[0];
    if (!question) throw new Error("fixture question missing");
    const pending = readIrreversibleChoicePending(
      [{ id: question.id, state: question.state, irreversibleChoice: question.irreversibleChoice } as never],
      owner
    );
    expect(pending.irreversibleChoicePending).toBe(true);
    expect(pending.openIrreversibleQuestionIds).toEqual(["q_graph"]);
    // Silence in the graph: the same question with no answer stays open.
    expect(question.state).toBe("open");
    expect(question.answer).toBeNull();
    void reduceRun;
  });
});
