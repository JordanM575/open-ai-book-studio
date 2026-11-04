import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { buildEpub } from "../src/main/epub";
import { buildManuscriptHtml } from "../src/main/manuscript-html";
import {
  collectDocxImages,
  exportManuscriptEpub,
  exportManuscriptPdf,
  suggestEpubName,
  suggestPdfName,
  type DocxImage,
  type ExportDeps,
  type ExportState
} from "../src/main/export";
import type { BookDetail } from "@ai-book-studio/core/schema";

/*
 * The PDF and EPUB exports go through the Word and Markdown exports' publication boundary: a
 * cancelled picker writes nothing, a destination inside the library is refused, replacing a file
 * needs consent, a file that changed after consent is refused, and a failed write leaves no
 * partial file. The PDF renderer is injected, so these run without Electron.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

/** A stand-in for the hidden window: a PDF-shaped file that records the HTML it was given. */
const FAKE_PDF = new TextEncoder().encode("%PDF-1.4\n% synthetic\n%%EOF\n");

async function fixture(): Promise<{ library: Library; detail: BookDetail; illustrations: Map<string, DocxImage> }> {
  const root = await mkdtemp(join(tmpdir(), "abs-pdf-epub-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road", description: "A crossing at low tide." });
  const door = await library.createChapter(book.id, { title: "The Door", content: "The hall was cold.\n\nMara closed the door.\n" });
  await library.createChapter(book.id, { title: "The Gate", content: "Morning came slowly.\n" });
  const image = await library.addImage(book.id, {
    bytes: TINY_PNG,
    kind: "chapter",
    prompt: "A lighthouse",
    provider: "fixture",
    model: "fixture-small"
  });
  await library.attachImage(book.id, image.id, door.id);
  const detail = await library.readBook(book.id);
  return { library, detail, illustrations: await collectDocxImages(detail, library) };
}

async function outside(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "abs-pdf-epub-out-"));
  cleanups.push(dir);
  return dir;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), relative);
      else if (entry.isFile()) {
        files[relative] = createHash("sha256").update(await readFile(join(dir, entry.name))).digest("hex");
      }
    }
  }
  await walk(root, "");
  return files;
}

function realStat(path: string): Promise<ExportState | null> {
  return stat(path)
    .then((found) => ({ mtimeMs: found.mtimeMs, size: found.size }))
    .catch(() => null);
}

function deps(dir: string, overrides: Partial<ExportDeps> = {}): ExportDeps {
  return {
    pickDestination: async (name) => join(dir, name),
    confirmReplace: async () => true,
    statDestination: realStat,
    ...overrides
  };
}

interface Format {
  name: "PDF" | "EPUB";
  extension: string;
  run: (
    detail: BookDetail,
    illustrations: Map<string, DocxImage>,
    root: string,
    overrides: ExportDeps,
    renders?: string[]
  ) => Promise<string | null>;
  looksRight: (bytes: Buffer) => boolean;
}

const FORMATS: Format[] = [
  {
    name: "PDF",
    extension: "pdf",
    run: (detail, illustrations, root, overrides, renders = []) =>
      exportManuscriptPdf(detail, illustrations, root, {
        ...overrides,
        renderPdf: async (html) => {
          renders.push(html);
          return FAKE_PDF;
        }
      }),
    looksRight: (bytes) => bytes.subarray(0, 5).toString("latin1") === "%PDF-"
  },
  {
    name: "EPUB",
    extension: "epub",
    run: (detail, illustrations, root, overrides) => exportManuscriptEpub(detail, illustrations, root, overrides),
    looksRight: (bytes) => bytes.subarray(30, 58).toString("latin1") === "mimetypeapplication/epub+zip"
  }
];

