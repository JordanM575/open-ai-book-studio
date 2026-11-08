import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { encodeWorkflowRecord, type WorkflowRecord } from "../../src/authoring/wire";
import type { CommitFileResult, FileExpectation, LibraryPath, LibraryPort } from "../../src/library/port";
import { readSyncJournal } from "../../src/sync/journal";
import { WorkflowRecordError } from "../../src/workflow/record-error";
import {
  artifactBodyPath,
  artifactMetaPath,
  contextPath,
  runHeaderPath,
  taskPath,
  workflowConflictPath,
  workflowConflictsPath
} from "../../src/workflow/paths";
import { WorkflowRecordStore } from "../../src/workflow/record-store";
import {
  artifactMetadata,
  at,
  attemptRecord,
  clockAt,
  contextRecord,
  effectRecord,
  makeBook,
  questionRecord,
  runId,
  runRecord,
  sha256Hex,
  taskRecord
} from "./record-fixtures";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface TestLibrary {
  port: LibraryPort & { sha256(bytes: Uint8Array): Promise<string> };
  library: Awaited<ReturnType<typeof makeBook>>["library"];
  book: { id: string };
  clock: { value: string };
}

function key(path: LibraryPath): string {
  return path.join("/");
}

async function readText(port: LibraryPort, path: LibraryPath): Promise<string> {
  const snapshot = await port.readFile(path);
  if (!snapshot) throw new Error(`Missing synthetic fixture file ${key(path)}`);
  return decoder.decode(snapshot.bytes);
}

async function seed(port: LibraryPort, path: LibraryPath, value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const result = await port.commitFile(path, bytes, { kind: "absent" });
  if (result.status !== "written") throw new Error(`Could not seed ${key(path)}`);
  return result.snapshot;
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

async function conflictNames(port: LibraryPort, bookId: string): Promise<string[]> {
  return (await port.listDirectory(workflowConflictsPath(bookId, runId)))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name);
}

function revisionTwo(record: Record<string, unknown>, baseHash: string, id = "task_00000001") {
  return {
    ...record,
    id,
    revision: 2,
    base: { kind: "sha256", value: baseHash, revision: 1 },
    updatedAt: "2026-11-07T12:05:00.000Z"
  };
}

