import { describe, expect, test } from "bun:test";
import { bookFilePath, chapterPath, chaptersPath } from "../../src/library/paths";
import { toLibraryPath, libraryPathFromArchivePath } from "../../src/library/path";
import { GoalService } from "../../src/organization/goals";
import { SidecarWriteError } from "../../src/planning/checked-sidecar";
import { countWords } from "../../src/words";
import { envelope, fixture } from "../planning/fixture";

describe("checked goals and verified saved progress", () => {
  test("invalid source UTF-8 is unavailable, while a real replacement character remains countable", async () => {
    const f = await fixture();
    const chapter = await f.library.createChapter(f.book.id, { title: "Saved", content: "One two �" });
    const path = chapterPath(f.book.id, chapter.path);
    const before = await f.port.readFile(path);
    if (!before) throw new Error("Missing source");
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 3 });
    const invalid = new Uint8Array([...before.bytes, 0x20, 0xff]);
    await f.port.commitFile(path, invalid, { kind: "any" });
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
    expect((await f.port.readFile(path))?.bytes).toEqual(invalid);
    expect(f.commits).toHaveLength(0);
  });

  test("a syntactically valid false raw source hash cannot confirm progress", async () => {
    const f = await fixture();
    await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
    const read = f.port.readFile.bind(f.port);
    f.port.readFile = async (path) => {
      const snapshot = await read(path);
      return snapshot && path.includes("chapters") ? { ...snapshot, sha256: "f".repeat(64) } : snapshot;
    };
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
    expect(f.commits).toHaveLength(0);
  });

  test.each(["body", "id", "version"] as const)("two matching host reads cannot misattribute raw source %s", async (field) => {
    const f = await fixture();
    await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
    const saved = await f.library.readBook(f.book.id);
    const chapter = saved.chapters[0];
    if (!chapter) throw new Error("Missing source");
    if (field === "body") chapter.content = "One two three\n";
    if (field === "id") chapter.id = "ch_foreign0001";
    if (field === "version") chapter.version += 1;
    f.host.readSavedBook = async () => saved;
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
    expect(f.commits).toHaveLength(0);
  });

  test("raw changes after enumeration and before the second verification cannot confirm an old count", async () => {
    const f = await fixture();
    const chapter = await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
    const saved = await f.library.readBook(f.book.id);
    let reads = 0;
    f.host.readSavedBook = async () => {
      if (++reads === 2) await f.writeRaw(chapterPath(f.book.id, chapter.path), "Changed external body");
      return saved;
    };
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
    expect(f.commits).toHaveLength(0);
  });

  test("headerless saved text remains countable using canonical body normalization", async () => {
    const f = await fixture();
    await f.writeRaw(toLibraryPath([...chaptersPath(f.book.id), "0001-legacy.md"]), "\r\nOne two\r\nthree\r\n");
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 3 });
    expect(f.commits).toHaveLength(0);
  });

  test("absent clear is lazy; target set/read/no-op/clear roundtrip preserves unknown fields", async () => {
    const f = await fixture();
    const before = await f.raw(bookFilePath(f.book.id));
    const absent = await f.goals.read(f.book.id);
    expect((await f.goals.save({ ...envelope(absent), draft: { kind: "set-goal", targetWords: null } })).status).toBe("unchanged");
    expect(f.commits).toHaveLength(0);
    expect(f.layouts).toHaveLength(0);
    await f.goals.save({ ...envelope(absent), draft: { kind: "set-goal", targetWords: 50_000 } });
    const saved = await new GoalService(f.host).read(f.book.id);
    expect(saved.data).toMatchObject({ revision: 1, targetWords: 50_000 });
    expect((await f.goals.save({ ...envelope(saved), draft: { kind: "set-goal", targetWords: 50_000 } })).status).toBe("unchanged");
    expect(f.commits).toHaveLength(1);
    await f.writeRaw(f.goalPath, { ...saved.data, future: { literal: "  界\r\n " } });
    const current = await f.goals.read(f.book.id);
    await f.goals.save({ ...envelope(current), draft: { kind: "set-goal", targetWords: null } });
    expect((await f.goals.read(f.book.id)).data).toMatchObject({ revision: 2, targetWords: null, future: { literal: "  界\r\n " } });
    expect(await f.raw(bookFilePath(f.book.id))).toBe(before);
  });

  test("goal bounds accept safe maximum and reject unsupported numeric targets", async () => {
    const f = await fixture();
    const read = await f.goals.read(f.book.id);
    for (const targetWords of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      expect(() => f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords } })).toThrow();
    }
    await f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords: Number.MAX_SAFE_INTEGER } });
    expect((await f.goals.read(f.book.id)).data?.targetWords).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("failed clear keeps the old target; stale clear keeps a full goal copy", async () => {
    const f = await fixture();
    const read = await f.goals.read(f.book.id);
    await f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords: 10 } });
    const saved = await f.goals.read(f.book.id);
    const commit = f.host.commitFile;
    f.host.commitFile = async () => { throw new Error("synthetic storage full"); };
    await expect(f.goals.save({ ...envelope(saved), draft: { kind: "set-goal", targetWords: null } })).rejects.toBeInstanceOf(SidecarWriteError);
    expect((await f.goals.read(f.book.id)).data?.targetWords).toBe(10);
    f.host.commitFile = commit;
    await f.goals.save({ ...envelope(saved), draft: { kind: "set-goal", targetWords: 20 } });
    const result = await f.goals.save({ ...envelope(saved), draft: { kind: "set-goal", targetWords: null } });
    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") throw new Error("Expected conflict");
    expect(JSON.parse(await f.raw(libraryPathFromArchivePath(result.savedAs)))).toMatchObject({ schemaVersion: 1, bookId: f.book.id, targetWords: null, revision: 2 });
    expect((await f.goals.read(f.book.id)).data?.targetWords).toBe(20);
  });

  test("stale absent-clear does not clear a goal another writer created", async () => {
    const f = await fixture();
    const read = await f.goals.read(f.book.id);
    await f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords: 10 } });
    expect((await f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords: null } })).status).toBe("conflict");
    expect((await f.goals.read(f.book.id)).data?.targetWords).toBe(10);
  });

  test("saved progress uses the shared counter, ignores cached wordCount, and floors remaining at zero", async () => {
    const f = await fixture();
    await f.library.createChapter(f.book.id, { title: "Words", content: "One two\nthree 😀" });
    const read = await f.goals.read(f.book.id);
    await f.goals.save({ ...envelope(read), draft: { kind: "set-goal", targetWords: 5 } });
    const savedRead = f.host.readSavedBook;
    f.host.readSavedBook = async (id) => {
      const saved = await savedRead(id);
      saved.chapters.forEach((chapter) => { chapter.wordCount = 9999; });
      return saved;
    };
    expect(await f.goals.progress(f.book.id)).toEqual({ status: "complete", bookId: f.book.id, targetWords: 5, savedWords: countWords("One two\nthree 😀"), remaining: 1 });
    for (const targetWords of [4, 3]) {
      const current = await f.goals.read(f.book.id);
      await f.goals.save({ ...envelope(current), draft: { kind: "set-goal", targetWords } });
      expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 4, remaining: 0 });
    }
  });

  test("zero chapters is a complete zero, distinct from an unreadable book", async () => {
    const f = await fixture();
    expect(await f.goals.progress(f.book.id)).toEqual({ status: "complete", bookId: f.book.id, targetWords: null, savedWords: 0, remaining: null });
    await f.port.removeFile(bookFilePath(f.book.id));
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
  });

  test("only an actual saved chapter advances progress; conflicting and failed drafts never count", async () => {
    const f = await fixture();
    const chapter = await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
    const base = { baseVersion: chapter.version, baseHash: chapter.hash };
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 2 });
    const saved = await f.library.saveChapter(f.book.id, chapter.id, "One two three", base);
    expect(saved.status).toBe("saved");
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 3 });
    const conflict = await f.library.saveChapter(f.book.id, chapter.id, "Unsaved conflicting draft has many more words", base);
    expect(conflict.status).toBe("conflict");
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 3 });
    const current = await f.library.readChapter(f.book.id, chapter.id);
    const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = async (path, bytes, expected) => {
      if (path.includes("chapters")) throw new Error("synthetic full storage");
      return commit(path, bytes, expected);
    };
    await expect(f.library.saveChapter(f.book.id, chapter.id, "Failed draft has even more unsaved words here", {
      baseVersion: current.version, baseHash: current.hash
    })).rejects.toThrow("full storage");
    expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "complete", savedWords: 3 });
  });

  test("unreadable saved chapters yield incomplete without a false saved total or remaining", async () => {
    const f = await fixture();
    await f.library.createChapter(f.book.id, { title: "Readable", content: "Two words" });
    await f.writeRaw(toLibraryPath([...chaptersPath(f.book.id), "0002-broken.md"]), "---\nid: [unterminated\n---\nNot countable");
    const result = await f.goals.progress(f.book.id);
    expect(result).toEqual({ status: "incomplete", bookId: f.book.id, targetWords: null, unreadableChapters: 1 });
    expect(result).not.toHaveProperty("savedWords");
    expect(result).not.toHaveProperty("remaining");
  });

  for (const change of ["hash", "version", "body", "path", "enumeration", "issues", "goal"] as const) {
    test(`mid-scan ${change} change cannot produce a confirmed total`, async () => {
      const f = await fixture();
      await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
      const saved = await f.library.readBook(f.book.id);
      let calls = 0;
      f.host.readSavedBook = async () => {
        calls += 1;
        const value = structuredClone(saved);
        const chapter = value.chapters[0];
        if (!chapter) throw new Error("Missing synthetic chapter");
        if (calls === 2) {
          if (change === "hash") chapter.hash = "f".repeat(64);
          if (change === "version") chapter.version += 1;
          if (change === "body") chapter.content += " unseen";
          if (change === "path") chapter.path = "renamed.md";
          if (change === "enumeration") value.chapters = [];
          if (change === "issues") value.chapterReadIssues = [{ fileName: "new.md", order: 2, reason: "unreadable" }];
          if (change === "goal") await f.writeRaw(f.goalPath, { schemaVersion: 1, bookId: f.book.id, revision: 1, targetWords: 100 });
        }
        return value;
      };
      expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "changed" });
      expect(calls).toBe(2);
      expect(f.commits).toHaveLength(0);
    });
  }

  for (const fault of ["book-id", "chapter-id", "duplicate-id", "duplicate-path", "hash", "read-error"] as const) {
    test(`unverifiable ${fault} yields unavailable saved progress`, async () => {
      const f = await fixture();
      await f.library.createChapter(f.book.id, { title: "Saved", content: "One two" });
      const savedRead = f.host.readSavedBook;
      f.host.readSavedBook = async (id) => {
        const saved = await savedRead(id);
        const chapter = saved.chapters[0];
        if (!chapter) throw new Error("Missing synthetic chapter");
        if (fault === "book-id") saved.book.id = f.other.id;
        if (fault === "chapter-id") chapter.id = "book_notachapter";
        if (fault === "duplicate-id") saved.chapters.push({ ...chapter, path: "other.md" });
        if (fault === "duplicate-path") saved.chapters.push({ ...chapter, id: "ch_otherid" });
        if (fault === "hash") chapter.hash = "bad-hash";
        if (fault === "read-error") throw new Error("synthetic read error");
        return saved;
      };
      expect(await f.goals.progress(f.book.id)).toMatchObject({ status: "unavailable", reason: "unreadable" });
    });
  }

  test("goal overflow and foreign-owner files refuse without overwriting", async () => {
    const f = await fixture();
    await f.writeRaw(f.goalPath, { schemaVersion: 1, bookId: f.book.id, revision: Number.MAX_SAFE_INTEGER, targetWords: 10 });
    const current = await f.goals.read(f.book.id);
    await expect(f.goals.save({ ...envelope(current), draft: { kind: "set-goal", targetWords: 11 } })).rejects.toThrow("revision");
    await f.writeRaw(f.goalPath, { schemaVersion: 1, bookId: f.other.id, revision: 1, targetWords: 10 });
    await expect(f.goals.save({ ...envelope(current), draft: { kind: "set-goal", targetWords: null } })).rejects.toThrow("different book");
    expect(f.commits).toHaveLength(0);
  });
});
