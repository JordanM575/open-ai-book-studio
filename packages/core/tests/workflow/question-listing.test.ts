import { describe, expect, test } from "bun:test";
import { readIrreversibleChoicePending } from "../../src/authoring/wire";
import { LibraryPortError } from "../../src/library/errors";
import { childLibraryPath } from "../../src/library/path";
import type { LibraryInspectedEntry, LibraryPath, LibraryPort } from "../../src/library/port";
import { WorkflowRecordError } from "../../src/workflow/record-error";
import { questionPath, questionsPath } from "../../src/workflow/paths";
import { QUESTION_LIST_LIMITS } from "../../src/workflow/record-store";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { at, makeBook, ownerFor, questionRecord, reference, runId } from "./record-fixtures";

const encoder = new TextEncoder();

async function refusal(run: Promise<unknown>): Promise<WorkflowRecordError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WorkflowRecordError) return error;
    throw error;
  }
  throw new Error("Expected a WorkflowRecordError refusal");
}

function watchWrites(port: InMemoryLibraryPort): () => number {
  let writes = 0;
  const bump = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      writes += 1;
      return fn(...args);
    }) as T;
  port.commitFile = bump(port.commitFile.bind(port));
  port.createImmutableFile = bump(port.createImmutableFile.bind(port));
  port.ensureDirectory = bump(port.ensureDirectory.bind(port));
  port.moveFile = bump(port.moveFile.bind(port));
  port.moveDirectory = bump(port.moveDirectory.bind(port));
  port.removeFile = bump(port.removeFile.bind(port));
  port.removeDirectory = bump(port.removeDirectory.bind(port));
  return () => writes;
}

function countQuestionReads(port: InMemoryLibraryPort): () => number {
  let reads = 0;
  const original = port.readFile.bind(port);
  port.readFile = async (path: LibraryPath, options?: { maxBytes: number }) => {
    if (path.join("/").includes("/questions/")) reads += 1;
    return original(path, options);
  };
  return () => reads;
}

async function hashOf(port: LibraryPort, path: LibraryPath): Promise<string | null> {
  return (await port.readFile(path))?.sha256 ?? null;
}

