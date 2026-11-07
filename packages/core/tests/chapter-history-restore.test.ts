import { describe, expect, spyOn, test } from "bun:test";
import { LibraryPortError } from "../src/library/errors";
import { historyDirectory, historyFilePath, readHistoryEnvelope, serializeHistoryRecord,
  type HistoryRestoreInput, type StoredHistoryRecord } from "../src/library/history";
import { historyReference, type HistoryMutationResult } from "../src/library/history-restore";
import { chapterPath } from "../src/library/paths";
import { LibraryService } from "../src/library/service";
import { chapterMetaSchema } from "../src/schema";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const savedSource = (chapter: { version: number; hash: string }) => ({ status: "saved" as const, version: chapter.version, hash: chapter.hash });
function saved(result: HistoryMutationResult) {
  expect(result.status).toBe("saved");
  if (result.status !== "saved") throw new Error(JSON.stringify(result));
  return result;
}

async function fixture(sameBody = false) {
  const port = new InMemoryLibraryPort();
  const service = await LibraryService.open({ storage: port, runtime: port });
  const book = await service.createBook({ title: "Synthetic restoration" });
  const original = await service.createChapter(book.id, { title: "Door", content: "Selected words" });
  const scope = { bookId: book.id, chapterId: original.id };
  const selected = await service.captureChapterHistory({ ...scope, label: "Named version", source: savedSource(original) });
  const edit = await service.saveChapter(book.id, original.id, sameBody ? original.content : "Current saved words", {
    baseVersion: original.version, baseHash: original.hash
  });
  if (edit.status !== "saved") throw new Error("Fixture save failed");
  const current = edit.chapter;
  const path = chapterPath(book.id, current.path);
  const before = await port.readFile(path);
  const selectedBytes = await port.readFile(historyFilePath({ ...scope, fileName: selected.fileName }));
  const input: HistoryRestoreInput = { ...scope, selected: historyReference(selected), source: savedSource(current) };
  const address = (record: StoredHistoryRecord) => ({ ...scope, fileName: record.fileName });
  const reopen = () => LibraryService.open({ storage: port, runtime: port });
  const unchanged = async () => {
    expect((await port.readFile(path))?.bytes).toEqual(before?.bytes);
    expect((await port.readFile(historyFilePath(address(selected))))?.bytes).toEqual(selectedBytes?.bytes);
  };
  return { port, service, current, scope, selected, path, before, input, address, reopen, unchanged };
}

