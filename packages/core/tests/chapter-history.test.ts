import { describe, expect, test } from "bun:test";
import { createLibraryArchive } from "../src/archive/export";
import { archiveSourceFromBytes, importLibraryArchive } from "../src/archive/import";
import { LibraryPortError } from "../src/library/errors";
import {
  historyCaptureSchema, historyDirectory, historyFilePath, historyMetaSchema,
  parseHistoryRecord, serializeHistoryRecord,
  type HistoryCaptureInput, type HistoryErrorCode, type HistoryMeta, type StoredHistoryRecord
} from "../src/library/history";
import { bookFilePath, bookPath, chapterPath } from "../src/library/paths";
import { toLibraryPath } from "../src/library/path";
import { LibraryService } from "../src/library/service";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function fixture(port = new InMemoryLibraryPort()) {
  const service = await LibraryService.open({ storage: port, runtime: port });
  const book = await service.createBook({ title: "Synthetic lighthouse" });
  const chapter = await service.createChapter(book.id, { title: "Door", content: "A salt wind.  \r\n\r\nA lamp.\r\n" });
  const scope = { bookId: book.id, chapterId: chapter.id };
  const input: HistoryCaptureInput = {
    ...scope, label: "First draft", source: { status: "saved", version: chapter.version, hash: chapter.hash }
  };
  const address = (record: StoredHistoryRecord) => ({ ...scope, fileName: record.fileName });
  return { port, service, book, chapter, scope, input, address };
}

async function rawRecord(port: InMemoryLibraryPort, scope: { bookId: string; chapterId: string }, fileName: string) {
  const record = await port.readFile(historyFilePath({ ...scope, fileName }));
  if (!record) throw new Error("Expected a stored history fixture");
  return record;
}

