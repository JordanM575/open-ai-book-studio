import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { chapterPath } from "../src/library/paths";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Damaged-file isolation at the library-open path (spec 012 T008). A
 * truncated or malformed chapter file fails alone: the rest of the book stays
 * readable, the affected file is reported with a stable reason, and the book
 * keeps working.
 */

async function openLibrary() {
  const port = new InMemoryLibraryPort();
  const service = await LibraryService.open({ storage: port, runtime: port });
  return { port, service };
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("damaged-file isolation", () => {
  test("malformed chapter files fail alone and are reported per file", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Isolation" });
    const good = await service.createChapter(book.id, { title: "Kept", content: "Kept line.\n" });

    // Front matter that is not valid YAML, fenced and closed.
    await port.commitFile(
      chapterPath(book.id, "0002-broken.md"),
      bytes(`---\ntitle: [unclosed\norder: 2\n---\n\nBody that never parses.\n`),
      { kind: "absent" }
    );
    // Front matter that parses but violates the chapter schema.
    await port.commitFile(
      chapterPath(book.id, "0003-wrong.md"),
      bytes(`---\nid: ch_damaged000001\ntitle: Wrong\norder: "third"\nversion: 1\ncreatedAt: 2026-11-03T00:00:00.000Z\nupdatedAt: 2026-11-03T00:00:00.000Z\n---\n\nBody with a bad order.\n`),
      { kind: "absent" }
    );

    const detail = await service.readBook(book.id);
    expect(detail.chapters.map((chapter) => chapter.id)).toEqual([good.id]);
    expect(detail.chapterReadIssues).toEqual([
      { fileName: "0002-broken.md", order: 2, reason: "invalid-format" },
      { fileName: "0003-wrong.md", order: 3, reason: "invalid-format" }
    ]);

    // The book still lists, and its healthy chapters still save.
    expect((await service.listBooks()).map((summary) => summary.id)).toContain(book.id);
    const saved = await service.saveChapter(book.id, good.id, "Kept line.\nMore.\n", {
      baseVersion: good.version,
      baseHash: good.hash
    });
    expect(saved.status).toBe("saved");
  });

  test("a file without front matter stays readable prose, not an issue", async () => {
    const { port, service } = await openLibrary();
    const book = await service.createBook({ title: "Pasted" });
    // An author-pasted file, truncated or never fenced: prose, not a failure.
    await port.commitFile(chapterPath(book.id, "notes.md"), bytes("Just pasted prose.\n"), { kind: "absent" });

    const detail = await service.readBook(book.id);
    expect(detail.chapterReadIssues).toEqual([]);
    expect(detail.chapters.map((chapter) => chapter.content)).toEqual(["Just pasted prose.\n"]);
  });
});
