import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { bookFilePath } from "../src/library/paths";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 035 T007 premises. These pin the matter facts the ordered-matter
 * decision rests on; they choose nothing. A future matter schema must preserve
 * the guarantees proven here: populated string records survive supported saves
 * in order, bad data fails closed without touching the file, and a record the
 * schema cannot parse is reported rather than silently dropped.
 */

const LEGACY_MATTER: Record<string, string> = {
  subtitle: "A Crossing at Low Tide",
  author: "M. Okafor",
  dedication: "For those who wait.",
  disclaimer: "A work of fiction.",
  aboutAuthor: "Writes about tides.",
  colophon: "Set in Georgia."
};

async function seedMatter(port: InMemoryLibraryPort, bookId: string, frontMatter: unknown): Promise<void> {
  const snapshot = await port.readFile(bookFilePath(bookId));
  const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes ?? new Uint8Array())) as Record<
    string,
    unknown
  >;
  raw.frontMatter = frontMatter;
  await port.commitFile(bookFilePath(bookId), new TextEncoder().encode(`${JSON.stringify(raw)}\n`), {
    kind: "any"
  });
}

function rawFrontMatter(bytes: Uint8Array | undefined): unknown {
  const raw = JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())) as Record<string, unknown>;
  return raw.frontMatter;
}

describe("matter schema premises", () => {
  test("a populated string record survives a supported save in order", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await seedMatter(port, book.id, LEGACY_MATTER);

    await service.updateBook(book.id, { title: "The Salt Crossing" });

    const after = await port.readFile(bookFilePath(book.id));
    expect(rawFrontMatter(after?.bytes)).toEqual(LEGACY_MATTER);
    expect(Object.keys((rawFrontMatter(after?.bytes) ?? {}) as Record<string, string>)).toEqual(
      Object.keys(LEGACY_MATTER)
    );
    const detail = await service.readBook(book.id);
    expect(detail.book.frontMatter).toEqual(LEGACY_MATTER);
  });

  test("a record the schema cannot parse fails the open instead of dropping data", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await seedMatter(port, book.id, { ...LEGACY_MATTER, dedication: { text: "For those who wait." } });

    const promise = service.readBook(book.id);
    await expect(promise).rejects.toMatchObject({ code: "format" });
  });

  test("a matter patch the schema cannot parse rejects and leaves the file untouched", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await seedMatter(port, book.id, LEGACY_MATTER);
    const before = await port.readFile(bookFilePath(book.id));

    const promise = service.updateBook(book.id, { frontMatter: { dedication: 7 } });
    await expect(promise).rejects.toThrow();
    const after = await port.readFile(bookFilePath(book.id));
    expect(after?.bytes).toEqual(before?.bytes);
  });

  test("replacing the record is whole-record: omitted keys do not merge back", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    await seedMatter(port, book.id, LEGACY_MATTER);

    const updated = await service.updateBook(book.id, { frontMatter: { dedication: "For Ana." } });
    expect(updated.frontMatter).toEqual({ dedication: "For Ana." });
  });
});