describe("saved-only chapter history", () => {
  test("captures exact saved provenance, canonical body and Unicode label without changing any chapter bytes", async () => {
    const f = await fixture();
    const before = await f.port.readFile(chapterPath(f.book.id, f.chapter.path));
    const record = await f.service.captureChapterHistory({ ...f.input, label: "  船 / Café: draft  " });
    expect(record.meta).toMatchObject({
      kind: "snapshot", schemaVersion: 1, ...f.scope, label: "船 / Café: draft",
      sourceVersion: f.chapter.version, sourceHash: f.chapter.hash,
      bodyHash: await f.port.sha256(encoder.encode(f.chapter.content))
    });
    expect(record.content).toBe("A salt wind.  \n\nA lamp.\n");
    expect(record.fileName).toEndWith("-cafe-draft.md");
    expect(await f.service.readChapterHistory(f.address(record))).toEqual(record);
    expect(await f.port.readFile(chapterPath(f.book.id, f.chapter.path))).toEqual(before);
    const list = await f.service.listChapterHistory(f.scope);
    expect(list.issues).toEqual([]);
    expect(list.records).toHaveLength(1);
    expect(list.records[0]?.size).toBe((await rawRecord(f.port, f.scope, record.fileName)).bytes.length);
    expect((await f.service.checkDrift()).entries.some((change) => change.path.includes("/history/"))).toBe(false);
  });

  test("read/list/compare perform no writes and compare current saved text rather than caller drafts", async () => {
    const f = await fixture();
    const record = await f.service.captureChapterHistory(f.input);
    expect((await f.service.compareChapterHistory(f.address(record))).equal).toBe(true);
    const saved = await f.service.saveChapter(f.book.id, f.chapter.id, "New saved words.", {
      baseHash: f.chapter.hash, baseVersion: f.chapter.version
    });
    expect(saved.status).toBe("saved");
    const draft = Object.freeze({ content: "Unsaved synthetic draft", pending: true });
    const before = await f.port.readFile(chapterPath(f.book.id, f.chapter.path));
    f.port.commitFile = async () => { throw new Error("A read must not write or flush"); };
    f.port.ensureDirectory = async () => { throw new Error("A read must not create directories"); };
    f.port.moveFile = async () => { throw new Error("A read must not move files"); };
    f.port.removeFile = async () => { throw new Error("A read must not prune files"); };
    await f.service.listChapterHistory(f.scope);
    await f.service.readChapterHistory(f.address(record));
    const comparison = await f.service.compareChapterHistory(f.address(record));
    expect(comparison).toMatchObject({ basis: "saved", equal: false });
    expect(comparison.current.content).toBe("New saved words.\n");
    expect(comparison.snapshot.content).toBe(record.content);
    expect(draft).toEqual({ content: "Unsaved synthetic draft", pending: true });
    expect(await f.port.readFile(chapterPath(f.book.id, f.chapter.path))).toEqual(before);
  });

  test("duplicate labels and timestamps keep distinct immutable records; ordinary saves add none", async () => {
    const f = await fixture();
    const records = await Promise.all(Array.from({ length: 3 }, () => f.service.captureChapterHistory(f.input)));
    expect(new Set(records.map((r) => r.fileName)).size).toBe(3);
    expect(new Set(records.map((r) => r.meta.id)).size).toBe(3);
    expect(records[1]?.fileName).toEndWith("-2.md");
    expect(records[2]?.fileName).toEndWith("-3.md");
    await f.service.saveChapter(f.book.id, f.chapter.id, "Ordinary edit", { baseHash: f.chapter.hash, baseVersion: f.chapter.version });
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(3);
    for (const record of records) expect(await f.service.readChapterHistory(f.address(record))).toEqual(record);
  });

  test("newest capture first with deterministic ties, scoped to book and chapter", async () => {
    let now = "2026-11-07T00:00:00.000Z";
    const f = await fixture(new InMemoryLibraryPort(undefined, () => now));
    const first = await f.service.captureChapterHistory(f.input);
    now = "2026-11-08T00:00:00.000Z";
    const second = await f.service.captureChapterHistory(f.input);
    expect((await f.service.listChapterHistory(f.scope)).records.map((r) => r.meta.id)).toEqual([second.meta.id, first.meta.id]);
    const other = await f.service.createChapter(f.book.id, { title: "Door", content: "Other" });
    expect(await f.service.listChapterHistory({ bookId: f.book.id, chapterId: other.id })).toEqual({ records: [], issues: [] });
  });

  test("requires saved state, valid label, identity and hashes; accepts no draft body", async () => {
    const f = await fixture();
    for (const status of ["dirty", "pending", "conflict", "failed"]) {
      await expect(f.service.captureChapterHistory({ ...f.input, source: { ...f.input.source, status } } as HistoryCaptureInput))
        .rejects.toMatchObject({ code: "invalid" });
    }
    for (const label of ["", "  ", "line\nbreak", "control\u0000", "line\u2028break", "a".repeat(201)]) {
      await expect(f.service.captureChapterHistory({ ...f.input, label })).rejects.toMatchObject({ code: "invalid" });
    }
    expect(historyCaptureSchema.safeParse({ ...f.input, label: "船".repeat(200) }).success).toBe(true);
    for (const input of [
      { ...f.input, content: "draft" },
      { ...f.input, bookId: "../book" },
      { ...f.input, chapterId: "ch_../../escape" },
      { ...f.input, source: { ...f.input.source, hash: "not-a-hash" } },
      { ...f.input, source: { ...f.input.source, version: -1 } }
    ]) expect(historyCaptureSchema.safeParse(input).success).toBe(false);
    expect((await f.port.listDirectory(historyDirectory(f.scope)))).toEqual([]);
    await expect(f.service.readChapterHistory({ ...f.scope, fileName: "../other.md" })).rejects.toMatchObject({ code: "invalid" });
  });

  test("stale version or raw-file hash refuses capture without a conflict copy or chapter write", async () => {
    const f = await fixture();
    for (const source of [{ ...f.input.source, version: 99 }, { ...f.input.source, hash: "0".repeat(64) }]) {
      await expect(f.service.captureChapterHistory({ ...f.input, source })).rejects.toMatchObject({ code: "stale-source" });
    }
    expect((await f.service.listChapterHistory(f.scope)).records).toEqual([]);
    expect((await f.service.readBook(f.book.id)).chapters[0]?.hash).toBe(f.chapter.hash);
    expect(await f.port.listDirectory(toLibraryPath(["books", f.book.id, "conflicts"]))).toEqual([]);
  });

  test("an external source edit during capture is refused at the final read", async () => {
    const f = await fixture();
    const ensure = f.port.ensureDirectory.bind(f.port);
    const path = chapterPath(f.book.id, f.chapter.path);
    const before = await f.port.readFile(path);
    if (!before) throw new Error("Expected a chapter fixture");
    const changed = encoder.encode(decoder.decode(before.bytes).replace("A lamp.", "An outside edit."));
    f.port.ensureDirectory = async (directory) => {
      await ensure(directory);
      if (directory.includes("history")) await f.port.commitFile(path, changed, { kind: "any" });
    };
    await expect(f.service.captureChapterHistory(f.input)).rejects.toMatchObject({ code: "stale-source" });
    expect((await f.port.readFile(path))?.bytes).toEqual(changed);
    expect((await f.service.listChapterHistory(f.scope)).records).toEqual([]);
  });

  test("headerless chapters require a normal save for stable identity, not a history rewrite", async () => {
    const f = await fixture();
    const path = chapterPath(f.book.id, "0002-plain.md");
    const body = encoder.encode("Plain synthetic text\n");
    await f.port.commitFile(path, body, { kind: "absent" });
    const plain = (await f.service.readBook(f.book.id)).chapters.find((c) => c.path === "0002-plain.md");
    if (!plain) throw new Error("Expected a headerless fixture");
    await expect(f.service.captureChapterHistory({ ...f.input, chapterId: plain.id,
      source: { status: "saved", version: plain.version, hash: plain.hash } })).rejects.toMatchObject({ code: "saved-source-required" });
    expect((await f.port.readFile(path))?.bytes).toEqual(body);
  });

  test("missing, corrupt and future-schema sources are never captured", async () => {
    for (const replacement of [null, "---\nid: [broken\n---\ntext", "future"]) {
      const f = await fixture();
      const path = chapterPath(f.book.id, f.chapter.path);
      if (replacement === null) await f.port.removeFile(path);
      else {
        const snapshot = await f.port.readFile(path);
        if (!snapshot) throw new Error("Expected a chapter fixture");
        const raw = decoder.decode(snapshot.bytes);
        await f.port.commitFile(path, encoder.encode(replacement === "future" ? raw.replace("---\n", "---\nschemaVersion: 2\n") : replacement), { kind: "any" });
      }
      const before = await f.port.readFile(path);
      await expect(f.service.captureChapterHistory(f.input)).rejects.toBeDefined();
      expect(await f.port.readFile(path)).toEqual(before);
      expect((await f.service.listChapterHistory(f.scope)).records).toEqual([]);
    }
  });

  test("missing, foreign, corrupt and future-schema books refuse history writes", async () => {
    for (const bookChange of [null, "broken", "foreign", "future"]) {
      const f = await fixture();
      const path = bookFilePath(f.book.id);
      if (bookChange === null) await f.port.removeFile(path);
      else {
        const data = { ...f.book, ...(bookChange === "foreign" ? { id: "book_foreign1" } : { schemaVersion: 2 }) };
        await f.port.commitFile(path, encoder.encode(bookChange === "broken" ? "{" : JSON.stringify(data)), { kind: "any" });
      }
      await expect(f.service.captureChapterHistory(f.input)).rejects.toBeDefined();
      expect(await f.port.listDirectory(historyDirectory(f.scope))).toEqual([]);
    }
  });

  test("a book upgraded during capture is rechecked before publication", async () => {
    const f = await fixture();
    const ensure = f.port.ensureDirectory.bind(f.port);
    f.port.ensureDirectory = async (path) => {
      await ensure(path);
      if (path.includes("history")) await f.port.commitFile(bookFilePath(f.book.id),
        encoder.encode(JSON.stringify({ ...f.book, schemaVersion: 2 })), { kind: "any" });
    };
    await expect(f.service.captureChapterHistory(f.input)).rejects.toMatchObject({ code: "newer-schema" });
    expect(await f.port.listDirectory(historyDirectory(f.scope))).toEqual([]);
  });
});

