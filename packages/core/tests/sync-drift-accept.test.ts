import { describe, expect, test } from "bun:test";
import { ThreadStore } from "../src/agent/threads";
import { LibraryService } from "../src/library/service";
import { toLibraryPath } from "../src/library/path";
import { acceptDriftPaths } from "../src/sync/journal";
import { journalForScan } from "../src/sync/journal";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const NOW = "2026-11-03T12:00:00.000Z";

async function openService(port: InMemoryLibraryPort = new InMemoryLibraryPort()) {
  return LibraryService.open({ storage: port, runtime: port });
}

function file(path: string, sha256: string, extra: Record<string, unknown> = {}) {
  return { path, sha256, size: 10, ...extra };
}

describe("acceptDriftPaths", () => {
  test("an immediate restart recognizes an atomic save if the post-save journal note was interrupted", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const created = await service.createChapter(book.id, { content: "The tide was out.\n" });
    const chapter = await service.readChapter(book.id, created.id);
    await service.acceptDrift([]);

    const commit = port.commitFile.bind(port);
    let chapterCommitted = false;
    port.commitFile = async (path, bytes, expected) => {
      if (chapterCommitted && path[0] === ".studio" && path[1] === "sync") {
        throw new Error("simulated process loss before the post-save journal note");
      }
      const result = await commit(path, bytes, expected);
      if (path[0] === "books" && path.includes("chapters")) chapterCommitted = true;
      return result;
    };

    const saved = await service.saveChapter(book.id, created.id, "The tide was out, and the road showed.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(saved.status).toBe("saved");

    // A new service instance models the next review call after an immediate app restart.
    const restarted = await openService(port);
    const report = await restarted.checkDrift();
    expect(report.clean).toBe(true);
    expect(report.entries).toEqual([expect.objectContaining({ kind: "local-changed" })]);
  });

  test("accepting one path leaves the rest of the baseline untouched", () => {
    const previous = journalForScan({
      deviceId: "device_accept0001",
      previous: null,
      files: [file("books/book_a/chapters/0001-one.md", "a1"), file("books/book_a/chapters/0002-two.md", "b2")],
      now: NOW
    });
    const changed = [
      file("books/book_a/chapters/0001-one.md", "a9"),
      file("books/book_a/chapters/0002-two.md", "b2")
    ];
    const next = acceptDriftPaths({
      deviceId: "device_accept0001",
      previous,
      files: changed,
      accept: ["books/book_a/chapters/0001-one.md"],
      now: NOW
    });
    expect(next.generation).toBe(previous.generation + 1);
    expect(next.files["books/book_a/chapters/0001-one.md"]?.sha256).toBe("a9");
    expect(next.files["books/book_a/chapters/0001-one.md"]?.deleted).toBeUndefined();
    expect(next.files["books/book_a/chapters/0002-two.md"]).toEqual(previous.files["books/book_a/chapters/0002-two.md"]);
  });

  test("an accepted path that is gone becomes a tombstone; unknowns are ignored", () => {
    const previous = journalForScan({
      deviceId: "device_accept0002",
      previous: null,
      files: [file("books/book_a/chapters/0001-one.md", "a1")],
      now: NOW
    });
    const next = acceptDriftPaths({
      deviceId: "device_accept0002",
      previous,
      files: [],
      accept: ["books/book_a/chapters/0001-one.md", "books/book_a/chapters/never-seen.md"],
      now: NOW
    });
    expect(next.files["books/book_a/chapters/0001-one.md"]?.deleted).toBe(true);
    expect(next.files["books/book_a/chapters/never-seen.md"]).toBeUndefined();
  });

  test("an empty accept returns the previous journal unchanged", () => {
    const previous = journalForScan({
      deviceId: "device_accept0003",
      previous: null,
      files: [file("books/book_a/chapters/0001-one.md", "a1")],
      now: NOW
    });
    expect(
      acceptDriftPaths({ deviceId: "device_accept0003", previous, files: [], accept: [], now: NOW })
    ).toBe(previous);
  });

  test("with no previous journal the first accept builds the baseline", () => {
    const files = [file("books/book_a/chapters/0001-one.md", "a1")];
    const next = acceptDriftPaths({ deviceId: "device_accept0004", previous: null, files, accept: [], now: NOW });
    expect(next.generation).toBe(1);
    expect(next.files["books/book_a/chapters/0001-one.md"]?.sha256).toBe("a1");
  });
});

