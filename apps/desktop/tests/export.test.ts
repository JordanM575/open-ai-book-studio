import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import {
  buildDocx,
  buildMarkdown,
  collectDocxImages,
  exportManuscriptDocx,
  exportManuscriptMarkdown,
  isInsideLibrary,
  suggestDocxName,
  suggestMarkdownName,
  type DocxExportDeps,
  type DocxExportState,
  type DocxImage
} from "../src/main/export";
import { manuscriptSettingsSchema } from "@ai-book-studio/core/schema";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ library: Library; bookId: string; chapterIds: [string, string] }> {
  const root = await mkdtemp(join(tmpdir(), "abs-export-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road", description: "A crossing at low tide." });
  const first = await library.createChapter(book.id, {
    title: "The Door",
    content: "The hall was cold.\n\nMara closed the door.\n"
  });
  const second = await library.createChapter(book.id, { title: "The Gate", content: "Morning came slowly.\n" });
  expect(first.title).toBe("The Door");
  return { library, bookId: book.id, chapterIds: [first.id, second.id] };
}

async function snapshotBook(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        snapshot[relative] = createHash("sha256").update(bytes).digest("hex");
      }
    }
  }
  await walk(root, "");
  return snapshot;
}

describe("docx export", () => {
  test("builds a Word document for a book", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const data = await buildDocx(detail);
    expect(data.length).toBeGreaterThan(1_000);
    expect(Buffer.from(data).subarray(0, 2).toString()).toBe("PK");
  });

  test("builds a document for an empty book", async () => {
    const root = await mkdtemp(join(tmpdir(), "abs-export-empty-"));
    cleanups.push(root);
    const library = await Library.open(root);
    const book = await library.createBook({ title: "Blank" });
    const detail = await library.readBook(book.id);
    const data = await buildDocx(detail);
    expect(data.length).toBeGreaterThan(500);
  });

  test("applies the book's canonical typography to the document", async () => {
    const { library, bookId } = await fixture();
    const manuscript = {
      ...manuscriptSettingsSchema.parse({}),
      bodyFont: "Georgia",
      bodyFontSize: 14,
      lineSpacing: "1.5",
      firstLineIndent: 0.3,
      chapterTitleAlignment: "Left"
    } as never;
    await library.updateBook(bookId, { settings: { manuscript } } as never);
    const detail = await library.readBook(bookId);
    const data = await buildDocx(detail);
    const files = unzipSync(new Uint8Array(data));
    const document = new TextDecoder().decode(files["word/document.xml"]);
    // 14pt body -> 28 half-points, 1.5 spacing -> 360 twips, 0.3in indent -> 432 twips.
    expect(document).toContain('w:ascii="Georgia"');
    expect(document).toContain('w:val="28"');
    expect(document).toContain('w:line="360"');
    expect(document).toContain('w:firstLine="432"');
    // The Left chapter-title setting left-aligns both chapter headings.
    expect(document.split('w:val="left"').length - 1).toBe(2);
    expect(document).toContain("The hall was cold.");
  });

  test("the same chapters render different runs under different manuscript settings", async () => {
    const { library, bookId } = await fixture();
    const readDocumentXml = async (): Promise<string> => {
      const detail = await library.readBook(bookId);
      const data = await buildDocx(detail);
      return new TextDecoder().decode(unzipSync(new Uint8Array(data))["word/document.xml"]);
    };
    // Read the defaults build fully before changing settings so the two documents
    // cannot observe the same settings through a concurrent read.
    const defaults = await readDocumentXml();
    const manuscript = {
      ...manuscriptSettingsSchema.parse({}),
      bodyFont: "Georgia",
      bodyFontSize: 14,
      lineSpacing: "1.5",
      firstLineIndent: 0.3,
      chapterTitleAlignment: "Left"
    } as never;
    await library.updateBook(bookId, { settings: { manuscript } } as never);
    const custom = await readDocumentXml();
    // Same prose in both documents; only the styling runs may differ.
    expect(defaults).toContain("The hall was cold.");
    expect(custom).toContain("The hall was cold.");
    // Defaults: Times New Roman, 12pt body (24 half-points), Double spacing (480
    // twips), 0.2in indent (288 twips). Custom: Georgia, 14pt (28), 1.5 (360),
    // 0.3in indent (432). Each document carries only its own settings.
    expect(defaults).toContain('w:ascii="Times New Roman"');
    expect(defaults).toContain('w:val="24"');
    expect(defaults).toContain('w:line="480"');
    expect(defaults).toContain('w:firstLine="288"');
    expect(defaults).not.toContain("Georgia");
    expect(defaults).not.toContain('w:line="360"');
    expect(defaults).not.toContain('w:firstLine="432"');
    expect(custom).toContain('w:ascii="Georgia"');
    expect(custom).toContain('w:val="28"');
    expect(custom).toContain('w:line="360"');
    expect(custom).toContain('w:firstLine="432"');
    expect(custom).not.toContain("Times New Roman");
    expect(custom).not.toContain('w:line="480"');
    expect(custom).not.toContain('w:firstLine="288"');
  });

  test("verse lines export in order with their stanza gap", async () => {
    const { library, bookId } = await fixture();
    await library.createChapter(bookId, {
      title: "Verse",
      content: "Roses are red  \nViolets are blue\n\nSugar is sweet\nAnd so are you\n"
    });
    const data = await buildDocx(await library.readBook(bookId));
    const document = new TextDecoder().decode(unzipSync(new Uint8Array(data))["word/document.xml"]);
    const lines = ["Roses are red", "Violets are blue", "Sugar is sweet", "And so are you"].map((line) =>
      document.indexOf(line)
    );
    for (const position of lines) expect(position).toBeGreaterThan(-1);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  test("exporting leaves every source file byte-identical", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const before = await snapshotBook(library.root);
    const illustrations = await collectDocxImages(detail, library);
    const data = await buildDocx(detail, illustrations);
    const outside = join(tmpdir(), `abs-export-outside-${Date.now().toString(36)}.docx`);
    cleanups.push(outside);
    const { writeFileAtomic } = await import("../src/main/library/atomic");
    await writeFileAtomic(outside, Buffer.from(data));
    expect(await snapshotBook(library.root)).toEqual(before);
  });

  test("embeds a chapter illustration when one is attached", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
        "base64"
      )
    );
    const image: DocxImage = {
      bytes: png,
      width: 1,
      height: 1,
      mimeType: "image/png",
      prompt: "A lighthouse in a storm"
    };
    const data = await buildDocx(detail, new Map([[detail.chapters[0]!.id, image]]));
    const files = unzipSync(new Uint8Array(data));
    expect(Object.keys(files).some((name) => /^word\/media\/.*\.png$/.test(name))).toBe(true);
  });
});

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

