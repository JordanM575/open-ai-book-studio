import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/store";
import { importLegacyBackup } from "../src/main/legacy-import";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<Library> {
  const root = await mkdtemp(join(tmpdir(), "abs-legacy-"));
  cleanups.push(root);
  return Library.open(root);
}

function backup(overrides: Record<string, unknown> = {}) {
  return {
    app: "moms-ai-book-studio",
    version: 1,
    exportedAt: "2026-01-02T03:04:05.000Z",
    books: [
      {
        title: "The Salt Road",
        description: "A crossing at low tide.",
        genres: ["Fantasy", "Adventure"],
        influences: ["Ursula K. Le Guin"],
        outline: "Mara crosses the salt road.",
        stage: "drafting",
        manuscriptSettings: { bodyFont: "Georgia", bodyFontSize: 11 },
        characters: [
          {
            name: "Mara",
            role: "Keeper",
            description: "Keeps the light.",
            motivations: ["home", "the sea"],
            notes: "Steady."
          }
        ],
        memories: [{ text: "The sea is grey.", importance: "high" }],
        scenes: [
          {
            title: "The Door",
            draftContent: "The hall was cold.",
            arc: "beginning",
            purpose: "Open the story",
            synopsis: "Mara arrives.",
            notes: "Quiet.",
            isPrologue: true
          },
          { title: "The Gate", draftContent: "Morning came slowly." }
        ],
        ...overrides
      }
    ]
  };
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pictureBackup() {
  return {
    app: "moms-ai-book-studio",
    version: 1,
    books: [
      {
        title: "Harbour Light",
        manuscript: "A new shore.",
        imagePages: [
          { caption: "The lighthouse", currentVersion: "v1", cover: true },
          { caption: "The boats", versions: ["v2"] }
        ]
      }
    ],
    imageMap: {
      v1: {
        mimeType: "image/png",
        data: TINY_PNG_BASE64,
        prompt: "A lighthouse.",
        model: "old-model",
        costUsd: 0.02
      },
      // Declared as JPEG but carrying PNG bytes: the file's bytes win and the report says so.
      v2: { mimeType: "image/jpeg", data: TINY_PNG_BASE64 }
    }
  };
}

describe("legacy import", () => {
  test("imports a book with its chapters, cast and memories", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(library, backup());

    expect(report.imported).toBe(1);
    expect(report.books[0]?.chapters).toBe(2);
    expect(report.books[0]?.characters).toBe(1);
    expect(report.books[0]?.memories).toBe(1);
    expect(report.warnings).toEqual([]);

    const summaries = await library.listBooks();
    const summary = summaries[0];
    expect(summary?.title).toBe("The Salt Road");

    const detail = await library.readBook(summary!.id);
    expect(detail.book.genres).toEqual(["Fantasy", "Adventure"]);
    expect(detail.book.influences).toEqual(["Ursula K. Le Guin"]);
    expect(detail.book.settings.manuscript.bodyFont).toBe("Georgia");
    expect(detail.book.settings.manuscript.bodyFontSize).toBe(11);
    expect(detail.book.characters[0]?.motivations).toBe("home\nthe sea");
    expect(detail.book.memories[0]?.text).toBe("The sea is grey.");

    const first = detail.chapters[0];
    expect(first?.title).toBe("The Door");
    expect(first?.content.trim()).toBe("The hall was cold.");
    expect(first?.isPrologue).toBe(true);
    expect(first?.arc).toBe("beginning");
    expect(first?.synopsis).toBe("Mara arrives.");
    expect(detail.chapters[1]?.title).toBe("The Gate");
  });

  test("keeps a manuscript-only backup as one chapter", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(library, {
      app: "moms-ai-book-studio",
      version: 1,
      books: [{ title: "Notes", manuscript: "One long draft." }]
    });

    expect(report.books[0]?.chapters).toBe(1);
    const summary = (await library.listBooks())[0];
    const detail = await library.readBook(summary!.id);
    expect(detail.chapters[0]?.title).toBe("Manuscript");
    expect(detail.chapters[0]?.content.trim()).toBe("One long draft.");
  });

  test("keeps an earlier manuscript when scenes exist", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(library, backup({ manuscript: "An older draft." }));

    expect(report.books[0]?.chapters).toBe(3);
    expect(report.warnings.join(" ")).toContain("earlier whole-book manuscript");
    const summary = (await library.listBooks())[0];
    const detail = await library.readBook(summary!.id);
    expect(detail.chapters.at(-1)?.title).toBe("Earlier manuscript");
  });

  test("accepts a bare library state and rejects another app", async () => {
    const library = await fixture();
    const state = { books: [{ title: "Bare", manuscript: "Text." }] };
    const report = await importLegacyBackup(library, state);
    expect(report.imported).toBe(1);

    await expect(
      importLegacyBackup(library, { app: "another-app", version: 1, books: [] })
    ).rejects.toThrow(/another app/i);
  });

  test("a second run over the same export creates nothing and names what it recognised", async () => {
    const library = await fixture();
    const first = await importLegacyBackup(library, backup());
    expect(first.imported).toBe(1);

    const booksBefore = await library.listBooks();
    const chaptersBefore = (await library.readBook(booksBefore[0]!.id)).chapters.length;

    const second = await importLegacyBackup(library, backup());
    expect(second.imported).toBe(0);
    expect(second.warnings).toEqual([]);
    expect(second.recognised.map((entry) => entry.title)).toEqual(["The Salt Road"]);

    const booksAfter = await library.listBooks();
    expect(booksAfter.map((book) => book.id)).toEqual(booksBefore.map((book) => book.id));
    expect((await library.readBook(booksAfter[0]!.id)).chapters.length).toBe(chaptersBefore);
  });

  test("an export with an added book imports only the new one", async () => {
    const library = await fixture();
    const firstExport = backup();
    await importLegacyBackup(library, firstExport);

    const secondExport = {
      ...firstExport,
      books: [...firstExport.books, { title: "Harbour Light", manuscript: "A new shore." }]
    };
    const second = await importLegacyBackup(library, secondExport);
    expect(second.imported).toBe(1);
    expect(second.recognised.map((entry) => entry.title)).toEqual(["The Salt Road"]);

    const titles = (await library.listBooks()).map((book) => book.title).sort();
    expect(titles).toEqual(["Harbour Light", "The Salt Road"]);
  });

  test("an unreadable import record warns and imports everything again", async () => {
    const library = await fixture();
    await importLegacyBackup(library, backup());

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(library.root, ".studio"), { recursive: true });
    await writeFile(join(library.root, ".studio", "migrations.json"), "not json");

    const report = await importLegacyBackup(library, backup());
    expect(report.imported).toBe(1);
    expect(report.recognised).toEqual([]);
    expect(report.warnings.join(" ")).toContain("import record could not be read");
  });

  test("imports pictures byte-identical with their data and counts them", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(library, pictureBackup());

    expect(report.imported).toBe(1);
    expect(report.books[0]?.images).toBe(2);
    expect(report.warnings.join(" ")).toContain("was image/jpeg but it decoded as image/png");

    const summary = (await library.listBooks())[0];
    const listed = await library.listImages(summary!.id);
    expect(listed.manifest.images.length).toBe(2);
    const expected = Buffer.from(TINY_PNG_BASE64, "base64");
    for (const record of listed.manifest.images) {
      expect(record.source).toBe("imported");
      expect(record.mimeType).toBe("image/png");
      expect(record.width).toBe(1);
      expect(record.height).toBe(1);
      expect(record.bytes).toBe(expected.byteLength);
      const stored = await library.readImage(summary!.id, record.id);
      expect(Buffer.from(stored!.bytes).equals(expected)).toBe(true);
    }

    const cover = listed.manifest.images.find((image) => image.kind === "cover");
    expect(cover?.prompt).toBe("A lighthouse.");
    expect(cover?.model).toBe("old-model");
    expect(cover?.costUsd).toBe(0.02);
    expect(cover?.provider).toBe("legacy-import");
  });

  test("missing and unreadable pictures warn and keep the book", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(library, {
      app: "moms-ai-book-studio",
      version: 1,
      books: [
        {
          title: "Harbour Light",
          manuscript: "A new shore.",
          imagePages: [
            { caption: "Lost", currentVersion: "gone" },
            { caption: "Broken", currentVersion: "bad" }
          ]
        }
      ],
      imageMap: { bad: { mimeType: "image/png", data: "not-a-picture" } }
    });

    expect(report.imported).toBe(1);
    expect(report.books[0]?.images).toBe(0);
    const text = report.warnings.join(" ");
    expect(text).toContain("named the picture “Lost” but it was missing from the file");
    expect(text).toContain("could not read the picture “Broken”");
    const summary = (await library.listBooks())[0];
    expect((await library.readBook(summary!.id)).chapters.length).toBe(1);
  });

  test("a second run over pictures recognises the book and adds nothing", async () => {
    const library = await fixture();
    const payload = pictureBackup();
    const first = await importLegacyBackup(library, payload);
    expect(first.books[0]?.images).toBe(2);

    const second = await importLegacyBackup(library, payload);
    expect(second.imported).toBe(0);
    expect(second.recognised.map((entry) => entry.title)).toEqual(["Harbour Light"]);

    const summary = (await library.listBooks())[0];
    expect((await library.listImages(summary!.id)).manifest.images.length).toBe(2);
  });

  test("carries outline, story arc, front matter and scene notes across", async () => {
    const library = await fixture();
    const report = await importLegacyBackup(
      library,
      backup({
        storyArc: {
          beginning: {
            overview: "Mara leaves.",
            keyMoments: ["The tide turns", "The bell"],
            openQuestions: "Who follows?"
          },
          middle: "The crossing.",
          end: { overview: "Arrival." }
        },
        frontMatter: {
          subtitle: "A tidewater tale",
          dedication: "For those who wait."
        }
      })
    );

    expect(report.imported).toBe(1);
    expect(report.warnings).toEqual([]);
    const summary = (await library.listBooks())[0];
    const detail = await library.readBook(summary!.id);

    expect(detail.book.outline).toBe("Mara crosses the salt road.");
    expect(detail.book.storyArc.beginning.overview).toBe("Mara leaves.");
    expect(detail.book.storyArc.beginning.keyMoments).toBe("The tide turns\nThe bell");
    expect(detail.book.storyArc.beginning.openQuestions).toBe("Who follows?");
    expect(detail.book.storyArc.middle.overview).toBe("The crossing.");
    expect(detail.book.storyArc.end.overview).toBe("Arrival.");
    expect(detail.book.frontMatter).toMatchObject({
      subtitle: "A tidewater tale",
      dedication: "For those who wait."
    });

    const first = detail.chapters[0];
    expect(first?.purpose).toBe("Open the story");
    expect(first?.notes).toBe("Quiet.");
  });
});