describe("LibraryService.establishBaseline", () => {
  test("a fresh library gets its first baseline; a second call writes nothing", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    await service.createChapter(book.id, {});

    expect(await service.establishBaseline()).toBe(true);
    expect(await service.establishBaseline()).toBe(false);

    const report = await service.checkDrift();
    expect(report.clean).toBe(true);
    expect(report.warning).toBeUndefined();
  });

  test("a corrupt journal is left alone for the author to rebuild", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    await service.createBook({ title: "The Salt Road" });
    const journalPath = toLibraryPath([".studio", "sync", `${service.deviceId}.json`]);
    await port.commitFile(journalPath, encoder.encode("not json{"), { kind: "any" });

    expect(await service.establishBaseline()).toBe(false);
    const raw = await port.readFile(journalPath);
    if (!raw) throw new Error("The corrupt journal should still be on disk.");
    expect(new TextDecoder().decode(raw.bytes)).toBe("not json{");
  });
});

describe("LibraryService.checkDrift and acceptDrift", () => {
  test("a fresh library reports only the missing baseline", async () => {
    const service = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    await service.createChapter(book.id, {});

    const report = await service.checkDrift();
    expect(report.clean).toBe(true);
    expect(report.warning).toMatch(/no sync baseline/i);
  });

  test("this device's own save never reports as an outside edit", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const created = await service.createChapter(book.id, {});
    await service.acceptDrift([]);

    const saved = await service.saveChapter(book.id, created.id, "# New text.\n", {
      baseVersion: created.version,
      baseHash: created.hash
    });
    expect(saved.status).toBe("saved");

    const report = await service.checkDrift();
    expect(report.entries.filter((entry) => entry.kind === "remote-changed")).toEqual([]);
    expect(report.clean).toBe(true);
  });

  /** An outside edit keeps the chapter's front matter, so its identity survives. */
  async function outsideEdit(port: InMemoryLibraryPort, bookId: string, fileName: string): Promise<void> {
    const target = toLibraryPath(["books", bookId, "chapters", fileName]);
    const before = await port.readFile(target);
    if (!before) throw new Error(`Missing fixture file ${target.join("/")}.`);
    const raw = new TextDecoder().decode(before.bytes);
    const bodyAt = raw.indexOf("---", 3);
    const head = bodyAt === -1 ? raw : raw.slice(0, bodyAt + 3);
    await port.commitFile(target, encoder.encode(`${head}\nAn outside line.\n`), { kind: "any" });
  }

  test("an outside edit reports remote-changed until it is accepted", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const created = await service.createChapter(book.id, {});
    const chapter = await service.readChapter(book.id, created.id);
    await service.acceptDrift([]);

    await outsideEdit(port, book.id, chapter.path);

    const dirty = await service.checkDrift();
    expect(dirty.clean).toBe(false);
    expect(dirty.entries.map((entry) => entry.kind)).toContain("remote-changed");

    const accepted = await service.acceptDrift(dirty.entries.map((entry) => entry.path));
    expect(accepted.clean).toBe(true);
    expect((await service.checkDrift()).clean).toBe(true);
  });

  test("unsaved editor text turns an outside edit into both-changed", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const created = await service.createChapter(book.id, {});
    const chapter = await service.readChapter(book.id, created.id);
    await service.acceptDrift([]);

    await outsideEdit(port, book.id, chapter.path);

    const report = await service.checkDrift([created.id]);
    expect(report.entries.map((entry) => entry.kind)).toContain("both-changed");
    expect(report.clean).toBe(false);
  });

  test("this device's trash move leaves no remote entries behind", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const created = await service.createChapter(book.id, {});
    await service.acceptDrift([]);

    await service.deleteChapter(book.id, created.id);

    const report = await service.checkDrift();
    expect(report.clean).toBe(true);
  });

  test("this device's agent turn does not report as an outside edit", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    await service.acceptDrift([]);

    const threads = new ThreadStore(port, port);
    await threads.create(book.id, "First turn", []);

    const report = await service.checkDrift();
    const remote = report.entries.filter((entry) => entry.kind === "remote-changed");
    expect(remote).toEqual([]);
  });
});