describe("history codec and unavailable records", () => {
  test("unknown fields survive nested codec round-trips for snapshots, safety and each intent state", async () => {
    const f = await fixture();
    const snapshot = await f.service.captureChapterHistory(f.input);
    const safety = await f.service.captureChapterHistory({ ...f.input, label: "Before restoration" });
    const reference = (r: StoredHistoryRecord) => ({ fileName: r.fileName, id: r.meta.id, hash: r.hash, futureRef: { keep: [1, 2] } });
    for (const kind of ["snapshot", "safety", "intent"] as const) {
      for (const state of ["prepared", "applied", "undone"] as const) {
        const meta: HistoryMeta = historyMetaSchema.parse({
          ...snapshot.meta, id: "hist_other001", kind, future: { nested: ["kept", { blank: "line\n\n" }] },
          ...(kind === "intent" ? {
            bodyHash: await f.port.sha256(encoder.encode("")), state,
            selected: reference(snapshot), safety: reference(safety), intendedBodyHash: snapshot.meta.bodyHash,
            ...(state !== "prepared" ? { result: { version: 2, hash: "a".repeat(64), futureResult: true } } : {}),
            ...(state === "undone" ? { undoResult: { version: 3, hash: "b".repeat(64), futureUndo: "kept" } } : {})
          } : {})
        });
        const record = { meta, content: kind === "intent" ? "" : snapshot.content };
        const raw = await serializeHistoryRecord(record, f.port);
        expect(await parseHistoryRecord(raw, f.scope, f.port)).toEqual(record);
      }
    }
  });

  test("malformed provenance, wrong identity, future schema, invalid UTF-8 and bad body hashes remain visible issues", async () => {
    const f = await fixture();
    const good = await f.service.captureChapterHistory(f.input);
    const original = decoder.decode((await rawRecord(f.port, f.scope, good.fileName)).bytes);
    const mutations: Array<[string, Uint8Array, HistoryErrorCode]> = [
      ["body.md", encoder.encode(original.replace("A lamp.", "Damaged.")), "corrupt"],
      ["book.md", encoder.encode(original.replace(f.book.id, "book_foreign1")), "identity"],
      ["chapter.md", encoder.encode(original.replace(f.chapter.id, "ch_foreign1")), "identity"],
      ["future.md", encoder.encode(original.replace("schemaVersion: 1", "schemaVersion: 2")), "newer-schema"],
      ["version.md", encoder.encode(original.replace("sourceVersion: 1", "sourceVersion: -1")), "corrupt"],
      ["hash.md", encoder.encode(original.replace(good.meta.sourceHash, "not-a-hash")), "corrupt"],
      ["label.md", encoder.encode(original.replace("label: First draft", 'label: ""')), "corrupt"],
      ["time.md", encoder.encode(original.replace(good.meta.capturedAt, "2026-99-99T00:00:00.000Z")), "corrupt"],
      ["duplicate.md", encoder.encode(original.replace("schemaVersion: 1", "schemaVersion: 1\nschemaVersion: 1")), "corrupt"],
      ["invalid.md", encoder.encode("---\nlabel: [synthetic private text\n---\n"), "corrupt"],
      ["plain.md", encoder.encode("Not front matter"), "corrupt"],
      ["utf8.md", new Uint8Array([0xff, 0xff]), "corrupt"]
    ];
    for (const [fileName, bytes] of mutations) await f.port.commitFile(historyFilePath({ ...f.scope, fileName }), bytes, { kind: "absent" });
    const listing = await f.service.listChapterHistory(f.scope);
    expect(listing.records.map((r) => r.meta.id)).toEqual([good.meta.id]);
    expect(listing.issues).toHaveLength(mutations.length);
    for (const [fileName, bytes, code] of mutations) {
      const input = { ...f.scope, fileName };
      expect(listing.issues.find((i) => i.fileName === fileName)?.code).toBe(code);
      await expect(f.service.readChapterHistory(input)).rejects.toMatchObject({ code });
      await expect(f.service.compareChapterHistory(input)).rejects.toMatchObject({ code });
      expect((await rawRecord(f.port, f.scope, fileName)).bytes).toEqual(bytes);
    }
    expect(JSON.stringify(listing.issues)).not.toContain("synthetic private text");
    await expect(f.service.readChapterHistory({ ...f.scope, fileName: "missing.md" })).rejects.toMatchObject({ code: "not-found" });
    expect((await f.service.readChapter(f.book.id, f.chapter.id)).hash).toBe(f.chapter.hash);
  });

  test("invalid intent state/result combinations and nonempty intent bodies are refused", async () => {
    const f = await fixture();
    const captured = await f.service.captureChapterHistory(f.input);
    const base = { ...captured.meta, kind: "intent", id: "hist_intent01", state: "prepared",
      bodyHash: await f.port.sha256(encoder.encode("")), intendedBodyHash: captured.meta.bodyHash,
      selected: { fileName: captured.fileName, id: captured.meta.id, hash: captured.hash },
      safety: { fileName: "safety.md", id: "hist_safety01", hash: "a".repeat(64) }
    };
    for (const invalid of [
      { ...base, state: "unknown" }, { ...base, state: "applied" }, { ...base, state: "undone" },
      { ...base, result: { version: 2, hash: "a".repeat(64) } },
      { ...base, safety: base.selected }, { ...base, selected: { ...base.selected, fileName: "../escape.md" } }
    ]) expect(historyMetaSchema.safeParse(invalid).success).toBe(false);
    const meta = historyMetaSchema.parse(base);
    await expect(serializeHistoryRecord({ meta, content: captured.content }, f.port)).rejects.toMatchObject({ code: "corrupt" });
    const raw = await serializeHistoryRecord({ meta, content: "" }, f.port);
    await f.port.commitFile(historyFilePath({ ...f.scope, fileName: "intent.md" }), encoder.encode(raw), { kind: "absent" });
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(2);
    await expect(f.service.compareChapterHistory({ ...f.scope, fileName: "intent.md" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("history failure preservation and lifecycle", () => {
  test("history growth never prunes old snapshots, safety copies or prepared intents", async () => {
    const f = await fixture();
    const first = await f.service.captureChapterHistory(f.input);
    const safetyMeta = historyMetaSchema.parse({ ...first.meta, id: "hist_safety01", kind: "safety" });
    const safetyText = await serializeHistoryRecord({ meta: safetyMeta, content: first.content }, f.port);
    await f.port.commitFile(historyFilePath({ ...f.scope, fileName: "safety.md" }), encoder.encode(safetyText), { kind: "absent" });
    const intentMeta = historyMetaSchema.parse({
      ...first.meta, kind: "intent", id: "hist_intent01", state: "prepared",
      bodyHash: await f.port.sha256(encoder.encode("")), intendedBodyHash: first.meta.bodyHash,
      selected: { fileName: first.fileName, id: first.meta.id, hash: first.hash },
      safety: { fileName: "safety.md", id: safetyMeta.id, hash: await f.port.sha256(encoder.encode(safetyText)) }
    });
    const intentText = await serializeHistoryRecord({ meta: intentMeta, content: "" }, f.port);
    await f.port.commitFile(historyFilePath({ ...f.scope, fileName: "intent.md" }), encoder.encode(intentText), { kind: "absent" });
    for (let i = 0; i < 105; i++) await f.service.captureChapterHistory({ ...f.input, label: `Version ${i}` });
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(108);
    expect(await f.service.readChapterHistory(f.address(first))).toEqual(first);
    expect(decoder.decode((await rawRecord(f.port, f.scope, "safety.md")).bytes)).toBe(safetyText);
    expect(decoder.decode((await rawRecord(f.port, f.scope, "intent.md")).bytes)).toBe(intentText);
  });

  for (const code of ["storage-full", "permission-required", "read-only", "io"] as const) {
    test(`failed ${code} capture preserves the chapter and earlier history with no partial record`, async () => {
      const f = await fixture();
      const kept = await f.service.captureChapterHistory(f.input);
      const commit = f.port.commitFile.bind(f.port);
      f.port.commitFile = async (path, bytes, expected) => {
        if (path.includes("history")) throw new LibraryPortError(code, "Synthetic failure");
        return commit(path, bytes, expected);
      };
      await expect(f.service.captureChapterHistory({ ...f.input, label: "Will fail" })).rejects.toMatchObject({ code });
      expect((await f.service.listChapterHistory(f.scope)).records.map((r) => r.meta.id)).toEqual([kept.meta.id]);
      expect(await f.service.readChapterHistory(f.address(kept))).toEqual(kept);
      expect((await f.service.readChapter(f.book.id, f.chapter.id)).hash).toBe(f.chapter.hash);
    });
  }

  test("a collision does not overwrite corrupt bytes; mismatched write acknowledgment is not success", async () => {
    const f = await fixture();
    const fileName = "2026-10-24T00-00-00-000Z-first-draft.md";
    await f.port.commitFile(historyFilePath({ ...f.scope, fileName }), encoder.encode("Corrupt but precious"), { kind: "absent" });
    const record = await f.service.captureChapterHistory(f.input);
    expect(record.fileName).toEndWith("-2.md");
    expect(decoder.decode((await rawRecord(f.port, f.scope, fileName)).bytes)).toBe("Corrupt but precious");
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      return path.includes("history") && result.status === "written"
        ? { ...result, snapshot: { ...result.snapshot, bytes: encoder.encode("Different writer") } } : result;
    };
    await expect(f.service.captureChapterHistory({ ...f.input, label: "Uncertain" })).rejects.toMatchObject({ code: "io" });
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(2);
    expect((await f.service.readChapter(f.book.id, f.chapter.id)).hash).toBe(f.chapter.hash);
  });

  test("listing a vanished or unreadable record reports it without hiding healthy records", async () => {
    const f = await fixture();
    const good = await f.service.captureChapterHistory(f.input);
    const gone = await f.service.captureChapterHistory({ ...f.input, label: "Gone" });
    const read = f.port.readFile.bind(f.port);
    f.port.readFile = async (path) => path.at(-1) === gone.fileName ? null : read(path);
    expect((await f.service.listChapterHistory(f.scope)).issues).toMatchObject([{ code: "not-found", fileName: gone.fileName }]);
    f.port.readFile = async (path) => {
      if (path.at(-1) === gone.fileName) throw new LibraryPortError("permission-required", "Synthetic permission loss");
      return read(path);
    };
    const listing = await f.service.listChapterHistory(f.scope);
    expect(listing.issues).toMatchObject([{ code: "io", fileName: gone.fileName }]);
    expect(listing.records[0]?.meta.id).toBe(good.meta.id);
  });

  test("stable history identity follows title/filename/order changes and chapter trash/restore", async () => {
    const f = await fixture();
    const record = await f.service.captureChapterHistory(f.input);
    await f.service.createChapter(f.book.id, { title: "Second", content: "Second" });
    await f.service.updateChapterMeta(f.book.id, f.chapter.id, { title: "Renamed" }, { baseVersion: f.chapter.version, baseHash: f.chapter.hash });
    await f.service.moveChapterTo(f.book.id, f.chapter.id, 1);
    await f.port.moveFile(chapterPath(f.book.id, f.chapter.path), chapterPath(f.book.id, "0099-external-rename.md"));
    expect((await f.service.compareChapterHistory(f.address(record))).equal).toBe(true);
    const deleted = await f.service.deleteChapter(f.book.id, f.chapter.id);
    expect(await f.service.readChapterHistory(f.address(record))).toEqual(record);
    expect((await f.service.listChapterHistory(f.scope)).records).toHaveLength(1);
    await expect(f.service.compareChapterHistory(f.address(record))).rejects.toMatchObject({ code: "not-found" });
    await expect(f.service.captureChapterHistory(f.input)).rejects.toMatchObject({ code: "not-found" });
    await f.service.restoreChapter(f.book.id, f.chapter.id, deleted.trashedAt);
    expect((await f.service.compareChapterHistory(f.address(record))).equal).toBe(true);
    expect(await f.service.readChapterHistory(f.address(record))).toEqual(record);
  });

  test("archive import/export and whole-book trash/restore retain record bytes, identity and hashes", async () => {
    const f = await fixture();
    const record = await f.service.captureChapterHistory(f.input);
    const original = await rawRecord(f.port, f.scope, record.fileName);
    await f.service.deleteBook(f.book.id);
    const trash = toLibraryPath([".studio", "trash", "books"]);
    const entry = (await f.port.listDirectory(trash))[0];
    if (!entry) throw new Error("Expected a trashed book fixture");
    const archive = await createLibraryArchive({ storage: f.port, runtime: f.port }, { appVersion: "test" });
    const historyEntry = archive.manifest.entries.find((e) => e.path.endsWith(`/history/${f.chapter.id}/${record.fileName}`));
    if (!historyEntry) throw new Error("Expected history in the archive manifest");
    expect(historyEntry.sha256).toBe(record.hash);
    expect(historyEntry.path).toStartWith(".studio/trash/books/");
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.chunks) chunks.push(chunk);
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const target = new InMemoryLibraryPort();
    await importLibraryArchive(archiveSourceFromBytes(bytes), target, target);
    await target.moveDirectory(toLibraryPath([...trash, entry.name]), bookPath(f.book.id));
    const restored = await LibraryService.open({ storage: target, runtime: target });
    expect((await rawRecord(target, f.scope, record.fileName)).bytes).toEqual(original.bytes);
    expect(await restored.readChapterHistory(f.address(record))).toEqual(record);
    expect((await restored.compareChapterHistory(f.address(record))).equal).toBe(true);
  });

  test("live-book archives preserve unknown fields and unavailable future records byte for byte", async () => {
    const f = await fixture();
    const record = await f.service.captureChapterHistory(f.input);
    const raw = await serializeHistoryRecord({ ...record, meta: { ...record.meta, futureField: { keep: "yes" } } }, f.port);
    await f.port.commitFile(historyFilePath(f.address(record)), encoder.encode(raw), { kind: "any" });
    const future = raw.replace("schemaVersion: 1", "schemaVersion: 2");
    await f.port.commitFile(historyFilePath({ ...f.scope, fileName: "future.md" }), encoder.encode(future), { kind: "absent" });
    const archive = await createLibraryArchive({ storage: f.port, runtime: f.port }, { appVersion: "test" });
    const chunks: Uint8Array[] = [];
    for await (const chunk of archive.chunks) chunks.push(chunk);
    const target = new InMemoryLibraryPort();
    await importLibraryArchive(archiveSourceFromBytes(new Uint8Array(Buffer.concat(chunks))), target, target);
    const imported = await LibraryService.open({ storage: target, runtime: target });
    expect((await imported.readChapterHistory(f.address(record))).meta.futureField).toEqual({ keep: "yes" });
    expect((await imported.listChapterHistory(f.scope)).issues).toMatchObject([{ fileName: "future.md", code: "newer-schema" }]);
    expect(decoder.decode((await rawRecord(target, f.scope, "future.md")).bytes)).toBe(future);
  });
});
