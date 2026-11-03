import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { toLibraryPath } from "../src/library/path";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Spec 032 T002 (OQ-002) premises. These pin the retention facts the cleanup
 * decision rests on; they choose no period, quota, or pruning rule. Kept
 * versions (conflict copies) and trash accumulate without a cap, and a failed
 * expected-hash write preserves the existing bytes instead of deleting them.
 */
describe("chapter history retention premises", () => {
  test("conflict copies accumulate without a cap", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await service.createChapter(book.id, { title: "The Door", content: "Salt wind.\n" });
    const conflicts = toLibraryPath(["books", book.id, "conflicts"]);
    await port.commitFile(toLibraryPath(["books", book.id, "conflicts", "0001-door.conflict-a.d1.1.md"]), encoder.encode("a"), {
      kind: "any"
    });
    await port.commitFile(toLibraryPath(["books", book.id, "conflicts", "0001-door.conflict-b.d1.2.md"]), encoder.encode("b"), {
      kind: "any"
    });
    expect((await port.listDirectory(conflicts)).filter((entry) => entry.kind === "file")).toHaveLength(2);
    expect(await service.listConflicts(book.id)).toHaveLength(2);
  });

  test("chapter trash accumulates without pruning", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const first = await service.createChapter(book.id, { title: "One", content: "One.\n" });
    const second = await service.createChapter(book.id, { title: "Two", content: "Two.\n" });

    await service.deleteChapter(book.id, first.id);
    await service.deleteChapter(book.id, second.id);

    const trash = await port.listDirectory(toLibraryPath([".studio", "trash", book.id]));
    expect(trash.filter((entry) => entry.kind === "file")).toHaveLength(2);
  });

  test("a failed expected-hash write preserves the existing bytes", async () => {
    const port = new InMemoryLibraryPort();
    const path = toLibraryPath(["books", "book_x", "history", "chapter_y", "123-label.md"]);
    const created = await port.commitFile(path, encoder.encode("kept"), { kind: "any" });
    if (created.status !== "written") throw new Error("Expected the record to be created.");

    const failed = await port.commitFile(path, encoder.encode("lost"), { kind: "sha256", value: "wrong" });
    expect(failed.status).toBe("changed");
    const stored = await port.readFile(path);
    expect(stored ? decoder.decode(stored.bytes) : null).toBe("kept");
  });
});
