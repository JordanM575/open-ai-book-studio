import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { chapterPath } from "../src/library/paths";
import { toLibraryPath, type LibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 028 T007: saving over a chapter whose file is present but unreadable
 * (an online-only placeholder) must never overwrite blindly and never fail
 * with a raw error. The author's text is preserved as a conflict copy with the
 * placeholder reason, and the existing conflict UI offers the choices.
 */
class UnreadableChapterPort extends InMemoryLibraryPort {
  failReads = false;

  override async readFile(target: LibraryPath) {
    const path = target.join("/");
    if (this.failReads && path.includes("/chapters/") && path.endsWith(".md")) {
      throw new Error("EIO: input/output error");
    }
    return super.readFile(target);
  }
}

async function openService(port: UnreadableChapterPort = new UnreadableChapterPort()) {
  return { port, service: await LibraryService.open({ storage: port, runtime: port }) };
}

describe("saving over an unreadable chapter", () => {
  test("a blocked save preserves the author's text as a placeholder conflict copy", async () => {
    const { port, service } = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt on the floor.\n" });
    const [firstChapter] = (await service.readBook(book.id)).chapters;
    if (!firstChapter) throw new Error("Fixture book has no chapters.");
    const fileName = firstChapter.path;
    const before = await port.readFile(chapterPath(book.id, fileName));
    port.failReads = true;

    const result = await service.saveChapter(book.id, chapter.id, "New words.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    if (result.status !== "conflict") throw new Error(`Expected a conflict, got ${result.status}.`);
    expect(result.conflict.reason).toBe("placeholder");
    expect(result.conflict.chapterId).toBe(chapter.id);
    expect(result.conflict.savedAs).toContain("conflict-placeholder");
    expect(result.conflict.chapterTitle.length).toBeGreaterThan(0);

    port.failReads = false;
    const after = await port.readFile(chapterPath(book.id, fileName));
    expect(after?.bytes).toEqual(before?.bytes);

    const names: string[] = [];
    for (const entry of await port.listDirectory(toLibraryPath(["books", book.id, "conflicts"]))) {
      if (entry.kind === "file") names.push(entry.name);
    }
    const copies = names.filter((name) => name.includes("conflict-placeholder"));
    expect(copies).toHaveLength(1);
    const [copyName] = copies;
    if (!copyName) throw new Error("Expected one placeholder conflict copy.");
    const copy = await port.readFile(toLibraryPath(["books", book.id, "conflicts", copyName]));
    expect(new TextDecoder().decode(copy?.bytes)).toContain("New words.");
  });

  test("a readable chapter still saves normally", async () => {
    const { service } = await openService();
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Salt on the floor.\n" });

    const result = await service.saveChapter(book.id, chapter.id, "New words.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(result.status).toBe("saved");
  });
});