describe("question listing", () => {
  test("a missing or empty questions folder is an empty page and writes nothing", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    const writes = watchWrites(port);

    const missing = await records.listQuestions(book.id, runId);
    expect(missing).toEqual({
      bookId: book.id,
      runId,
      offset: 0,
      limit: QUESTION_LIST_LIMITS.maxListPage,
      total: 0,
      questions: []
    });

    await port.ensureDirectory(questionsPath(book.id, runId));
    const created = writes();
    const empty = await records.listQuestions(book.id, runId, { offset: 0, limit: 256 });
    expect(empty.total).toBe(0);
    expect(empty.questions).toEqual([]);
    expect(writes()).toBe(created);
    expect(await port.listDirectory(questionsPath(book.id, runId))).toEqual([]);
  });

  test("pages a full scan of store snapshots the pending reader can count", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    const owner = ownerFor(book.id);
    const direction = reference("direction", owner, "direction_00000001");
    const saved = [
      questionRecord(book.id, { id: "question_00000006", state: "withdrawn", irreversibleChoice: true }),
      questionRecord(book.id, { id: "question_00000004", state: "answered", irreversibleChoice: true, answer: {
        exactText: "Keep her alive.",
        confirmedText: "Keep her alive.",
        direction,
        answeredAt: at
      } }),
      questionRecord(book.id, { id: "question_00000001", irreversibleChoice: true }),
      questionRecord(book.id, { id: "question_00000003" }),
      questionRecord(book.id, { id: "question_00000005", state: "superseded", irreversibleChoice: true }),
      questionRecord(book.id, { id: "question_00000002", irreversibleChoice: false })
    ];
    for (const value of saved) await records.saveQuestion(book.id, runId, value);
    const before = await Promise.all(saved.map((value) => hashOf(port, questionPath(book.id, runId, String(value.id)))));
    const writes = watchWrites(port);

    const page = await records.listQuestions(book.id, runId, { offset: 0, limit: 2 });
    expect(page.total).toBe(6);
    expect(page.questions.map((snapshot) => snapshot.record.id)).toEqual([
      "question_00000001",
      "question_00000002"
    ]);
    const later = await records.listQuestions(book.id, runId, { offset: 4, limit: 2 });
    expect(later.total).toBe(6);
    expect(later.questions.map((snapshot) => snapshot.record.id)).toEqual([
      "question_00000005",
      "question_00000006"
    ]);

    const listing = await records.listQuestions(book.id, runId);
    for (const snapshot of listing.questions) {
      expect(Object.hasOwn(snapshot, "kind")).toBe(false);
      expect(Object.hasOwn(snapshot, "state")).toBe(false);
      expect(snapshot.record.kind).toBe("question");
      expect(snapshot.bytes.byteLength).toBeGreaterThan(0);
      expect(snapshot.hash).toHaveLength(64);
    }
    const pending = readIrreversibleChoicePending(listing, owner);
    expect(pending.irreversibleChoicePending).toBe(true);
    expect(pending.openIrreversibleCount).toBe(1);
    expect(pending.openIrreversibleQuestionIds).toEqual(["question_00000001"]);
    expect(JSON.stringify(pending)).not.toContain("mara");
    expect(writes()).toBe(0);
    const after = await Promise.all(saved.map((value) => hashOf(port, questionPath(book.id, runId, String(value.id)))));
    expect(after).toEqual(before);
  });

  test("refuses a library that cannot inspect names", async () => {
    const { library, book, port } = await makeBook();
    Object.defineProperty(port, "inspectDirectory", { value: undefined, configurable: true });
    const error = await refusal(library.workflowRecords.listQuestions(book.id, runId));
    expect(error.code).toBe("unavailable");
    expect(error.message).toContain("Nothing was counted.");
  });

  test("a not-found inspection is empty and every other inspection error refuses", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    port.inspectDirectory = async () => {
      throw new LibraryPortError("not-found", "The questions folder is not there.");
    };
    const empty = await records.listQuestions(book.id, runId);
    expect(empty.total).toBe(0);
    expect(empty.questions).toEqual([]);

    port.inspectDirectory = async () => {
      throw new LibraryPortError("io", "The disk did not answer.");
    };
    expect((await refusal(records.listQuestions(book.id, runId))).code).toBe("io");

    port.inspectDirectory = async () => {
      throw new Error("unexpected adapter failure");
    };
    expect((await refusal(records.listQuestions(book.id, runId))).code).toBe("io");

    port.inspectDirectory = async () => {
      throw new WorkflowRecordError("corrupt", "This inspection refusal stays a corrupt refusal.");
    };
    const kept = await refusal(records.listQuestions(book.id, runId));
    expect(kept.code).toBe("corrupt");
    expect(kept.message).toBe("This inspection refusal stays a corrupt refusal.");
  });

  test("an unsupported name or a nested directory refuses the whole list untouched", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    const value = questionRecord(book.id, { irreversibleChoice: true });
    await records.saveQuestion(book.id, runId, value);
    const path = questionPath(book.id, runId, "question_00000001");
    const before = await hashOf(port, path);
    const writes = watchWrites(port);

    const original = port.inspectDirectory.bind(port);
    port.inspectDirectory = async (directory: LibraryPath) => {
      const entries = await original(directory);
      return [...entries, { name: "socket", kind: "unsupported" }];
    };
    expect((await refusal(records.listQuestions(book.id, runId, { limit: 1 }))).code).toBe("unavailable");
    expect(await hashOf(port, path)).toBe(before);

    port.inspectDirectory = original;
    await port.ensureDirectory(childLibraryPath(questionsPath(book.id, runId), "nested"));
    const nestedWrites = writes();
    expect((await refusal(records.listQuestions(book.id, runId, { limit: 1 }))).code).toBe("unavailable");
    expect(await hashOf(port, path)).toBe(before);
    expect(writes()).toBe(nestedWrites);
  });

  test("a file whose name is not a question id refuses before any page is returned", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    await records.saveQuestion(book.id, runId, questionRecord(book.id));
    const good = questionPath(book.id, runId, "question_00000001");
    const before = await hashOf(port, good);
    const names = ["notes.txt", "task_00000001.json", "question_bad id.json"];
    for (const name of names) {
      const path = childLibraryPath(questionsPath(book.id, runId), name);
      const seeded = await port.commitFile(path, encoder.encode("{}"), { kind: "absent" });
      expect(seeded.status).toBe("written");
      const error = await refusal(records.listQuestions(book.id, runId, { offset: 0, limit: 1 }));
      expect(error.code).toBe("corrupt");
      expect(await hashOf(port, good)).toBe(before);
      expect(await hashOf(port, path)).toBe(seeded.status === "written" ? seeded.snapshot.sha256 : null);
      await port.removeFile(path);
    }
  });

  test("the run cap refuses before any question file is loaded", async () => {
    const { library, book, port } = await makeBook();
    await library.workflowRecords.saveQuestion(book.id, runId, questionRecord(book.id));
    const questionReads = countQuestionReads(port);
    const names = (count: number): LibraryInspectedEntry[] =>
      Array.from({ length: count }, (_value, index) => ({
        name: `question_${String(index + 1).padStart(8, "0")}.json`,
        kind: "file" as const
      }));

    port.inspectDirectory = async () => names(QUESTION_LIST_LIMITS.maxQuestionsPerRun + 1);
    const capped = await refusal(library.workflowRecords.listQuestions(book.id, runId, { limit: 1 }));
    expect(capped.code).toBe("too-large");
    expect(questionReads()).toBe(0);

    port.inspectDirectory = async () => names(QUESTION_LIST_LIMITS.maxQuestionsPerRun);
    const boundary = await refusal(library.workflowRecords.listQuestions(book.id, runId, { limit: 1 }));
    expect(boundary.code).toBe("corrupt");
    expect(questionReads()).toBe(1);
  });

  test("a later unreadable question refuses the page even when the first page would have been valid", async () => {
    const { library, book, port } = await makeBook();
    const records = library.workflowRecords;
    await records.saveQuestion(book.id, runId, questionRecord(book.id, { irreversibleChoice: true }));
    const good = questionPath(book.id, runId, "question_00000001");
    const bad = questionPath(book.id, runId, "question_00000002");
    const before = await hashOf(port, good);
    const seeded = await port.commitFile(bad, encoder.encode("{"), { kind: "absent" });
    expect(seeded.status).toBe("written");
    const writes = watchWrites(port);
    const questionReads = countQuestionReads(port);

    const error = await refusal(records.listQuestions(book.id, runId, { offset: 0, limit: 1 }));
    expect(error.code).toBe("corrupt");
    expect(questionReads()).toBe(2);
    expect(writes()).toBe(0);
    expect(await hashOf(port, good)).toBe(before);
    expect(await hashOf(port, bad)).toBe(seeded.status === "written" ? seeded.snapshot.sha256 : null);
  });

  test("a question named by the inspection and missing at load refuses without writing", async () => {
    const { library, book, port } = await makeBook();
    const writes = watchWrites(port);
    port.inspectDirectory = async () => [{ name: "question_00000009.json", kind: "file" }];
    const error = await refusal(library.workflowRecords.listQuestions(book.id, runId));
    expect(error.code).toBe("corrupt");
    expect(error.message).toContain("left untouched");
    expect(writes()).toBe(0);
    expect(await port.readFile(questionPath(book.id, runId, "question_00000009"))).toBeNull();
  });

  test("an invalid page is refused before the folder is inspected", async () => {
    const { library, book, port } = await makeBook();
    let inspections = 0;
    const original = port.inspectDirectory.bind(port);
    port.inspectDirectory = async (path: LibraryPath) => {
      inspections += 1;
      return original(path);
    };
    expect((await refusal(library.workflowRecords.listQuestions(book.id, runId, { limit: 0 }))).code).toBe("invalid");
    expect((await refusal(library.workflowRecords.listQuestions(book.id, runId, { limit: 257 }))).code).toBe("invalid");
    expect((await refusal(library.workflowRecords.listQuestions(book.id, runId, { offset: -1 }))).code).toBe("invalid");
    expect((await refusal(library.workflowRecords.listQuestions(book.id, runId, { offset: 1.5 }))).code).toBe("invalid");
    expect(inspections).toBe(0);
  });
});
