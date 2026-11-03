import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { bookFilePath } from "../src/library/paths";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 030 T001 premises. These pin the storage facts the planning-format
 * decision rests on; they choose nothing. A future planning section or file
 * must preserve the guarantees proven here: unknown data survives supported
 * saves, and opening an old book never rewrites it.
 */
describe("story bible storage premises", () => {
  test("unknown top-level book fields survive a supported save", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });

    const snapshot = await port.readFile(bookFilePath(book.id));
    const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes ?? new Uint8Array())) as Record<
      string,
      unknown
    >;
    raw.futureExtension = { schemaVersion: 99, records: [{ id: "r1" }] };
    await port.commitFile(bookFilePath(book.id), new TextEncoder().encode(`${JSON.stringify(raw)}\n`), {
      kind: "any"
    });

    await service.updateBook(book.id, { title: "The Salt Crossing" });

    const after = await port.readFile(bookFilePath(book.id));
    const kept = JSON.parse(new TextDecoder().decode(after?.bytes ?? new Uint8Array())) as Record<
      string,
      unknown
    >;
    expect(kept.futureExtension).toEqual({ schemaVersion: 99, records: [{ id: "r1" }] });
    expect(kept.title).toBe("The Salt Crossing");
  });

  test("opening and reading a book without extension data rewrites nothing", async () => {
    const port = new InMemoryLibraryPort();
    const first = await LibraryService.open({ storage: port, runtime: port });
    const book = await first.createBook({ title: "The Salt Road" });
    const opened = await port.readFile(bookFilePath(book.id));
    const bytes = Buffer.from(opened?.bytes ?? []).toString("utf8");
    expect(bytes).not.toContain("planning");

    const second = await LibraryService.open({ storage: port, runtime: port });
    await second.readBook(book.id);

    const reread = await port.readFile(bookFilePath(book.id));
    expect(Buffer.from(reread?.bytes ?? []).toString("utf8")).toBe(bytes);
  });
});