for (const format of FORMATS) {
  describe(`${format.name} publication boundary`, () => {
    test("writes the export outside the library and leaves every book file as it was", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const before = await snapshot(library.root);
      const result = await format.run(detail, illustrations, library.root, deps(dir));
      expect(result).toBe(join(dir, `the-salt-road.${format.extension}`));
      expect(await readdir(dir)).toEqual([`the-salt-road.${format.extension}`]);
      expect(format.looksRight(await readFile(join(dir, `the-salt-road.${format.extension}`)))).toBe(true);
      expect(await snapshot(library.root)).toEqual(before);
    });

    test("a cancelled picker returns null and writes nothing", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const written: string[] = [];
      const renders: string[] = [];
      const result = await format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, {
          pickDestination: async () => null,
          writeFile: async (path) => {
            written.push(path);
          }
        }),
        renders
      );
      expect(result).toBeNull();
      expect(written).toEqual([]);
      expect(renders).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    });

    test("a destination inside the library is refused before anything is made or written", async () => {
      const { library, detail, illustrations } = await fixture();
      const before = await snapshot(library.root);
      const renders: string[] = [];
      const promise = format.run(
        detail,
        illustrations,
        library.root,
        deps(library.root, { pickDestination: async () => join(library.root, "books", detail.book.id, `sneaky.${format.extension}`) }),
        renders
      );
      await expect(promise).rejects.toMatchObject({ code: "invalid" });
      expect(renders).toEqual([]);
      expect(await snapshot(library.root)).toEqual(before);
    });

    test("a declined replacement returns null and keeps the prior file", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const destination = join(dir, `prior.${format.extension}`);
      await writeFile(destination, "prior-bytes");
      const result = await format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, { pickDestination: async () => destination, confirmReplace: async () => false })
      );
      expect(result).toBeNull();
      expect((await readFile(destination)).toString()).toBe("prior-bytes");
    });

    test("an accepted replacement overwrites only after consent", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const destination = join(dir, `prior.${format.extension}`);
      await writeFile(destination, "prior-bytes");
      const asked: string[] = [];
      const result = await format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, {
          pickDestination: async () => destination,
          confirmReplace: async (path) => {
            asked.push(path);
            return true;
          }
        })
      );
      expect(result).toBe(destination);
      expect(asked).toEqual([destination]);
      expect(format.looksRight(await readFile(destination))).toBe(true);
    });

    test("a file that changes after consent is refused and nothing is written", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const written: string[] = [];
      const states: (ExportState | null)[] = [{ mtimeMs: 1, size: 2 }, { mtimeMs: 3, size: 2 }];
      const promise = format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, {
          statDestination: async () => states.shift() ?? null,
          writeFile: async (path) => {
            written.push(path);
          }
        })
      );
      await expect(promise).rejects.toMatchObject({ code: "io" });
      expect(written).toEqual([]);
    });

    test("a file that appears after the check is refused instead of overwritten without consent", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const written: string[] = [];
      const states: (ExportState | null)[] = [null, { mtimeMs: 3, size: 4 }];
      const promise = format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, {
          statDestination: async () => states.shift() ?? null,
          writeFile: async (path) => {
            written.push(path);
          }
        })
      );
      await expect(promise).rejects.toMatchObject({ code: "io" });
      expect(written).toEqual([]);
    });

    test("a failed write keeps the prior file", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const destination = join(dir, `fragile.${format.extension}`);
      await writeFile(destination, "prior-bytes");
      const promise = format.run(
        detail,
        illustrations,
        library.root,
        deps(dir, {
          pickDestination: async () => destination,
          writeFile: async () => {
            throw new Error("disk is full");
          }
        })
      );
      await expect(promise).rejects.toThrow("disk is full");
      expect((await readFile(destination)).toString()).toBe("prior-bytes");
    });

    test("a failed real write leaves no partial file and the prior export byte-identical", async () => {
      const { library, detail, illustrations } = await fixture();
      const dir = await outside();
      const destination = join(dir, `the-salt-road.${format.extension}`);
      await writeFile(destination, "prior-bytes");
      await chmod(dir, 0o555);
      try {
        await expect(format.run(detail, illustrations, library.root, deps(dir))).rejects.toThrow();
        expect(await readdir(dir)).toEqual([`the-salt-road.${format.extension}`]);
        expect((await readFile(destination)).toString()).toBe("prior-bytes");
      } finally {
        await chmod(dir, 0o755);
      }
    });
  });
}

describe("PDF export", () => {
  test("suggests a file name from the book title", () => {
    expect(suggestPdfName("The Salt Road")).toBe("the-salt-road.pdf");
    expect(suggestPdfName("  ")).toBe("manuscript.pdf");
  });

  test("renders the book's own manuscript HTML and writes the renderer's bytes unchanged", async () => {
    const { library, detail, illustrations } = await fixture();
    const dir = await outside();
    const renders: string[] = [];
    const result = await exportManuscriptPdf(detail, illustrations, library.root, {
      ...deps(dir),
      renderPdf: async (html) => {
        renders.push(html);
        return FAKE_PDF;
      }
    });
    expect(renders).toEqual([buildManuscriptHtml(detail, illustrations)]);
    // The attached illustration reaches the page as a data URI, and only there.
    expect(renders[0]).toContain(`data:image/png;base64,${Buffer.from(TINY_PNG).toString("base64")}`);
    expect(new Uint8Array(await readFile(result ?? ""))).toEqual(FAKE_PDF);
  });

  test("a render that fails writes nothing, asks nothing and keeps the prior file", async () => {
    const { library, detail, illustrations } = await fixture();
    const dir = await outside();
    const destination = join(dir, "the-salt-road.pdf");
    await writeFile(destination, "prior-bytes");
    const asked: string[] = [];
    const promise = exportManuscriptPdf(detail, illustrations, library.root, {
      ...deps(dir, {
        confirmReplace: async (path) => {
          asked.push(path);
          return true;
        }
      }),
      renderPdf: async () => {
        throw new Error("the renderer went away");
      }
    });
    await expect(promise).rejects.toMatchObject({
      code: "io",
      message: "The PDF could not be made. Nothing was written. Try the export again."
    });
    expect(asked).toEqual([]);
    expect(await readdir(dir)).toEqual(["the-salt-road.pdf"]);
    expect((await readFile(destination)).toString()).toBe("prior-bytes");
  });

  test("a renderer that returns something other than a PDF writes nothing", async () => {
    const { library, detail, illustrations } = await fixture();
    const dir = await outside();
    const promise = exportManuscriptPdf(detail, illustrations, library.root, {
      ...deps(dir),
      renderPdf: async () => new TextEncoder().encode("<html>not a pdf</html>")
    });
    await expect(promise).rejects.toMatchObject({ code: "io" });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("EPUB export", () => {
  test("suggests a file name from the book title", () => {
    expect(suggestEpubName("The Salt Road")).toBe("the-salt-road.epub");
    expect(suggestEpubName("  ")).toBe("manuscript.epub");
  });

  test("writes exactly the container the book builds, illustration included", async () => {
    const { library, detail, illustrations } = await fixture();
    const dir = await outside();
    const result = await exportManuscriptEpub(detail, illustrations, library.root, deps(dir));
    const written = await readFile(result ?? "");
    expect(written.equals(Buffer.from(buildEpub(detail, illustrations)))).toBe(true);
    expect(written.includes(Buffer.from(TINY_PNG))).toBe(true);
  });
});
