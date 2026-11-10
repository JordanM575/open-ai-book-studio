import { describe, expect, test } from "bun:test";
import { checkVersionedAnswer } from "../../src/authoring";
import { owner } from "./fixtures";

const at = "2026-11-07T00:00:00.000Z";
const hash = (n = 1) => n.toString(16).padStart(64, "0");
const absentBase = { kind: "absent" as const, revision: 0 as const };

function questionReference(id = "question_1", revision = 1) {
  return { kind: "question" as const, owner: { ...owner }, id, revision, hash: hash(revision) };
}

function directionReference(id = "direction_2", revision = 1, digest = revision + 3) {
  return {
    kind: "direction" as const,
    owner: { ...owner },
    id,
    revision,
    hash: hash(digest),
  };
}

function openQuestion(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "question",
    owner: { ...owner },
    id: "question_1",
    revision: 1,
    base: absentBase,
    generation: 1,
    keys: ["mara"],
    affected: ["task_1"],
    characterId: null,
    evidence: [],
    options: [],
    state: "open",
    answer: null,
    prompt: "Does Mara leave?",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function answerDirection(confirmed = "Protective lie", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "direction",
    owner: { ...owner },
    id: "direction_2",
    revision: 1,
    exactText: confirmed,
    origin: "answer",
    previous: null,
    question: questionReference(),
    createdAt: at,
    ...overrides,
  };
}

function proposed(overrides: Record<string, unknown> = {}) {
  return {
    exactText: "  protective lie\n",
    confirmedText: "Protective lie",
    direction: directionReference(),
    ...overrides,
  };
}

function check(
  question: unknown = openQuestion(),
  namedRevision: unknown = 1,
  answer: unknown = proposed(),
  direction: unknown = answerDirection(),
) {
  return checkVersionedAnswer(question, namedRevision, answer, direction, owner);
}

