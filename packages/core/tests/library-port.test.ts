import { describe, expect, test } from "bun:test";
import { LibraryPortError } from "../src/library/errors";
import { libraryPathFromArchivePath, libraryPathToArchivePath, toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

describe("LibraryPort contract", () => {
  test("commits complete bytes only when the expected prior hash matches", async () => {
    const port = new InMemoryLibraryPort();
    const path = toLibraryPath(["books", "book_test000001", "book.json"]);
    const first = await port.commitFile(path, new TextEncoder().encode("first"), { kind: "absent" });
    expect(first.status).toBe("written");
    if (first.status !== "written") return;

    const stale = await port.commitFile(path, new TextEncoder().encode("stale"), {
      kind: "sha256",
      value: "0".repeat(64)
    });
    expect(stale.status).toBe("changed");

    const saved = await port.readFile(path);
    expect(new TextDecoder().decode(saved?.bytes)).toBe("first");
  });

  test("copies bytes on read and write so callers cannot mutate committed content", async () => {
    const port = new InMemoryLibraryPort();
    const path = toLibraryPath(["books", "book_test000001", "book.json"]);
    const input = new TextEncoder().encode("book");
    const result = await port.commitFile(path, input, { kind: "absent" });
    expect(result.status).toBe("written");

    input[0] = 0;
    const read = await port.readFile(path);
    expect(new TextDecoder().decode(read?.bytes)).toBe("book");
    if (read) read.bytes[0] = 0;
    expect(new TextDecoder().decode((await port.readFile(path))?.bytes)).toBe("book");
  });

  test("lists immediate children and not nested descendants", async () => {
    const port = new InMemoryLibraryPort();
    const a = toLibraryPath(["books", "book_test000001", "book.json"]);
    const b = toLibraryPath(["books", "book_test000001", "chapters", "0001-first.md"]);
    await port.commitFile(a, new Uint8Array([1]), { kind: "absent" });
    await port.commitFile(b, new Uint8Array([2]), { kind: "absent" });

    expect(await port.listDirectory(toLibraryPath(["books", "book_test000001"]))).toEqual([
      { name: "book.json", kind: "file" },
      { name: "chapters", kind: "directory" }
    ]);
    expect(await port.listDirectory(toLibraryPath(["books", "book_test000001", "chapters"]))).toEqual([
      { name: "0001-first.md", kind: "file" }
    ]);
  });

  test("rejects path traversal and does not replace a move destination", async () => {
    const port = new InMemoryLibraryPort();
    expect(() => toLibraryPath(["books", "..", "outside"])).toThrow("unsafe segment");
    await expect(port.readFile(["books", "..", "outside"] as never)).rejects.toMatchObject({ code: "invalid-path" });

    const from = toLibraryPath(["books", "book_test000001", "chapter.md"]);
    const to = toLibraryPath(["books", "book_test000001", "trash.md"]);
    await port.commitFile(from, new Uint8Array([1]), { kind: "absent" });
    await port.commitFile(to, new Uint8Array([2]), { kind: "absent" });
    await expect(port.moveFile(from, to)).rejects.toMatchObject({ code: "already-exists" });
    expect((await port.readFile(from))?.bytes).toEqual(new Uint8Array([1]));
  });

  test("returns safe typed errors for missing file operations", async () => {
    const port = new InMemoryLibraryPort();
    await expect(port.removeFile(toLibraryPath(["books", "missing.md"]))).rejects.toBeInstanceOf(LibraryPortError);
  });

  test("publishes a staged directory as one move and refuses to cover a destination", async () => {
    const port = new InMemoryLibraryPort();
    const staged = toLibraryPath([".studio", "staging", "import_test000001"]);
    await port.ensureDirectory(toLibraryPath([...staged, "chapters"]));
    await port.commitFile(toLibraryPath([...staged, "book.json"]), new TextEncoder().encode("{}"), {
      kind: "absent"
    });
    await port.commitFile(
      toLibraryPath([...staged, "chapters", "0001-first.md"]),
      new TextEncoder().encode("First.\n"),
      { kind: "absent" }
    );

    const published = toLibraryPath(["books", "book_test000001"]);
    await port.moveDirectory(staged, published);

    // The staged tree is gone and the published tree is complete: readers see either
    // the old location or the new one, never a partial book.
    expect(await port.listDirectory(staged)).toEqual([]);
    expect(await port.readFile(toLibraryPath([...staged, "book.json"]))).toBeNull();
    expect(await port.listDirectory(published)).toEqual([
      { name: "book.json", kind: "file" },
      { name: "chapters", kind: "directory" }
    ]);

    await port.ensureDirectory(toLibraryPath([...staged, "chapters"]));
    await port.commitFile(toLibraryPath([...staged, "book.json"]), new TextEncoder().encode("{}"), {
      kind: "absent"
    });
    await expect(port.moveDirectory(staged, published)).rejects.toMatchObject({ code: "already-exists" });
  });

  test("removes an unpublished staging tree without touching sibling content", async () => {
    const port = new InMemoryLibraryPort();
    const staged = toLibraryPath([".studio", "staging", "import_test000001"]);
    await port.ensureDirectory(toLibraryPath([...staged, "chapters"]));
    await port.commitFile(toLibraryPath([...staged, "book.json"]), new TextEncoder().encode("{}"), {
      kind: "absent"
    });
    const kept = toLibraryPath(["books", "book_test000001", "book.json"]);
    await port.commitFile(kept, new TextEncoder().encode("keep"), { kind: "absent" });

    await port.removeDirectory(staged);

    expect(await port.listDirectory(staged)).toEqual([]);
    expect(await port.readFile(toLibraryPath([...staged, "book.json"]))).toBeNull();
    expect(new TextDecoder().decode((await port.readFile(kept))?.bytes)).toBe("keep");
    await expect(port.removeDirectory(staged)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("library-relative paths", () => {
  test("round-trips normalized archive paths without changing segment bytes", async () => {
    const path = toLibraryPath(["books", "book_12345678", "chapters", "0001-the-door.md"]);
    expect(libraryPathToArchivePath(path)).toBe("books/book_12345678/chapters/0001-the-door.md");
    expect(libraryPathFromArchivePath(libraryPathToArchivePath(path))).toEqual(path);
  });

  test("rejects absolute, drive-prefixed, backslash and traversal archive names", async () => {
    for (const path of ["/books/book.json", "C:/books/book.json", "books\\..\\outside", "books/../outside"]) {
      expect(() => libraryPathFromArchivePath(path)).toThrow();
    }
    expect(() => libraryPathToArchivePath(toLibraryPath([]))).toThrow("root");
    expect(() => libraryPathFromArchivePath("books//book.json")).toThrow();
  });
});
