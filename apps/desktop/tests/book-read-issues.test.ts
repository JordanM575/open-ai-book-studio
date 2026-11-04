import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { bookFile } from "../src/main/library/paths";

/**
 * QA D9: a book whose book.json is newer, half-synced or unreadable still appears in the library
 * grid with the reason it cannot open, and its folder is left exactly as it was.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ai-book-studio-book-issues-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Every file under a folder, with its bytes, so a test can prove nothing was written or removed. */
async function filesUnder(folder: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await filesUnder(join(folder, entry.name), `${name}/`));
    else files[name] = (await readFile(join(folder, entry.name))).toString("base64");
  }
  return files;
}

async function folder(name: string, files: Record<string, string>): Promise<string> {
  const path = join(root, "books", name);
  await mkdir(join(path, "chapters"), { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(path, file), text, "utf8");
  return path;
}

describe("a book that cannot open", () => {
  it("is listed as saved by a newer studio, with its title, and left as it was", async () => {
    const library = await Library.open(root);
    const healthy = await library.createBook({ title: "Healthy" });
    const future = await library.createBook({ title: "Future" });
    await library.createChapter(future.id, { title: "The Door", content: "Salt on the floor.\n" });
    const raw = JSON.parse(await readFile(bookFile(root, future.id), "utf8")) as Record<string, unknown>;
    await writeFile(bookFile(root, future.id), JSON.stringify({ ...raw, schemaVersion: 99 }), "utf8");
    const before = await filesUnder(join(root, "books", future.id));

    const listing = await library.listBooksWithIssues();

    expect(listing.books.map((book) => book.id)).toEqual([healthy.id]);
    expect(listing.bookReadIssues).toEqual([{ folder: future.id, title: "Future", reason: "newer-schema" }]);
    expect(await filesUnder(join(root, "books", future.id))).toEqual(before);
  });

  it("is listed as still syncing while its book.json has not arrived", async () => {
    const library = await Library.open(root);
    await library.createBook({ title: "Healthy" });
    // The chapters came first; book.json is missing, empty, or an iCloud stand-in.
    const missing = await folder("book_missing000001", { "chapters/0001-the-door.md": "Salt on the floor.\n" });
    const empty = await folder("book_emptyjson0001", { "book.json": "" });
    const evicted = await folder("book_evicted000001", { ".book.json.icloud": "placeholder" });
    const before = await Promise.all([missing, empty, evicted].map((path) => filesUnder(path)));

    const listing = await library.listBooksWithIssues();

    expect(listing.books.map((book) => book.title)).toEqual(["Healthy"]);
    expect(listing.bookReadIssues).toEqual([
      { folder: "book_emptyjson0001", title: null, reason: "syncing" },
      { folder: "book_evicted000001", title: null, reason: "syncing" },
      { folder: "book_missing000001", title: null, reason: "syncing" }
    ]);
    expect(await Promise.all([missing, empty, evicted].map((path) => filesUnder(path)))).toEqual(before);
  });

  it("is listed as unreadable when its book.json is damaged, without the parser's words", async () => {
    const library = await Library.open(root);
    const damaged = await folder("book_damaged000001", { "book.json": "{ not json" });
    await folder("book_noversion0001", { "book.json": JSON.stringify({ id: "book_noversion0001", title: "Unmarked" }) });
    await folder("book_wrongshape01", { "book.json": JSON.stringify({ schemaVersion: 1, id: 7 }) });
    const before = await filesUnder(damaged);

    const listing = await library.listBooksWithIssues();

    expect(listing.books).toEqual([]);
    expect(listing.bookReadIssues).toEqual([
      { folder: "book_damaged000001", title: null, reason: "unreadable" },
      { folder: "book_noversion0001", title: null, reason: "unreadable" },
      { folder: "book_wrongshape01", title: null, reason: "unreadable" }
    ]);
    expect(await filesUnder(damaged)).toEqual(before);
  });

  it("keeps listBooks and the derived catalog to the books that open", async () => {
    const library = await Library.open(root);
    const healthy = await library.createBook({ title: "Healthy" });
    await folder("book_damaged000001", { "book.json": "{ not json" });

    expect((await library.listBooks()).map((book) => book.id)).toEqual([healthy.id]);
    await library.rebuildCatalog();
    const catalog = JSON.parse(await readFile(join(root, "library.json"), "utf8")) as { books: Array<{ id: string }> };
    expect(catalog.books.map((book) => book.id)).toEqual([healthy.id]);
  });
});
