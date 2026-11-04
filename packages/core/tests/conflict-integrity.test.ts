import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { bookFilePath, chapterPath, conflictsPath } from "../src/library/paths";
import { matterHash, NO_MATTER } from "../src/matter";
import type { LibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class TestPort extends InMemoryLibraryPort {
  unreadable = false;
  override async readFile(path: LibraryPath) {
    if (this.unreadable && path.includes("chapters")) throw new Error("unreadable");
    return super.readFile(path);
  }
}

async function setup() {
  const port = new TestPort(); // fixed clock and device
  const service = await LibraryService.open({ storage: port, runtime: port });
  const book = await service.createBook({ title: "Original" });
  return { port, service, book };
}

describe("conflict copy integrity", () => {
  test("same-time stale matter saves keep distinct intents and an occupied sentinel", async () => {
    const { port, service, book } = await setup();
    const expected = { baseVersion: 0, baseHash: await matterHash(null) };
    await service.saveMatter(book.id, { ...NO_MATTER, author: "disk" }, expected);
    const name = "front-and-back-matter.conflict-newer-version.device_test000001.2026-10-24T00-00-00-000Z.json";
    const sentinel = [...conflictsPath(book.id), name];
    await port.commitFile(sentinel, encoder.encode("sentinel"), { kind: "absent" });
    const first = await service.saveMatter(book.id, { ...NO_MATTER, author: "first" }, expected);
    const second = await service.saveMatter(book.id, { ...NO_MATTER, author: "second" }, expected);
    if (first.status !== "conflict" || second.status !== "conflict") throw new Error("Expected conflicts");
    expect(first.savedAs).not.toBe(second.savedAs);
    expect(decoder.decode((await port.readFile(sentinel))?.bytes)).toBe("sentinel");
    for (const [result, author] of [[first, "first"], [second, "second"]] as const) {
      const raw = await port.readFile(result.savedAs.split("/"));
      expect(JSON.parse(decoder.decode(raw?.bytes)).matter.author).toBe(author);
    }
  });

  for (const mode of ["changed", "throw"] as const) {
    test(`copy ${mode} never claims success and leaves caller intent available`, async () => {
      const { port, service, book } = await setup();
      const expected = { baseVersion: 0, baseHash: await matterHash(null) };
      await service.saveMatter(book.id, { ...NO_MATTER, author: "disk" }, expected);
      const before = await port.readFile(bookFilePath(book.id));
      const intent = { ...NO_MATTER, author: "unsaved intent" };
      const commit = port.commitFile.bind(port);
      let attempts = 0;
      port.commitFile = async (path, bytes, expectation) => {
        if (path.includes("conflicts")) {
          attempts++;
          if (mode === "throw") throw new Error("injected copy failure");
          return { status: "changed", current: null };
        }
        return commit(path, bytes, expectation);
      };
      await expect(service.saveMatter(book.id, intent, expected)).rejects.toThrow();
      expect(attempts).toBe(mode === "changed" ? 100 : 1);
      expect(intent.author).toBe("unsaved intent");
      expect((await port.readFile(bookFilePath(book.id)))?.bytes).toEqual(before?.bytes);
      expect(await port.listDirectory(conflictsPath(book.id))).toEqual([]);
    });
  }

  for (const unreadable of [false, true]) {
    test(`chapter conflicts retain both intents when ${unreadable ? "unreadable" : "stale"}`, async () => {
      const { port, service, book } = await setup();
      const chapter = await service.createChapter(book.id, { title: "Door", content: "original" });
      const expected = { baseVersion: chapter.version, baseHash: chapter.hash };
      if (!unreadable) await service.saveChapter(book.id, chapter.id, "disk", expected);
      const before = await port.readFile(chapterPath(book.id, chapter.path));
      port.unreadable = unreadable;
      const first = await service.saveChapter(book.id, chapter.id, "first intent", expected);
      const second = await service.saveChapter(book.id, chapter.id, "second intent", expected);
      if (first.status !== "conflict" || second.status !== "conflict") throw new Error("Expected conflicts");
      expect(first.conflict.savedAs).not.toBe(second.conflict.savedAs);
      expect(decoder.decode((await port.readFile(first.conflict.savedAs.split("/")))?.bytes)).toContain("first intent");
      expect(decoder.decode((await port.readFile(second.conflict.savedAs.split("/")))?.bytes)).toContain("second intent");
      port.unreadable = false;
      expect((await port.readFile(chapterPath(book.id, chapter.path)))?.bytes).toEqual(before?.bytes);
    });

    test(`chapter ${unreadable ? "placeholder" : "stale"} copy rejection does not report a saved path`, async () => {
      const { port, service, book } = await setup();
      const chapter = await service.createChapter(book.id, { title: "Door", content: "original" });
      const expected = { baseVersion: chapter.version, baseHash: chapter.hash };
      if (!unreadable) await service.saveChapter(book.id, chapter.id, "disk", expected);
      const before = await port.readFile(chapterPath(book.id, chapter.path));
      const commit = port.commitFile.bind(port);
      let attempts = 0;
      port.commitFile = async (path, bytes, expectation) => {
        if (path.includes("conflicts")) {
          attempts++;
          return { status: "changed", current: null };
        }
        return commit(path, bytes, expectation);
      };
      port.unreadable = unreadable;
      const intent = "chapter intent";
      await expect(service.saveChapter(book.id, chapter.id, intent, expected)).rejects.toThrow("Could not keep a conflict copy");
      expect(attempts).toBe(100);
      expect(intent).toBe("chapter intent");
      port.unreadable = false;
      expect((await port.readFile(chapterPath(book.id, chapter.path)))?.bytes).toEqual(before?.bytes);
    });
  }

  test("metadata update refuses an outside edit before the port expectation check", async () => {
    const { port, service, book } = await setup();
    const path = bookFilePath(book.id);
    const before = await port.readFile(path);
    const outside = encoder.encode(`${JSON.stringify({ ...book, title: "Outside" })}\n`);
    const commit = port.commitFile.bind(port);
    let expectationKind = "";
    port.commitFile = async (target, bytes, expected) => {
      if (target.join("/") === path.join("/")) {
        expectationKind = expected.kind;
        await commit(path, outside, { kind: "any" });
      }
      return commit(target, bytes, expected);
    };
    const patch = { title: "Author intent" };
    await expect(service.updateBook(book.id, patch)).rejects.toThrow();
    expect(expectationKind).toBe("sha256");
    expect(before?.bytes).not.toEqual(outside);
    expect((await port.readFile(path))?.bytes).toEqual(outside);
    expect(patch.title).toBe("Author intent");
  });

  test("a written result with different readback bytes is not reported as a saved conflict copy", async () => {
    const { port, service, book } = await setup();
    const expected = { baseVersion: 0, baseHash: await matterHash(null) };
    await service.saveMatter(book.id, { ...NO_MATTER, author: "disk" }, expected);
    const commit = port.commitFile.bind(port);
    port.commitFile = async (path, bytes, expectation) => {
      if (path.includes("conflicts")) return commit(path, encoder.encode("outside replacement"), expectation);
      return commit(path, bytes, expectation);
    };
    await expect(service.saveMatter(book.id, { ...NO_MATTER, author: "intent" }, expected)).rejects.toThrow("could not be verified");
    const copies = await port.listDirectory(conflictsPath(book.id));
    expect(copies).toHaveLength(1);
    expect(decoder.decode((await port.readFile([...conflictsPath(book.id), copies[0]!.name]))?.bytes)).toBe("outside replacement");
    expect((await service.readBook(book.id)).book.matter?.author).toBe("disk");
  });
});
