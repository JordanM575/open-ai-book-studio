import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { buildDocx } from "../src/main/export";
import { unzipSync } from "fflate";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * Spec 035 T006 premises: what the D-108 renderer decision can rely on about the current
 * DOCX pipeline. These pin the determinism baseline with synthetic books; they select no
 * renderer and claim no publisher conformance.
 */

async function syntheticBook(): Promise<Library> {
  const root = await mkdtemp(join(tmpdir(), "abs-renderers-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "Premises", description: "A synthetic book." });
  await library.createChapter(book.id, { title: "One", content: "First line.\n\nSecond line.\n" });
  await library.createChapter(book.id, { title: "Two", content: "Another.\n" });
  return library;
}

/** Zip local-file-header dates, in entry order. The docx packer is expected to fix these. */
function entryDates(data: Uint8Array): string[] {
  const bytes = new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const time = view.getUint16(offset + 10, true);
    const date = view.getUint16(offset + 12, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    found.push(`${name}@${date.toString(16)}:${time.toString(16)}`);
    const compressed = view.getUint32(offset + 18, true);
    offset += 30 + nameLength + extraLength + compressed;
  }
  return found;
}

describe("export renderer premises", () => {
  test("the same book builds to byte-identical document and style content", async () => {
    const library = await syntheticBook();
    const books = await library.listBooks();
    const firstId = books[0]?.id;
    if (!firstId) throw new Error("expected the synthetic book");
    const detail = await library.readBook(firstId);
    const first = unzipSync(new Uint8Array(await buildDocx(detail)));
    const second = unzipSync(new Uint8Array(await buildDocx(detail)));
    const names = Object.keys(first).sort();
    expect(Object.keys(second).sort()).toEqual(names);
    for (const name of names) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      if (name === "docProps/core.xml") continue;
      const decoder = new TextDecoder();
      expect(decoder.decode(second[name] ?? new Uint8Array())).toBe(decoder.decode(first[name] ?? new Uint8Array()));
    }
  });

  test("the packer fixes zip entry dates across builds", async () => {
    const library = await syntheticBook();
    const books = await library.listBooks();
    const firstId = books[0]?.id;
    if (!firstId) throw new Error("expected the synthetic book");
    const detail = await library.readBook(firstId);
    const first = entryDates(new Uint8Array(await buildDocx(detail)));
    const second = entryDates(new Uint8Array(await buildDocx(detail)));
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  test("page geometry is the library default, not an author choice", async () => {
    const library = await syntheticBook();
    const books = await library.listBooks();
    const firstId = books[0]?.id;
    if (!firstId) throw new Error("expected the synthetic book");
    const detail = await library.readBook(firstId);
    const files = unzipSync(new Uint8Array(await buildDocx(detail)));
    const document = new TextDecoder().decode(files["word/document.xml"] ?? new Uint8Array());
    // The pipeline passes empty section properties, so the docx library injects its own
    // defaults (A4, 1-inch margins). Physical-layout controls would override these
    // defaults rather than fill a blank — and no author value reaches them today.
    expect(document).toContain('w:pgSz w:w="11906" w:h="16838"');
    expect(document).toContain('w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"');
  });

  test("the container carries wall-clock core timestamps", async () => {
    const library = await syntheticBook();
    const books = await library.listBooks();
    const firstId = books[0]?.id;
    if (!firstId) throw new Error("expected the synthetic book");
    const detail = await library.readBook(firstId);
    const files = unzipSync(new Uint8Array(await buildDocx(detail)));
    const core = new TextDecoder().decode(files["docProps/core.xml"] ?? new Uint8Array());
    // The timestamps exist and look like wall-clock datetimes; the research record explains
    // why a byte-identical container needs them normalized.
    expect(core).toMatch(/dcterms:created[^>]*>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(core).toMatch(/dcterms:modified[^>]*>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