function tinyWebp(): Uint8Array {
  // Minimal VP8X container the image store accepts: RIFF + WEBP + VP8X markers, 1x1.
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  return bytes;
}

async function attachPng(library: Library, bookId: string, chapterId: string | null, prompt = "A lighthouse"): Promise<void> {
  const record = await library.addImage(bookId, {
    bytes: TINY_PNG,
    kind: "chapter",
    prompt,
    provider: "fixture",
    model: "fixture-small"
  });
  if (chapterId) await library.attachImage(bookId, record.id, chapterId);
}

describe("collectDocxImages", () => {
  test("resolves an attached PNG through the image store", async () => {
    const { library, bookId, chapterIds: [chapterId] } = await fixture();
    await attachPng(library, bookId, chapterId);
    const detail = await library.readBook(bookId);
    const collected = await collectDocxImages(detail, library);
    const image = collected.get(chapterId);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.width).toBe(1);
    expect(image?.height).toBe(1);
    expect(image?.prompt).toBe("A lighthouse");
    expect(image?.bytes.length).toBeGreaterThan(0);
  });

  test("skips unattached and WebP images without failing", async () => {
    const { library, bookId, chapterIds: [chapterId] } = await fixture();
    await attachPng(library, bookId, null);
    const webp = await library.addImage(bookId, {
      bytes: tinyWebp(),
      kind: "chapter",
      prompt: "A storm",
      provider: "fixture",
      model: "fixture-small"
    });
    await library.attachImage(bookId, webp.id, chapterId);
    const detail = await library.readBook(bookId);
    expect(await collectDocxImages(detail, library)).toEqual(new Map());
  });

  test("skips unreadable images and keeps the readable ones", async () => {
    const { library, bookId, chapterIds: [chapterId] } = await fixture();
    const detail = await library.readBook(bookId);
    await attachPng(library, bookId, chapterId);
    const { manifest } = await library.listImages(bookId);
    const unreadable = {
      listImages: async () => ({ manifest, warning: null }),
      readImage: async () => {
        throw new Error("gone");
      }
    };
    expect(await collectDocxImages(detail, unreadable)).toEqual(new Map());
  });

  test("an unreadable manifest yields no illustrations instead of failing", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const broken = {
      listImages: async () => {
        throw new Error("no manifest");
      },
      readImage: async () => null
    };
    expect(await collectDocxImages(detail, broken)).toEqual(new Map());
  });

  test("the first readable image per chapter wins", async () => {
    const { library, bookId, chapterIds: [chapterId] } = await fixture();
    const detail = await library.readBook(bookId);
    await attachPng(library, bookId, chapterId, "First");
    const { manifest } = await library.listImages(bookId);
    const [first] = manifest.images;
    if (!first) throw new Error("expected the attached image in the manifest");
    const second = { ...first, id: "img_second", prompt: "Second" };
    const both = {
      listImages: async () => ({ manifest: { ...manifest, images: [first, second] }, warning: null }),
      readImage: async (_bookId: string, imageId: string) => ({
        record: imageId === first.id ? first : second,
        bytes: TINY_PNG
      })
    };
    const collected = await collectDocxImages(detail, both);
    expect(collected.get(chapterId)?.prompt).toBe("First");
  });
});