describe("checked workflow record store", () => {
  test("saves and reads every T023 record kind through the Library queue and journal", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const records = library.workflowRecords;
    expect(records).toBeInstanceOf(WorkflowRecordStore);

    const run = await records.saveRun(book.id, runId, runRecord(book.id));
    expect(run.status).toBe("saved");
    expect(run.record.record.revision).toBe(1);

    const task = await records.saveTask(book.id, runId, taskRecord(book.id));
    expect(task.status).toBe("saved");

    const attempt = await records.saveAttempt(book.id, runId, attemptRecord(book.id));
    expect(attempt.status).toBe("saved");

    const effect = await records.saveEffect(book.id, runId, effectRecord(book.id));
    expect(effect.status).toBe("saved");

    const question = await records.saveQuestion(book.id, runId, questionRecord(book.id));
    expect(question.status).toBe("saved");

    expect((await records.readRun(book.id, runId))?.hash).toBe(run.record.hash);
    expect((await records.readTask(book.id, runId, "task_00000001"))?.hash).toBe(task.record.hash);
    expect((await records.readAttempt(book.id, runId, "attempt_00000001"))?.hash).toBe(attempt.record.hash);
    expect((await records.readEffect(book.id, runId, "effect_00000001"))?.hash).toBe(effect.record.hash);
    expect((await records.readQuestion(book.id, runId, "question_00000001"))?.hash).toBe(question.record.hash);

    const journal = await readSyncJournal(port, "device_fixture01");
    expect(journal?.files[key(runHeaderPath(book.id, runId))]?.sha256).toBe(run.record.hash);
    expect(journal?.files[key(taskPath(book.id, runId, "task_00000001"))]?.sha256).toBe(task.record.hash);

    // The active file is canonical: compact, sorted keys, no trailing newline.
    const stored = await readText(port, taskPath(book.id, runId, "task_00000001"));
    expect(stored.endsWith("\n")).toBe(false);
    expect(stored).toBe(JSON.stringify(JSON.parse(stored)));
    expect(stored.startsWith('{"base":')).toBe(true);
  });

  test("a stale base keeps the complete intended task as a conflict copy", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const first = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    const activeBefore = await readText(port, taskPath(book.id, runId, "task_00000001"));

    const stale = revisionTwo(taskRecord(book.id), "b".repeat(64));
    const error = await refusal(library.workflowRecords.saveTask(book.id, runId, stale));
    expect(error.code).toBe("conflict");
    expect(error.savedAs).toContain("/conflicts/");
    expect(await readText(port, taskPath(book.id, runId, "task_00000001"))).toBe(activeBefore);

    const names = await conflictNames(port, book.id);
    expect(names).toHaveLength(1);
    const copy = JSON.parse(await readText(port, workflowConflictPath(book.id, runId, names[0] as string)));
    expect(copy).toMatchObject({
      id: "task_00000001",
      revision: 2,
      base: { kind: "sha256", value: "b".repeat(64), revision: 1 },
      conflictMetadata: {
        reason: "external-edit",
        baseline: { kind: "sha256", value: "b".repeat(64), revision: 1 },
        observed: { kind: "sha256", value: first.record.hash }
      }
    });

    const correct = revisionTwo(taskRecord(book.id), first.record.hash);
    const saved = await library.workflowRecords.saveTask(book.id, runId, correct);
    expect(saved.status).toBe("saved");
    expect(saved.record.record.revision).toBe(2);

    const recreated = await refusal(library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id)));
    expect(recreated.code).toBe("conflict");
  });

  test("a racing writer leaves the active record and keeps the intended copy", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const first = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    const target = key(taskPath(book.id, runId, "task_00000001"));
    const external = revisionTwo(taskRecord(book.id), first.record.hash);
    const externalBytes = encodeWorkflowRecord(external as unknown as WorkflowRecord);
    let raced = false;
    let targetCommits = 0;

    const original = port.commitFile.bind(port);
    port.commitFile = async (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> => {
      if (key(path) === target) {
        targetCommits += 1;
        if (!raced) {
          raced = true;
          const written = await original(path, externalBytes, { kind: "sha256", value: first.record.hash });
          if (written.status !== "written") throw new Error("Synthetic race could not publish");
        }
      }
      return original(path, bytes, expected);
    };

    const intended = {
      ...revisionTwo(taskRecord(book.id), first.record.hash),
      updatedAt: "2026-11-07T12:06:00.000Z"
    };
    const error = await refusal(library.workflowRecords.saveTask(book.id, runId, intended));
    expect(error.code).toBe("conflict");
    expect(targetCommits).toBe(1);

    const active = await port.readFile(taskPath(book.id, runId, "task_00000001"));
    expect(active?.sha256).toBe(sha256Hex(externalBytes));
    expect(decoder.decode(active?.bytes)).toContain("2026-11-07T12:05:00.000Z");

    const names = await conflictNames(port, book.id);
    expect(names).toHaveLength(1);
    const copy = JSON.parse(await readText(port, workflowConflictPath(book.id, runId, names[0] as string)));
    expect(copy.updatedAt).toBe("2026-11-07T12:06:00.000Z");
    expect(copy.conflictMetadata.observed.value).toBe(sha256Hex(externalBytes));
  });

  test("an equal task is a semantic no-op and writes nothing", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const target = key(taskPath(book.id, runId, "task_00000001"));
    let targetCommits = 0;
    const original = port.commitFile.bind(port);
    port.commitFile = async (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> => {
      if (key(path) === target) targetCommits += 1;
      return original(path, bytes, expected);
    };

    const first = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    expect(targetCommits).toBe(1);

    const again = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    expect(again.status).toBe("unchanged");
    expect(again.record.hash).toBe(first.record.hash);
    expect(targetCommits).toBe(1);

    // Key order is not canonical identity: the same values must not trigger a rewrite.
    const reordered = { updatedAt: at, createdAt: at, ...taskRecord(book.id) };
    const third = await library.workflowRecords.saveTask(book.id, runId, reordered);
    expect(third.status).toBe("unchanged");
    expect(targetCommits).toBe(1);
    expect(await conflictNames(port, book.id)).toHaveLength(0);
  });

  test("refuses malformed, duplicate-key, lone-surrogate, lossy-number and oversized files untouched", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const valid = JSON.stringify(taskRecord(book.id));
    const cases: Array<{ id: string; bytes: string | Uint8Array; code: string }> = [
      { id: "task_00000002", bytes: new Uint8Array([0x7b, 0xff, 0x7d]), code: "corrupt" },
      {
        id: "task_00000003",
        bytes: valid.replace('"kind":"task"', '"kind":"task","kind":"task"'),
        code: "corrupt"
      },
      {
        id: "task_00000004",
        bytes: `{"zz":"\\ud800",${valid.slice(1)}`,
        code: "corrupt"
      },
      {
        id: "task_00000005",
        bytes: `{"zz":9007199254740993,${valid.slice(1)}`,
        code: "corrupt"
      },
      {
        id: "task_00000006",
        bytes: `${valid}${" ".repeat(300_000)}`,
        code: "too-large"
      }
    ];

    for (const item of cases) {
      const path = taskPath(book.id, runId, item.id);
      const seeded = await seed(port, path, item.bytes);
      const error = await refusal(library.workflowRecords.readTask(book.id, runId, item.id));
      expect(error.code).toBe(item.code);
      const after = await port.readFile(path);
      expect(after?.sha256).toBe(seeded.sha256);
    }

    const invalidWrite = await refusal(
      library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id, {
        definition: {
          role: "future-specialist",
          completion: "candidate",
          dependsOn: [],
          impact: { complete: true, keys: ["mara"] }
        }
      }))
    );
    expect(invalidWrite.code).toBe("invalid");
    expect(await port.readFile(taskPath(book.id, runId, "task_00000001"))).toBeNull();
  });

  test("unknown plain fields, including own __proto__, survive read-modify-write", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const plain = JSON.stringify(taskRecord(book.id));
    const withProto = JSON.parse(`{"__proto__":{"kept":true},${plain.slice(1)}`) as Record<string, unknown>;
    withProto.future = { nested: ["kept", 2], enabled: true };

    const first = await library.workflowRecords.saveTask(book.id, runId, withProto);
    const firstRaw = JSON.parse(await readText(port, taskPath(book.id, runId, "task_00000001")));
    expect(Object.hasOwn(firstRaw, "__proto__")).toBe(true);
    expect(Reflect.get(firstRaw, "__proto__")).toEqual({ kept: true });
    expect(firstRaw.future).toEqual({ nested: ["kept", 2], enabled: true });

    const next = {
      ...first.record.record,
      revision: 2,
      base: { kind: "sha256", value: first.record.hash, revision: 1 },
      updatedAt: "2026-11-07T12:07:00.000Z"
    };
    const saved = await library.workflowRecords.saveTask(book.id, runId, next);
    expect(saved.record.record.revision).toBe(2);

    const secondRaw = JSON.parse(await readText(port, taskPath(book.id, runId, "task_00000001")));
    expect(Object.hasOwn(secondRaw, "__proto__")).toBe(true);
    expect(Reflect.get(secondRaw, "__proto__")).toEqual({ kept: true });
    expect(secondRaw.future).toEqual({ nested: ["kept", 2], enabled: true });
  });

  test("a newer closed-union member stays read-only and is never overwritten", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const path = taskPath(book.id, runId, "task_00000007");
    const seeded = await seed(port, path, JSON.stringify(taskRecord(book.id, {
      id: "task_00000007",
      status: "future-status"
    })));

    const error = await refusal(library.workflowRecords.readTask(book.id, runId, "task_00000007"));
    expect(error.code).toBe("unavailable");

    const write = await refusal(library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id, {
      id: "task_00000007"
    })));
    expect(write.code).toBe("conflict");
    const after = await port.readFile(path);
    expect(after?.sha256).toBe(seeded.sha256);
    expect(await conflictNames(port, book.id)).toHaveLength(1);
  });

  test("checked run updates use the exact previous hash and keep the run identity", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const first = await library.workflowRecords.saveRun(book.id, runId, runRecord(book.id));
    expect(first.status).toBe("saved");

    const next = {
      ...runRecord(book.id),
      revision: 2,
      base: { kind: "sha256", value: first.record.hash, revision: 1 },
      mode: "paused",
      updatedAt: "2026-11-07T12:09:00.000Z"
    };
    const saved = await library.workflowRecords.saveRun(book.id, runId, next);
    expect(saved.status).toBe("saved");
    expect((await library.workflowRecords.readRun(book.id, runId))?.record.mode).toBe("paused");

    const wrongIdentity = await refusal(library.workflowRecords.saveRun(book.id, runId, runRecord(book.id, {
      id: "run_00000002"
    })));
    expect(wrongIdentity.code).toBe("invalid");
    expect((await port.readFile(runHeaderPath(book.id, runId)))?.sha256).toBe(saved.record.hash);
  });

  test("a checked update whose previous file is missing keeps a missing-file copy", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const error = await refusal(library.workflowRecords.saveTask(
      book.id,
      runId,
      revisionTwo(taskRecord(book.id), "c".repeat(64))
    ));
    expect(error.code).toBe("conflict");
    const names = await conflictNames(port, book.id);
    expect(names).toHaveLength(1);
    const copy = JSON.parse(await readText(port, workflowConflictPath(book.id, runId, names[0] as string)));
    expect(copy.conflictMetadata).toMatchObject({
      reason: "missing-file",
      baseline: { kind: "sha256", value: "c".repeat(64), revision: 1 },
      observed: { kind: "absent" }
    });
    expect(await port.readFile(taskPath(book.id, runId, "task_00000001"))).toBeNull();
  });

  test("a valid non-canonical spelling is read and left alone by a semantic no-op", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const id = "task_00000008";
    const pretty = JSON.stringify(taskRecord(book.id, { id }), null, 2);
    const seeded = await seed(port, taskPath(book.id, runId, id), pretty);

    const snapshot = await library.workflowRecords.readTask(book.id, runId, id);
    expect(snapshot?.record.id).toBe(id);

    const noop = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id, { id }));
    expect(noop.status).toBe("unchanged");
    expect((await port.readFile(taskPath(book.id, runId, id)))?.sha256).toBe(seeded.sha256);
    expect(await conflictNames(port, book.id)).toHaveLength(0);
  });

  test("a zero-byte artifact body is a valid bounded pair", async () => {
    const { library, book } = await makeBook();
    const empty = new Uint8Array(0);
    const created = await library.workflowRecords.createArtifact(
      book.id,
      runId,
      artifactMetadata(book.id, empty, { id: "artifact_00000005" }),
      empty
    );
    expect(created.status).toBe("created");
    expect(created.artifact.body.bytes.byteLength).toBe(0);
    const read = await library.workflowRecords.readArtifact(book.id, runId, "artifact_00000005");
    expect(read?.record.bytes).toBe(0);
  });

  test("artifacts are absent-only pairs with exact metadata/body agreement", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const body = encoder.encode("Synthetic candidate text.");
    const metadata = artifactMetadata(book.id, body);

    const created = await library.workflowRecords.createArtifact(book.id, runId, metadata, body);
    expect(created.status).toBe("created");
    expect(created.artifact.record.hash).toBe(sha256Hex(body));
    expect(decoder.decode(created.artifact.body.bytes)).toBe("Synthetic candidate text.");

    const metaSnapshot = await port.readFile(artifactMetaPath(book.id, runId, "artifact_00000001"));
    const bodySnapshot = await port.readFile(artifactBodyPath(book.id, runId, "artifact_00000001", "md"));
    expect(metaSnapshot).not.toBeNull();
    expect(bodySnapshot?.sha256).toBe(sha256Hex(body));

    const again = await library.workflowRecords.createArtifact(book.id, runId, metadata, body);
    expect(again.status).toBe("unchanged");

    const mismatch = await refusal(library.workflowRecords.createArtifact(book.id, runId, artifactMetadata(book.id, body, {
      hash: "c".repeat(64)
    }), body));
    expect(mismatch.code).toBe("invalid");
    expect(await port.readFile(artifactMetaPath(book.id, runId, "artifact_00000001"))).not.toBeNull();

    const oversized = await refusal(library.workflowRecords.createArtifact(
      book.id,
      runId,
      artifactMetadata(book.id, new Uint8Array(0)),
      new Uint8Array(1_048_577)
    ));
    expect(oversized.code).toBe("too-large");

    const different = encoder.encode("A different synthetic candidate.");
    const conflict = await refusal(library.workflowRecords.createArtifact(
      book.id,
      runId,
      artifactMetadata(book.id, different),
      different
    ));
    expect(conflict.code).toBe("conflict");
    expect(await readText(port, artifactBodyPath(book.id, runId, "artifact_00000001", "md"))).toBe(
      "Synthetic candidate text."
    );
    expect((await conflictNames(port, book.id)).length).toBe(2);
  });

  test("a partial or mismatched artifact pair refuses without rewriting either file", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const body = encoder.encode("Synthetic JSON candidate.");
    const metadata = artifactMetadata(book.id, body, { mediaType: "application/json" });
    const metaBytes = encodeWorkflowRecord(metadata as unknown as WorkflowRecord);

    await seed(port, artifactMetaPath(book.id, runId, "artifact_00000001"), metaBytes);
    const partial = await refusal(library.workflowRecords.readArtifact(book.id, runId, "artifact_00000001"));
    expect(partial.code).toBe("unavailable");

    await seed(port, artifactBodyPath(book.id, runId, "artifact_00000001", "json"), body);
    const matched = await library.workflowRecords.readArtifact(book.id, runId, "artifact_00000001");
    expect(matched?.body.hash).toBe(sha256Hex(body));

    await seed(port, artifactBodyPath(book.id, runId, "artifact_00000001", "md"), encoder.encode("another body"));
    const mismatched = await refusal(library.workflowRecords.readArtifact(book.id, runId, "artifact_00000001"));
    expect(mismatched.code).toBe("corrupt");

    const bodyOnly = artifactBodyPath(book.id, runId, "artifact_00000009", "md");
    await seed(port, bodyOnly, body);
    const orphan = await refusal(library.workflowRecords.readArtifact(book.id, runId, "artifact_00000009"));
    expect(orphan.code).toBe("unavailable");
    expect((await port.readFile(bodyOnly))?.sha256).toBe(sha256Hex(body));

    // A create over a metadata-only pair refuses instead of guessing the missing body.
    const partialBody = encoder.encode("Synthetic partial candidate.");
    await seed(
      port,
      artifactMetaPath(book.id, runId, "artifact_00000010"),
      encodeWorkflowRecord(artifactMetadata(book.id, partialBody, { id: "artifact_00000010" }) as unknown as WorkflowRecord)
    );
    const partialWrite = await refusal(library.workflowRecords.createArtifact(
      book.id,
      runId,
      artifactMetadata(book.id, partialBody, { id: "artifact_00000010" }),
      partialBody
    ));
    expect(partialWrite.code).toBe("conflict");
    expect(await port.readFile(artifactBodyPath(book.id, runId, "artifact_00000010", "md"))).toBeNull();

    // Metadata that disagrees with its only body is refused on read.
    const mismatchBody = encoder.encode("Synthetic mismatch candidate.");
    await seed(
      port,
      artifactMetaPath(book.id, runId, "artifact_00000011"),
      encodeWorkflowRecord(artifactMetadata(book.id, mismatchBody, {
        id: "artifact_00000011",
        hash: "d".repeat(64)
      }) as unknown as WorkflowRecord)
    );
    await seed(port, artifactBodyPath(book.id, runId, "artifact_00000011", "md"), mismatchBody);
    const disagreement = await refusal(library.workflowRecords.readArtifact(book.id, runId, "artifact_00000011"));
    expect(disagreement.code).toBe("corrupt");
  });

  test("contexts are immutable and absent-only", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const created = await library.workflowRecords.createContext(book.id, runId, contextRecord(book.id));
    expect(created.status).toBe("created");
    expect((await library.workflowRecords.readContext(book.id, runId, "context_00000001"))?.hash).toBe(created.record.hash);

    const again = await library.workflowRecords.createContext(book.id, runId, contextRecord(book.id));
    expect(again.status).toBe("unchanged");

    const conflict = await refusal(library.workflowRecords.createContext(book.id, runId, contextRecord(book.id, {
      bytes: 129
    })));
    expect(conflict.code).toBe("conflict");
    expect((await port.readFile(contextPath(book.id, runId, "context_00000001")))?.sha256).toBe(created.record.hash);
    expect(await conflictNames(port, book.id)).toHaveLength(1);
  });

  test("refuses a foreign book, run, kind or unsafe ID before writing", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const records = library.workflowRecords;

    const foreignBook = await refusal(records.saveTask(book.id, runId, taskRecord("book_00000099")));
    expect(foreignBook.code).toBe("invalid");

    const foreignRun = await refusal(records.saveTask(book.id, "run_00000002", taskRecord(book.id)));
    expect(foreignRun.code).toBe("invalid");
    expect(await port.readFile(taskPath(book.id, "run_00000002", "task_00000001"))).toBeNull();

    const foreignKind = await refusal(records.saveEffect(book.id, runId, taskRecord(book.id)));
    expect(foreignKind.code).toBe("invalid");

    const unsafeId = await refusal(records.readTask(book.id, runId, "../task_00000001"));
    expect(unsafeId.code).toBe("invalid");

    const missingBook = await refusal(records.saveTask("book_00000099", runId, taskRecord("book_00000099")));
    expect(missingBook.code).toBe("not-found");
  });

  test("an uncertain publication is reported as uncertain and never replayed", async () => {
    const { library, book, port }: TestLibrary = await makeBook();
    const target = key(runHeaderPath(book.id, runId));
    const original = port.commitFile.bind(port);
    let targetCommits = 0;
    port.commitFile = async (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> => {
      if (key(path) === target) targetCommits += 1;
      const result = await original(path, bytes, expected);
      if (key(path) === target && result.status === "written") {
        return { status: "changed", current: result.snapshot, publication: "uncertain" };
      }
      return result;
    };

    const error = await refusal(library.workflowRecords.saveRun(book.id, runId, runRecord(book.id)));
    expect(error.code).toBe("uncertain");
    expect(targetCommits).toBe(1);
    expect(await conflictNames(port, book.id)).toHaveLength(0);
    expect(await port.readFile(runHeaderPath(book.id, runId))).not.toBeNull();

    // A fresh explicit save is a read of the published bytes, not an automatic retry.
    const fresh = await library.workflowRecords.saveRun(book.id, runId, runRecord(book.id));
    expect(fresh.status).toBe("unchanged");
    expect(targetCommits).toBe(1);
  });

  test("conflict copy names stay bounded with a long record and device ID", async () => {
    const { library, book, port } = await makeBook(clockAt(at), "d".repeat(100));
    const longId = `task_${"a".repeat(123)}`;
    const first = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id, { id: longId }));
    const stale = revisionTwo(taskRecord(book.id, { id: longId }), "b".repeat(64), longId);
    const error = await refusal(library.workflowRecords.saveTask(book.id, runId, stale));
    expect(error.code).toBe("conflict");
    const name = error.savedAs?.split("/").pop() ?? "";
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".json")).toBe(true);
    const copy = JSON.parse(await readText(port, workflowConflictPath(book.id, runId, name)));
    expect(copy.id).toBe(longId);
    expect(first.record.record.id).toBe(longId);
  });

  test("there is one checked workflow writer and no unchecked or deleting path", () => {
    const store = readFileSync(new URL("../../src/workflow/record-store.ts", import.meta.url), "utf8");
    expect(store).not.toContain("storage.commitFile");
    expect(store).not.toContain("removeFile");
    expect(store).not.toContain("removeDirectory");
    expect(store).not.toMatch(/from "node:fs"/);
    expect(store).toContain("this.host.commitFile");

    const service = readFileSync(new URL("../../src/library/service.ts", import.meta.url), "utf8");
    expect(service).toContain("new WorkflowRecordStore(");

    const root = new URL("../../src/", import.meta.url);
    const sources = readdirSync(root, { recursive: true })
      .filter((file): file is string => typeof file === "string" && file.endsWith(".ts"))
      .map((file) => readFileSync(new URL(file, root), "utf8"));
    expect(sources.join("\n").match(/new WorkflowRecordStore\(/g) ?? []).toHaveLength(1);
  });
});