describe("checkVersionedAnswer", () => {
  test("copies exact and confirmed text separately and does not store an answer", () => {
    const question = openQuestion();
    const direction = answerDirection();
    const answer = proposed({ answeredAt: at, note: "secret prose" });
    const checked = checkVersionedAnswer(question, 1, answer, direction, owner);
    expect(checked).toEqual({
      questionId: "question_1",
      revision: 1,
      exactText: "  protective lie\n",
      confirmedText: "Protective lie",
      directionId: "direction_2",
      directionRevision: 1,
    });
    expect(Object.keys(checked).sort()).toEqual([
      "confirmedText",
      "directionId",
      "directionRevision",
      "exactText",
      "questionId",
      "revision",
    ]);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(Object.isFrozen(question)).toBe(false);
    expect(Object.isFrozen(direction)).toBe(false);
    expect(Object.isFrozen(answer)).toBe(false);
    expect(question.answer).toBeNull();
    expect(question.state).toBe("open");
    const serialized = JSON.stringify(checked);
    expect(serialized).not.toContain("answeredAt");
    expect(serialized).not.toContain("secret prose");
    expect(serialized).not.toContain("Does Mara");
    expect(check(
      openQuestion(),
      1,
      proposed({ exactText: "Protective lie", confirmedText: "Protective lie" }),
      answerDirection(),
    ).exactText).toBe("Protective lie");
    expect(check(
      openQuestion(),
      1,
      proposed({ direction: directionReference("direction_2", 1, 99) }),
      answerDirection(),
    ).directionId).toBe("direction_2");
  });

  test("accepts a later direction epoch and a later open question revision", () => {
    const question = openQuestion({
      revision: 2,
      base: { kind: "sha256", value: hash(), revision: 1 },
    });
    const direction = answerDirection("Protective lie", {
      revision: 2,
      previous: directionReference("direction_1", 1),
      question: questionReference("question_1", 2),
    });
    const checked = check(
      question,
      2,
      proposed({ direction: directionReference("direction_2", 2) }),
      direction,
    );
    expect(checked.revision).toBe(2);
    expect(checked.directionRevision).toBe(2);
    expect(question.revision).toBe(2);
    expect(question.answer).toBeNull();
  });

  test("unwraps a question snapshot and keeps a question's own id", () => {
    const question = openQuestion();
    const checked = check({ record: question, bytes: new Uint8Array([1]) });
    expect(checked.questionId).toBe("question_1");
    expect(Object.isFrozen(question)).toBe(false);

    const nested = openQuestion({ record: { id: "question_9", state: "answered" } });
    expect(check(nested).questionId).toBe("question_1");
  });

  test("refuses a question that is not open and a revision that is not current", () => {
    for (const state of ["answered", "superseded", "withdrawn"]) {
      expect(() => check(openQuestion({ state }))).toThrow("stale-question");
    }
    expect(() => check(openQuestion(), 0)).toThrow("stale-question");
    expect(() => check(openQuestion(), 2)).toThrow("stale-question");
    expect(() => check(openQuestion({ revision: 0 }))).toThrow("invalid-integer");
    expect(() => check(openQuestion(), 1.5)).toThrow("invalid-integer");
    expect(() => check(openQuestion(), -1)).toThrow("invalid-integer");
    expect(() => check(openQuestion({ state: "closed" }))).toThrow("unknown-question-state");
    const missing = openQuestion();
    delete (missing as { state?: string }).state;
    expect(() => check(missing)).toThrow("invalid-question-state");
  });

  test("treats silence and a missing answer as no answer", () => {
    expect(() => check(openQuestion(), 1, null)).toThrow("invalid-answer");
    expect(() => checkVersionedAnswer(openQuestion(), 1, undefined, answerDirection(), owner))
      .toThrow("invalid-answer");
    expect(() => check(openQuestion(), 1, { confirmedText: "Protective lie", direction: directionReference() }))
      .toThrow("invalid-answer");
    expect(() => check(openQuestion(), 1, "Protective lie")).toThrow("invalid-answer");
  });

  test("requires an answer-origin epoch whose text is the confirmed text", () => {
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("  protective lie\n"),
    )).toThrow("direction-text-mismatch");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", { origin: "author", question: null }),
    )).toThrow("invalid-question-link");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", { question: questionReference("question_9") }),
    )).toThrow("invalid-question-link");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", { question: questionReference("question_1", 2) }),
    )).toThrow("invalid-question-link");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", { revision: 2 }),
    )).toThrow("stale-direction-link");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", {
        revision: 2,
        previous: directionReference("direction_1", 2),
      }),
    )).toThrow("stale-direction-link");
    expect(() => check(
      openQuestion(),
      1,
      proposed(),
      answerDirection("Protective lie", {
        revision: 2,
        previous: directionReference("direction_2", 1),
      }),
    )).toThrow("duplicate-direction");
    expect(() => check(
      openQuestion(),
      1,
      proposed({ direction: directionReference("direction_9") }),
      answerDirection(),
    )).toThrow("stale-direction");
    expect(() => check(
      openQuestion(),
      1,
      proposed({ direction: directionReference("direction_2", 2) }),
      answerDirection(),
    )).toThrow("stale-direction");
    expect(() => check(
      openQuestion(),
      1,
      proposed({ direction: { ...directionReference(), hash: "not-a-digest" } }),
      answerDirection(),
    )).toThrow("invalid-digest");
  });

  test("refuses a foreign question before checking the answer", () => {
    expect(() => check(openQuestion({ kind: "direction" }))).toThrow("foreign-kind");
    expect(() => check(openQuestion({
      owner: { ...owner, runId: "run_2" },
      state: "answered",
    }))).toThrow("foreign-owner");
    expect(() => checkVersionedAnswer(openQuestion(), 1, null, answerDirection(), {
      ...owner,
      bookId: "book_2",
    })).toThrow("foreign-owner");
  });
});