describe("checked history restore and undo", () => {
  test.each([false, true])("partial front matter returns valid Chapters through restore, reopen and undo (same body %s)", async (sameBody) => {
    const f = await fixture(sameBody);
    const raw = `---\nid: ${f.scope.chapterId}\nversion: ${f.current.version}\ncustom: {nested: [true, null, 0.1]}\ncontent: metadata content\npath: metadata path\nhash: metadata hash\nwordCount: 777\n---\n\n${f.current.content}`;
    await f.port.commitFile(f.path, encoder.encode(raw), { kind: "any" });
    const initial = await f.service.readChapter(f.scope.bookId, f.scope.chapterId);
    expect(chapterMetaSchema.safeParse(initial).success).toBe(true);
    const originalMeta = readHistoryEnvelope(raw).metadata as Record<string, unknown>;
    const restored = saved(await f.service.restoreChapterHistory({ ...f.input, source: savedSource(initial) }));
    const reopened = await f.reopen();
    const readAfterRestore = await reopened.readChapter(f.scope.bookId, f.scope.chapterId);
    const restoredRaw = readHistoryEnvelope(decoder.decode((await f.port.readFile(f.path))?.bytes));
    expect(restoredRaw.metadata).toEqual({ ...originalMeta, version: restored.chapter.version, updatedAt: restored.chapter.updatedAt });
    const undone = saved(await reopened.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(readAfterRestore) }));
    const readAfterUndo = await (await f.reopen()).readChapter(f.scope.bookId, f.scope.chapterId);
    for (const chapter of [restored.chapter, readAfterRestore, undone.chapter, readAfterUndo]) {
      expect(chapterMetaSchema.safeParse(chapter).success).toBe(true);
      expect(chapter.title).toBe(initial.title);
      expect(chapter.order).toBe(initial.order);
      expect(chapter.createdAt).toBeDefined();
      expect(chapter.path).toBe(initial.path);
      expect(chapter.custom).toEqual(originalMeta.custom);
      expect(chapter.hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(restored.chapter.content).toBe(f.selected.content);
    expect(undone.chapter.content).toBe(initial.content);
    expect(undone.chapter.version).toBe(restored.chapter.version + 1);
    const persisted = readHistoryEnvelope(decoder.decode((await f.port.readFile(f.path))?.bytes));
    expect(persisted.metadata).toEqual({ ...originalMeta, version: undone.chapter.version, updatedAt: undone.chapter.updatedAt });
    expect(persisted.metadata).not.toHaveProperty("title");
    expect(persisted.metadata).not.toHaveProperty("order");
    expect(persisted.metadata).not.toHaveProperty("createdAt");
    expect(persisted.content).toBe(initial.content);
  });

  test("restores only body, persists exact identities, reopens and undoes through journaled writes", async () => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    const writes: string[] = [];
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("chapters")) {
        const list = await f.service.listChapterHistory(f.scope);
        expect(list.records.some((r) => r.meta.kind === "safety")).toBe(true);
        expect(list.records.some((r) => r.meta.kind === "intent")).toBe(true);
        expect(expected.kind).toBe("sha256");
        writes.push("chapter");
      }
      return commit(path, bytes, expected);
    };
    const result = saved(await f.service.restoreChapterHistory(f.input));
    expect(result.finalized).toBe(true);
    expect(result.chapter.content).toBe(f.selected.content);
    expect(result.chapter.version).toBe(f.current.version + 1);
    expect(result.safety.content).toBe(f.current.content);
    expect(result.intent.meta).toMatchObject({ state: "applied", result: { version: result.chapter.version, hash: result.chapter.hash } });
    expect(writes).toEqual(["chapter"]);
  });

  test("durable undo restores the pre-restore body and preserves selected/safety bytes", async () => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const safetyBefore = await f.port.readFile(historyFilePath(f.address(restored.safety)));
    const reopened = await f.reopen();
    expect(await reopened.reconcileChapterHistory(f.address(restored.intent))).toMatchObject({ status: "restore-matches", undoAvailable: true });
    const undone = saved(await reopened.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }));
    expect(undone.finalized).toBe(true);
    expect(undone.chapter.content).toBe(f.current.content);
    expect(undone.chapter.version).toBe(restored.chapter.version + 1);
    expect(undone.intent.meta).toMatchObject({ state: "undone", undoResult: { version: undone.chapter.version, hash: undone.chapter.hash } });
    expect(await reopened.reconcileChapterHistory(f.address(undone.intent))).toMatchObject({ status: "undo-matches", undoAvailable: false });
    expect((await f.port.readFile(historyFilePath(f.address(restored.safety))))?.bytes).toEqual(safetyBefore?.bytes);
    expect(await reopened.readChapterHistory(f.address(f.selected))).toEqual(f.selected);
    expect((await reopened.checkDrift()).entries.some((entry) => entry.path.includes("/history/") || entry.path.includes("/chapters/"))).toBe(false);
  });

  test("preserves raw supported metadata, including runtime-property names and nested unknown values", async () => {
    const f = await fixture();
    const extra = "content: metadata content\npath: metadata path\nhash: metadata hash\nwordCount: 777\nfuture: {nested: [true, null, 0.1, {constructor: retained}], text: 'yes'}\n";
    const bytes = encoder.encode(decoder.decode(f.before?.bytes).replace("---\n", `---\n${extra}`));
    await f.port.commitFile(f.path, bytes, { kind: "any" });
    const current = await f.service.readChapter(f.scope.bookId, f.scope.chapterId);
    const result = saved(await f.service.restoreChapterHistory({ ...f.input, source: savedSource(current) }));
    const next = readHistoryEnvelope(decoder.decode((await f.port.readFile(f.path))?.bytes)).metadata as Record<string, unknown>;
    const previous = readHistoryEnvelope(decoder.decode(bytes)).metadata as Record<string, unknown>;
    expect(next).toEqual({ ...previous, version: result.chapter.version, updatedAt: result.chapter.updatedAt });
    expect(next.content).toBe("metadata content");
  });

  test.each(["version-behind", "version-ahead", "hash"] as const)("same-body restore exact-checks stale %s before no-op handling", async (kind) => {
    const f = await fixture(true);
    const source = { ...f.input.source };
    if (kind === "hash") source.hash = "0".repeat(64);
    else source.version += kind === "version-ahead" ? 1 : -1;
    expect(await f.service.restoreChapterHistory({ ...f.input, source })).toMatchObject({ status: "conflict" });
    await f.unchanged();
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(1);
    const conflicts = await f.service.listConflicts(f.scope.bookId);
    expect(conflicts).toHaveLength(1);
  });

  test("valid same-body restore and undo still have distinct exact versions", async () => {
    const f = await fixture(true);
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    expect(restored.chapter.version).toBe(f.current.version + 1);
    const undone = saved(await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }));
    expect(undone.chapter.version).toBe(restored.chapter.version + 1);
    expect(undone.chapter.content).toBe(f.current.content);
  });

  test("two calls on the same service serialize without queue re-entry and the second refuses its old base", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.service.restoreChapterHistory(f.input), f.service.restoreChapterHistory(f.input)]);
    const result = saved(first);
    expect(second.status).toBe("conflict");
    expect((await f.port.readFile(f.path))?.sha256).toBe(result.chapter.hash);
  });

  test.each(["intent", "chapter"] as const)("a second writer at the %s boundary wins without losing either snapshot", async (boundary) => {
    const f = await fixture();
    const second = await f.reopen();
    const commit = f.port.commitFile.bind(f.port);
    let injected = false;
    let otherHash = "";
    f.port.commitFile = async (path, bytes, expected) => {
      if (!injected && (boundary === "chapter" ? path.includes("chapters") : path.includes("history") && decoder.decode(bytes).includes("kind: intent"))) {
        injected = true;
        const other = await second.saveChapter(f.scope.bookId, f.scope.chapterId, "Second writer owns these words", {
          baseVersion: f.current.version, baseHash: f.current.hash
        });
        if (other.status !== "saved") throw new Error("Second writer failed");
        otherHash = other.chapter.hash;
      }
      return commit(path, bytes, expected);
    };
    const result = await f.service.restoreChapterHistory(f.input);
    expect(result.status).toBe("conflict");
    expect((await f.port.readFile(f.path))?.sha256).toBe(otherHash);
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(3);
    expect(await f.service.readChapterHistory(f.address(f.selected))).toEqual(f.selected);
  });

  test("stale undo refuses even if an external writer keeps the same body", async () => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const raw = await f.port.readFile(f.path);
    const changed = encoder.encode(decoder.decode(raw?.bytes).replace("title: Door", "title: Outside"));
    await f.port.commitFile(f.path, changed, { kind: "any" });
    const historyBefore = await f.port.readFile(historyFilePath(f.address(restored.intent)));
    expect((await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) })).status).toBe("conflict");
    expect((await f.port.readFile(f.path))?.bytes).toEqual(changed);
    expect((await f.port.readFile(historyFilePath(f.address(restored.intent))))?.bytes).toEqual(historyBefore?.bytes);
  });

  test("undo refuses a caller's wrong version even with exact current hash and equal bodies", async () => {
    const f = await fixture(true);
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const before = await f.port.readFile(f.path);
    const result = await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent),
      source: { ...savedSource(restored.chapter), version: restored.chapter.version + 1 } });
    expect(result.status).toBe("conflict");
    expect((await f.port.readFile(f.path))?.bytes).toEqual(before?.bytes);
    expect(await f.service.readChapterHistory(f.address(restored.intent))).toEqual(restored.intent);
  });

  test("intent transitions retain supported unknown fields at every nested metadata boundary", async () => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    if (restored.intent.meta.kind !== "intent") throw new Error("Expected intent");
    const meta = restored.intent.meta;
    const extra = { constructor: "data", nested: [true, null, { fraction: 0.1 }] };
    const enriched = { ...restored.intent, meta: { ...meta, future: extra,
      selected: { ...meta.selected, future: extra }, safety: { ...meta.safety, future: extra },
      result: { ...meta.result, version: restored.chapter.version, hash: restored.chapter.hash, future: extra },
      plannedResult: { ...meta.plannedResult, version: restored.chapter.version, hash: restored.chapter.hash, future: extra }
    } };
    const text = await serializeHistoryRecord(enriched, f.port);
    await f.port.commitFile(historyFilePath(f.address(restored.intent)), encoder.encode(text), { kind: "sha256", value: restored.intent.hash });
    const reread = await f.service.readChapterHistory(f.address(restored.intent));
    const undo = saved(await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(reread), source: savedSource(restored.chapter) }));
    expect(undo.intent.meta).toMatchObject({ future: extra, selected: { future: extra }, safety: { future: extra },
      result: { future: extra }, plannedResult: { future: extra } });
  });
});

