import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { bookFilePath } from "../src/library/paths";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * Spec 035 T008 premises. These pin the persistence facts the format-profile
 * decision rests on; they choose nothing. A future profile shape must respect
 * what is proven here: unknown fields survive supported saves, both top-level
 * and nested under `settings`, including across the full-settings merge the
 * FormatDialog performs. Until 2026-11-04 a nested section was stripped; every
 * object in `book.json` is now loose (FORMAT.md, D-170's update).
 */

async function seedSettings(
  port: InMemoryLibraryPort,
  bookId: string,
  settings: Record<string, unknown>
): Promise<void> {
  const snapshot = await port.readFile(bookFilePath(bookId));
  const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes ?? new Uint8Array())) as Record<
    string,
    unknown
  >;
  raw.settings = settings;
  await port.commitFile(bookFilePath(bookId), new TextEncoder().encode(`${JSON.stringify(raw)}\n`), {
    kind: "any"
  });
}

describe("format profile premises", () => {
  test("a profile section nested under settings survives a supported save", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const detail = await service.readBook(book.id);
    await seedSettings(port, book.id, {
      ...detail.book.settings,
      formatProfiles: { PDF: { bodyFontSize: 11 } }
    });

    const updated = await service.updateBook(book.id, { title: "The Salt Crossing" });
    // The settings object keeps what it does not know, so a nested section is no
    // longer silent data loss; it is written back exactly as it was read.
    expect((updated.settings as Record<string, unknown>).formatProfiles).toEqual({ PDF: { bodyFontSize: 11 } });
    expect(updated.settings.manuscript.bodyFontSize).toBe(12);
    const written = await port.readFile(bookFilePath(book.id));
    const raw = JSON.parse(new TextDecoder().decode(written?.bytes ?? new Uint8Array())) as {
      settings: Record<string, unknown>;
    };
    expect(raw.settings.formatProfiles).toEqual({ PDF: { bodyFontSize: 11 } });
  });

  test("a full-settings merge keeps a top-level profile section", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const snapshot = await port.readFile(bookFilePath(book.id));
    const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes ?? new Uint8Array())) as Record<
      string,
      unknown
    >;
    raw.formatProfiles = { PDF: { bodyFontSize: 11 } };
    await port.commitFile(bookFilePath(book.id), new TextEncoder().encode(`${JSON.stringify(raw)}\n`), {
      kind: "any"
    });

    const reread = await service.readBook(book.id);
    const merged = await service.updateBook(book.id, {
      settings: {
        ...reread.book.settings,
        manuscript: { ...reread.book.settings.manuscript, bodyFont: "Georgia" }
      }
    });
    // The FormatDialog merge pattern is compatible with top-level profiles: the merge
    // touches settings only, so a top-level section rides along untouched.
    expect((merged as Record<string, unknown>).formatProfiles).toEqual({
      PDF: { bodyFontSize: 11 }
    });
    expect(merged.settings.manuscript.bodyFont).toBe("Georgia");
  });

  test("an unknown top-level profile field survives alongside settings", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const snapshot = await port.readFile(bookFilePath(book.id));
    const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes ?? new Uint8Array())) as Record<
      string,
      unknown
    >;
    raw.formatProfiles = { PDF: { bodyFontSize: 11 } };
    await port.commitFile(bookFilePath(book.id), new TextEncoder().encode(`${JSON.stringify(raw)}\n`), {
      kind: "any"
    });

    const updated = await service.updateBook(book.id, { title: "The Salt Crossing" });
    expect((updated as Record<string, unknown>).formatProfiles).toEqual({
      PDF: { bodyFontSize: 11 }
    });
  });
});