describe("suggestDocxName", () => {
  test("derives a safe file name from the title", () => {
    expect(suggestDocxName("The Salt Road")).toBe("the-salt-road.docx");
    expect(suggestDocxName("  ")).toBe("manuscript.docx");
    expect(suggestDocxName("Café!")).toBe("café.docx");
  });

  test("truncates a long title to a 60-character stem", () => {
    const name = suggestDocxName(`${"a".repeat(100)}!`);
    expect(name).toBe(`${"a".repeat(60)}.docx`);
  });
});

describe("isInsideLibrary", () => {
  test("refuses the library root and anything under it, allows siblings", () => {
    const root = join(tmpdir(), "abs-library-root");
    expect(isInsideLibrary(root, root)).toBe(true);
    expect(isInsideLibrary(root, join(root, "books", "book_x", "chapter.md"))).toBe(true);
    expect(isInsideLibrary(root, `${root}2`)).toBe(false);
    expect(isInsideLibrary(root, join(tmpdir(), "elsewhere.docx"))).toBe(false);
  });
});

describe("exportManuscriptDocx", () => {
  async function outside(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "abs-docx-out-"));
    cleanups.push(dir);
    return dir;
  }

  function realStat(path: string): Promise<DocxExportState | null> {
    return stat(path)
      .then((snapshot) => ({ mtimeMs: snapshot.mtimeMs, size: snapshot.size }))
      .catch(() => null);
  }

  function baseDeps(dir: string, overrides: Partial<DocxExportDeps> = {}): DocxExportDeps {
    return {
      pickDestination: async (name) => join(dir, name),
      confirmReplace: async () => true,
      statDestination: realStat,
      ...overrides
    };
  }

  test("a cancelled picker returns null and writes nothing", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const written: string[] = [];
    const result = await exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => null,
      writeFile: async (path) => {
        written.push(path);
      }
    });
    expect(result).toBeNull();
    expect(written).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test("a destination inside the library is refused before anything is written", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const written: string[] = [];
    const destination = join(library.root, "books", bookId, "sneaky.docx");
    const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => destination,
      writeFile: async (path) => {
        written.push(path);
      }
    });
    await expect(promise).rejects.toMatchObject({ code: "invalid" });
    expect(written).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test("a declined replacement returns null and keeps the prior file", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const destination = join(dir, "prior.docx");
    await writeFile(destination, "prior-bytes");
    const result = await exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => destination,
      confirmReplace: async () => false
    });
    expect(result).toBeNull();
    expect((await readFile(destination)).toString()).toBe("prior-bytes");
  });

  test("an accepted replacement overwrites after consent", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const destination = join(dir, "prior.docx");
    await writeFile(destination, "prior-bytes");
    let confirmed = 0;
    const result = await exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => destination,
      confirmReplace: async () => {
        confirmed += 1;
        return true;
      }
    });
    expect(result).toBe(destination);
    expect(confirmed).toBe(1);
    expect(Buffer.from(await readFile(destination)).subarray(0, 2).toString()).toBe("PK");
  });

  test("a file that changes after consent throws and writes nothing", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const written: string[] = [];
    const states = [{ mtimeMs: 1, size: 2 }, { mtimeMs: 3, size: 2 }];
    const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => join(dir, "changed.docx"),
      statDestination: async () => states.shift() ?? null,
      writeFile: async (path) => {
        written.push(path);
      }
    });
    await expect(promise).rejects.toMatchObject({ code: "io" });
    expect(written).toEqual([]);
  });

  test("a file created after consent throws instead of overwriting without consent", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const written: string[] = [];
    const states: (DocxExportState | null)[] = [null, { mtimeMs: 3, size: 4 }];
    const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => join(dir, "appeared.docx"),
      statDestination: async () => states.shift() ?? null,
      writeFile: async (path) => {
        written.push(path);
      }
    });
    await expect(promise).rejects.toMatchObject({ code: "io" });
    expect(written).toEqual([]);
  });

  test("an injected write failure keeps the prior file", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const destination = join(dir, "fragile.docx");
    await writeFile(destination, "prior-bytes");
    const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => destination,
      writeFile: async () => {
        throw new Error("disk is full");
      }
    });
    await expect(promise).rejects.toThrow("disk is full");
    expect((await readFile(destination)).toString()).toBe("prior-bytes");
  });

  test("a failed real write leaves no partial file behind", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    await chmod(dir, 0o555);
    try {
      const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
        ...baseDeps(dir)
      });
      await expect(promise).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  test("a failed real write keeps the prior export byte-identical", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const destination = join(dir, "the-salt-road.docx");
    await writeFile(destination, "prior-bytes");
    await chmod(dir, 0o555);
    try {
      const promise = exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, {
        ...baseDeps(dir),
        pickDestination: async () => destination
      });
      await expect(promise).rejects.toThrow();
      expect((await readFile(destination)).toString()).toBe("prior-bytes");
      expect(await readdir(dir)).toEqual(["the-salt-road.docx"]);
    } finally {
      await chmod(dir, 0o755);
    }
  });

  test("the default writer stages through a sibling temp file and leaves no debris", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const result = await exportManuscriptDocx(await library.readBook(bookId), new Map(), library.root, baseDeps(dir));
    expect(result).toBe(join(dir, "the-salt-road.docx"));
    if (!result) throw new Error("expected an export destination");
    expect(await readdir(dir)).toEqual(["the-salt-road.docx"]);
    expect(Buffer.from(await readFile(result)).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("markdown export", () => {
  async function outside(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "abs-md-out-"));
    cleanups.push(dir);
    return dir;
  }

  function baseDeps(dir: string, overrides: Partial<DocxExportDeps> = {}): DocxExportDeps {
    return {
      pickDestination: async (name) => join(dir, name),
      confirmReplace: async () => true,
      statDestination: (path) =>
        stat(path)
          .then((snapshot) => ({ mtimeMs: snapshot.mtimeMs, size: snapshot.size }))
          .catch(() => null),
      ...overrides
    };
  }

  test("joins the chapters in reading order under their titles", async () => {
    const { library, bookId } = await fixture();
    const detail = await library.readBook(bookId);
    const markdown = buildMarkdown({ ...detail, chapters: [...detail.chapters].reverse() });
    const blocks = [
      "# The Salt Road",
      "_A crossing at low tide._",
      "## The Door",
      "The hall was cold.\n\nMara closed the door.",
      "## The Gate",
      "Morning came slowly."
    ];
    expect(markdown).toBe(`${blocks.join("\n\n")}\n`);
  });

  test("suggests a file name from the book title", () => {
    expect(suggestMarkdownName("The Salt Road")).toBe("the-salt-road.md");
    expect(suggestMarkdownName("   ")).toBe("manuscript.md");
  });

  test("writes the manuscript outside the library and leaves the book untouched", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const before = await snapshotBook(library.root);
    const result = await exportManuscriptMarkdown(await library.readBook(bookId), library.root, baseDeps(dir));
    expect(result).toBe(join(dir, "the-salt-road.md"));
    expect((await readFile(join(dir, "the-salt-road.md"))).toString()).toBe(
      buildMarkdown(await library.readBook(bookId))
    );
    expect(await snapshotBook(library.root)).toEqual(before);
  });

  test("a cancelled picker returns null and writes nothing", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const result = await exportManuscriptMarkdown(await library.readBook(bookId), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => null
    });
    expect(result).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  test("a destination inside the library is refused before anything is written", async () => {
    const { library, bookId } = await fixture();
    const before = await snapshotBook(library.root);
    const promise = exportManuscriptMarkdown(await library.readBook(bookId), library.root, {
      ...baseDeps(library.root),
      pickDestination: async () => join(library.root, "books", bookId, "sneaky.md")
    });
    await expect(promise).rejects.toMatchObject({ code: "invalid" });
    expect(await snapshotBook(library.root)).toEqual(before);
  });

  test("a declined replacement returns null and keeps the prior file", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const destination = join(dir, "prior.md");
    await writeFile(destination, "prior-text");
    const result = await exportManuscriptMarkdown(await library.readBook(bookId), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => destination,
      confirmReplace: async () => false
    });
    expect(result).toBeNull();
    expect((await readFile(destination)).toString()).toBe("prior-text");
  });

  test("a file that changes after consent throws and writes nothing", async () => {
    const { library, bookId } = await fixture();
    const dir = await outside();
    const written: string[] = [];
    const states = [{ mtimeMs: 1, size: 2 }, { mtimeMs: 3, size: 2 }];
    const promise = exportManuscriptMarkdown(await library.readBook(bookId), library.root, {
      ...baseDeps(dir),
      pickDestination: async () => join(dir, "changed.md"),
      statDestination: async () => states.shift() ?? null,
      writeFile: async (path) => {
        written.push(path);
      }
    });
    await expect(promise).rejects.toMatchObject({ code: "io" });
    expect(written).toEqual([]);
  });
});