describe("history cancellation, faults and recovery", () => {
  test.each(["before", "safety", "intent", "chapter"] as const)("cancellation at %s retains accurate outcome and bytes", async (boundary) => {
    const f = await fixture();
    const controller = new AbortController();
    const commit = f.port.commitFile.bind(f.port);
    if (boundary === "before") controller.abort();
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if ((boundary === "chapter" && path.includes("chapters")) ||
          (path.includes("history") && decoder.decode(bytes).includes(`kind: ${boundary}`))) controller.abort();
      return result;
    };
    const result = await f.service.restoreChapterHistory(f.input, controller.signal);
    if (boundary === "chapter") {
      expect(saved(result).finalized).toBe(true);
    } else {
      expect(result.status).toBe("canceled");
      await f.unchanged();
      expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(boundary === "before" ? 1 : 3);
    }
  });

  test.each(["safety", "intent"] as const)("%s publication failure stops before chapter and retains earlier files", async (kind) => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("history") && decoder.decode(bytes).includes(`kind: ${kind}`)) throw new LibraryPortError("storage-full", "Synthetic failure");
      return commit(path, bytes, expected);
    };
    expect(await f.service.restoreChapterHistory(f.input)).toMatchObject({ status: "failed", stage: kind });
    await f.unchanged();
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(kind === "safety" ? 1 : 2);
  });

  test.each(["safety", "intent"] as const)("unconfirmed %s publication retains the complete record but never writes chapter", async (kind) => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    let attempted = 0;
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if (path.includes("history") && decoder.decode(bytes).includes(`kind: ${kind}`)) {
        attempted += 1;
        throw new LibraryPortError("io", "Synthetic lost readback");
      }
      return result;
    };
    expect(await f.service.restoreChapterHistory(f.input)).toMatchObject({ status: "failed", stage: kind });
    expect(attempted).toBe(1);
    await f.unchanged();
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(kind === "safety" ? 2 : 3);
  });

  test("chapter write failure keeps all records, the complete chapter and a base-matching intent", async () => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("chapters")) throw new LibraryPortError("permission-required", "Synthetic permission failure");
      return commit(path, bytes, expected);
    };
    const result = await f.service.restoreChapterHistory(f.input);
    expect(result.status).toBe("uncertain");
    if (!result.intent) throw new Error("Missing intent");
    await f.unchanged();
    expect(await (await f.reopen()).reconcileChapterHistory(f.address(result.intent))).toMatchObject({ status: "base-matches", undoAvailable: false });
  });

  test.each(["throw", "mismatch"] as const)("uncertain chapter %s readback never reports saved or retries; exact recovery can undo", async (fault) => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    let writes = 0;
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if (path.includes("chapters")) {
        writes += 1;
        if (fault === "throw") throw new LibraryPortError("io", "Synthetic lost response");
        if (result.status === "written") return { ...result, snapshot: { ...result.snapshot, bytes: encoder.encode("not the committed bytes") } };
      }
      return result;
    };
    const result = await f.service.restoreChapterHistory(f.input);
    expect(result.status).toBe("uncertain");
    expect(writes).toBe(1);
    if (!result.intent) throw new Error("Missing intent");
    f.port.commitFile = commit;
    const reopened = await f.reopen();
    const recovery = await reopened.reconcileChapterHistory(f.address(result.intent));
    expect(recovery).toMatchObject({ status: "restore-matches", undoAvailable: true });
    if (!recovery.current) throw new Error("Missing current chapter");
    const undo = saved(await reopened.undoChapterHistory({ ...f.scope, intent: historyReference(recovery.intent), source: savedSource(recovery.current) }));
    expect(undo.chapter.content).toBe(f.current.content);
  });

  test("failed finalization reports actual saved result and preserves prepared bytes for reopen undo", async () => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    let prepared: Uint8Array | undefined;
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("history") && decoder.decode(bytes).includes("kind: intent")) {
        if (expected.kind === "sha256") throw new LibraryPortError("io", "Synthetic finalize failure");
        prepared = bytes.slice();
      }
      return commit(path, bytes, expected);
    };
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    expect(restored.finalized).toBe(false);
    expect((await f.port.readFile(historyFilePath(f.address(restored.intent))))?.bytes).toEqual(prepared);
    f.port.commitFile = commit;
    const reopened = await f.reopen();
    expect(await reopened.reconcileChapterHistory(f.address(restored.intent))).toMatchObject({ undoAvailable: true });
    expect(saved(await reopened.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) })).chapter.content).toBe(f.current.content);
  });

  test("a competing intent edit defeats hash-guarded finalization and keeps the competing bytes", async () => {
    const f = await fixture();
    const commit = f.port.commitFile.bind(f.port);
    let competing: Uint8Array | undefined;
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("history") && expected.kind === "sha256") {
        const prior = await f.port.readFile(path);
        competing = encoder.encode(decoder.decode(prior?.bytes).replace("label: Restore snapshot", "label: Other writer intent"));
        await commit(path, competing, { kind: "any" });
      }
      return commit(path, bytes, expected);
    };
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    expect(restored.finalized).toBe(false);
    expect((await f.port.readFile(historyFilePath(f.address(restored.intent))))?.bytes).toEqual(competing);
    expect((await f.port.readFile(f.path))?.sha256).toBe(restored.chapter.hash);
  });

  test("same body with different metadata and legacy prepared intents never imply restore ownership", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if (path.includes("history") && decoder.decode(bytes).includes("kind: intent")) controller.abort();
      return result;
    };
    const canceled = await f.service.restoreChapterHistory(f.input, controller.signal);
    if (canceled.intent?.meta.kind !== "intent") throw new Error("Missing intent");
    f.port.commitFile = commit;
    const second = await f.service.saveChapter(f.scope.bookId, f.scope.chapterId, f.selected.content, { baseVersion: f.current.version, baseHash: f.current.hash });
    if (second.status !== "saved") throw new Error("Fixture save failed");
    const raw = await f.port.readFile(f.path);
    await commit(f.path, encoder.encode(decoder.decode(raw?.bytes).replace("title: Door", "title: Outside")), { kind: "any" });
    expect(await f.service.reconcileChapterHistory(f.address(canceled.intent))).toMatchObject({ status: "changed", undoAvailable: false });
    const { plannedResult: _plan, ...legacy } = canceled.intent.meta;
    const text = await serializeHistoryRecord({ content: "", meta: legacy }, f.port);
    await commit(historyFilePath(f.address(canceled.intent)), encoder.encode(text), { kind: "any" });
    expect(await f.service.reconcileChapterHistory(f.address(canceled.intent))).toMatchObject({ status: "uncertain", undoAvailable: false });
  });

  test("interrupted undo finalization reconciles exact undo identity without replay", async () => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const commit = f.port.commitFile.bind(f.port);
    let chapterWrites = 0;
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("chapters")) chapterWrites += 1;
      if (path.includes("history") && decoder.decode(bytes).includes("state: undone")) throw new LibraryPortError("io", "Synthetic failure");
      return commit(path, bytes, expected);
    };
    const undo = saved(await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }));
    expect(undo.finalized).toBe(false);
    const reopened = await f.reopen();
    const recovery = await reopened.reconcileChapterHistory(f.address(undo.intent));
    expect(recovery).toMatchObject({ status: "undo-matches", undoAvailable: false });
    expect((await reopened.undoChapterHistory({ ...f.scope, intent: historyReference(undo.intent), source: savedSource(undo.chapter) })).status).toBe("failed");
    expect(chapterWrites).toBe(1);
  });

  test("recovery is read-only and corrupt dependencies remain byte intact and unavailable", async () => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const path = historyFilePath(f.address(restored.safety));
    const corrupt = encoder.encode("---\nfuture: !!set {synthetic: null}\n---\nretained");
    await f.port.commitFile(path, corrupt, { kind: "any" });
    f.port.commitFile = async () => { throw new Error("Recovery must not write"); };
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await f.service.reconcileChapterHistory(f.address(restored.intent))).toMatchObject({ status: "unavailable", undoAvailable: false });
      expect((await f.port.readFile(path))?.bytes).toEqual(corrupt);
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
    expect((await f.port.listDirectory(historyDirectory(f.scope)))).toHaveLength(3);
  });

  test.each(["failure", "changed"] as const)("undo intent preparation %s leaves chapter and every recovery record intact", async (fault) => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const before = await f.port.readFile(f.path);
    const intentPath = historyFilePath(f.address(restored.intent));
    let expectedBytes = (await f.port.readFile(intentPath))?.bytes;
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("history") && expected.kind === "sha256") {
        expect(expected.value).toBe(restored.intent.hash);
        if (fault === "failure") throw new LibraryPortError("read-only", "Synthetic read-only failure");
        expectedBytes = encoder.encode(decoder.decode(expectedBytes).replace("label: Restore snapshot", "label: Other intent"));
        await commit(path, expectedBytes, { kind: "any" });
      }
      return commit(path, bytes, expected);
    };
    expect(await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }))
      .toMatchObject({ status: "failed", stage: "intent" });
    expect((await f.port.readFile(f.path))?.bytes).toEqual(before?.bytes);
    expect((await f.port.readFile(intentPath))?.bytes).toEqual(expectedBytes);
    expect(await f.service.readChapterHistory(f.address(restored.safety))).toEqual(restored.safety);
    expect(await f.service.readChapterHistory(f.address(f.selected))).toEqual(f.selected);
  });

  test.each(["before", "intent", "chapter"] as const)("undo cancellation at %s never hides a committed result", async (boundary) => {
    const f = await fixture();
    const restored = saved(await f.service.restoreChapterHistory(f.input));
    const before = await f.port.readFile(f.path);
    const controller = new AbortController();
    if (boundary === "before") controller.abort();
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if ((boundary === "intent" && path.includes("history")) || (boundary === "chapter" && path.includes("chapters"))) controller.abort();
      return result;
    };
    const result = await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }, controller.signal);
    if (boundary === "chapter") expect(saved(result).chapter.content).toBe(f.current.content);
    else {
      expect(result.status).toBe("canceled");
      expect((await f.port.readFile(f.path))?.bytes).toEqual(before?.bytes);
    }
  });

  test("unreadable, future and lossy source metadata refuse quietly before writing any history", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const emission = spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      for (const header of ["future: !!set {synthetic: null}", "schemaVersion: 2", "future: 1.0000000000000001", "? [synthetic]\n: data"]) {
        const f = await fixture();
        const bytes = encoder.encode(decoder.decode(f.before?.bytes).replace("---\n", `---\n${header}\n`));
        await f.port.commitFile(f.path, bytes, { kind: "any" });
        const input = { ...f.input, source: { ...f.input.source, hash: await f.port.sha256(bytes) } };
        expect(await f.service.restoreChapterHistory(input)).toMatchObject({ status: "failed", stage: "preflight" });
        expect((await f.port.readFile(f.path))?.bytes).toEqual(bytes);
        expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(1);
      }
      expect(warning).not.toHaveBeenCalled();
      expect(emission).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); emission.mockRestore(); }
  });

  test("successful restore and undo never invoke legacy diagnostics on unrelated chapter candidates", async () => {
    const f = await fixture();
    const bytes = encoder.encode("---\n? [SYNTHETIC_PRIVATE_MARKER]\n: preserved\n---\nUnrelated body\n");
    const path = chapterPath(f.scope.bookId, "0000-unrelated.md");
    await f.port.commitFile(path, bytes, { kind: "absent" });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const emission = spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const restored = saved(await f.service.restoreChapterHistory(f.input));
      saved(await f.service.undoChapterHistory({ ...f.scope, intent: historyReference(restored.intent), source: savedSource(restored.chapter) }));
      expect((await f.port.readFile(path))?.bytes).toEqual(bytes);
      expect(warning).not.toHaveBeenCalled();
      expect(emission).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); emission.mockRestore(); }
  });
});
