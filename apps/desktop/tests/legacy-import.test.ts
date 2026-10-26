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
});
