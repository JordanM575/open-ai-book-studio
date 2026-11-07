import { describe, expect, test } from "bun:test";
import { bookChanges, mergeValue, rewrite, sameValue } from "../src/library/book-merge";
import { LibraryService } from "../src/library/service";
import { bookFilePath } from "../src/library/paths";
import type { CommitFileResult, FileExpectation, LibraryPath } from "../src/library/port";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const MARA = { id: "char_mara000001", name: "Mara", role: "Keeper", description: "", motivations: "", notes: "" };
const JONAH = { id: "char_jonah00001", name: "Jonah", role: "Ferryman", description: "", motivations: "", notes: "" };

function merge(base: unknown, mine: unknown, theirs: unknown, path: string[]) {
  const overlaps: string[] = [];
  return { ...mergeValue(base, mine, theirs, path, overlaps), overlaps };
}

describe("book field merge", () => {
  test("compares JSON values, not key order, and treats an undefined key as missing", () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameValue("1", 1)).toBe(false);
  });

  test("names only the fields that changed, each with the value it started from", () => {
    const book = { title: "The Salt Road", genres: ["Literary"], outline: "Two sisters." };
    expect(bookChanges(book, { title: "The Salt Road", genres: ["Literary"], outline: "Three sisters." })).toEqual({
      outline: { from: "Two sisters.", to: "Three sisters." }
    });
  });

  test("a part one side changed takes that side; a part both changed keeps theirs and records mine", () => {
    expect(merge("a", "b", "a", ["outline"])).toEqual({ value: "b", mine: "b", overlaps: [] });
    expect(merge("a", "a", "c", ["outline"])).toEqual({ value: "c", mine: "c", overlaps: [] });
    expect(merge("a", "b", "b", ["outline"])).toEqual({ value: "b", mine: "b", overlaps: [] });
    expect(merge("a", "b", "c", ["outline"])).toEqual({ value: "c", mine: "b", overlaps: ["outline"] });
  });

  test("objects merge key by key, keeping keys only the other writer knows", () => {
    const base = { beginning: { overview: "", keyMoments: "" }, end: { overview: "" } };
    const mine = { beginning: { overview: "The tide.", keyMoments: "" }, end: { overview: "" } };
    const theirs = { beginning: { overview: "", keyMoments: "The storm." }, end: { overview: "", future: 1 } };
    expect(merge(base, mine, theirs, ["storyArc"])).toEqual({
      value: { beginning: { overview: "The tide.", keyMoments: "The storm." }, end: { overview: "", future: 1 } },
      mine: { beginning: { overview: "The tide.", keyMoments: "The storm." }, end: { overview: "", future: 1 } },
      overlaps: []
    });
  });

  test("the cast merges by id: an addition on one side and an edit on the other both land", () => {
    const merged = merge([MARA], [{ ...MARA, role: "Lighthouse keeper" }], [MARA, JONAH], ["characters"]);
    expect(merged.value).toEqual([{ ...MARA, role: "Lighthouse keeper" }, JONAH]);
    expect(merged.overlaps).toEqual([]);
  });

  test("a record one side removed and the other edited stays where it was edited", () => {
    const edited = { ...MARA, role: "Lighthouse keeper" };
    const removedByMe = merge([MARA], [], [edited], ["characters"]);
    expect(removedByMe).toEqual({ value: [edited], mine: [], overlaps: ["characters.char_mara000001"] });

    const removedByThem = merge([MARA], [edited], [], ["characters"]);
    expect(removedByThem).toEqual({ value: [], mine: [edited], overlaps: ["characters.char_mara000001"] });
  });

  test("a memory both sides edited keeps both fields, and its updatedAt takes the later stamp", () => {
    const memory = { id: "mem_tide0000001", text: "Early.", importance: "medium", updatedAt: "2026-11-04T08:00:00.000Z" };
    const mine = { ...memory, text: "Early, always.", updatedAt: "2026-11-04T09:00:00.000Z" };
    const theirs = { ...memory, importance: "high", updatedAt: "2026-11-04T08:30:00.000Z" };
    const merged = merge([memory], [mine], [theirs], ["memories"]);
    expect(merged.value).toEqual([{ ...memory, text: "Early, always.", importance: "high", updatedAt: "2026-11-04T09:00:00.000Z" }]);
    expect(merged.overlaps).toEqual([]);
  });

  test("a list with a repeated id is one value, so no record is folded into another", () => {
    const twin = { ...MARA, name: "Mara's twin" };
    const merged = merge([MARA, twin], [MARA], [MARA, twin, JONAH], ["characters"]);
    expect(merged.value).toEqual([MARA, twin, JONAH]);
    expect(merged.overlaps).toEqual(["characters"]);
  });

  test("other arrays, such as genres, are one value", () => {
    expect(merge(["A"], ["A", "B"], ["A", "C"], ["genres"])).toEqual({ value: ["A", "C"], mine: ["A", "B"], overlaps: ["genres"] });
  });

  test("the rewrite replaces only what changed and keeps every other part as it was read", () => {
    const raw = { title: "Old", storyArc: { beginning: { keyMoments: ["a", "b"] }, end: { overview: "x" } } };
    const fresh = {
      title: "Old",
      outline: "",
      storyArc: { beginning: { overview: "", keyMoments: "a\nb" }, end: { overview: "x", keyMoments: "" } }
    };
    const next = { ...fresh, storyArc: { ...fresh.storyArc, end: { overview: "y", keyMoments: "" } } };
    expect(rewrite(raw, fresh, next)).toEqual({ title: "Old", storyArc: { beginning: { keyMoments: ["a", "b"] }, end: { overview: "y" } } });
  });
});

/** A port where another writer commits `book.json` just before this one does, once. */
class RacingPort extends InMemoryLibraryPort {
  race: ((port: InMemoryLibraryPort) => Promise<void>) | null = null;

  override async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const race = this.race;
    if (race && expected.kind === "sha256" && path.join("/").endsWith("book.json")) {
      this.race = null;
      await race(this);
    }
    return super.commitFile(path, bytes, expected);
  }
}

async function writeElsewhere(port: InMemoryLibraryPort, bookId: string, change: (raw: Record<string, unknown>) => void) {
  const snapshot = await port.readFile(bookFilePath(bookId));
  const raw = JSON.parse(new TextDecoder().decode(snapshot?.bytes)) as Record<string, unknown>;
  change(raw);
  await port.commitFile(bookFilePath(bookId), new TextEncoder().encode(JSON.stringify(raw)), { kind: "any" });
}

describe("committing book.json", () => {
  test("a write that lands between the read and the commit is merged in, not overwritten", async () => {
    const port = new RacingPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road", outline: "Two sisters." });
    port.race = (other) =>
      writeElsewhere(other, book.id, (raw) => {
        raw.characters = [JONAH];
      });

    const result = await service.editBook(book.id, { outline: { from: "Two sisters.", to: "Three sisters." } });

    expect(result.status).toBe("saved");
    const { book: saved } = await service.readBook(book.id);
    expect(saved.outline).toBe("Three sisters.");
    expect(saved.characters).toEqual([JONAH]);
  });

  test("an edit that changes nothing writes nothing", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road" });
    const before = await port.readFile(bookFilePath(book.id));

    const result = await service.editBook(book.id, { title: { from: "The Salt Road", to: "The Salt Road" } });

    expect(result).toEqual({ status: "saved", book });
    expect((await port.readFile(bookFilePath(book.id)))?.sha256).toBe(before?.sha256);
  });

  test("when every change overlaps, the file stays as the other writer left it and the copy holds the editor's", async () => {
    const port = new InMemoryLibraryPort();
    const service = await LibraryService.open({ storage: port, runtime: port });
    const book = await service.createBook({ title: "The Salt Road", outline: "Two sisters." });
    await writeElsewhere(port, book.id, (raw) => {
      raw.outline = "Three sisters.";
    });
    const before = await port.readFile(bookFilePath(book.id));

    const result = await service.editBook(book.id, { outline: { from: "Two sisters.", to: "Two sisters and a letter." } });

    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    expect(result.fields).toEqual(["outline"]);
    expect(result.book.outline).toBe("Three sisters.");
    expect((await port.readFile(bookFilePath(book.id)))?.sha256).toBe(before?.sha256);
    const copy = await port.readFile(result.savedAs.split("/"));
    expect(JSON.parse(new TextDecoder().decode(copy?.bytes)).outline).toBe("Two sisters and a letter.");
    expect((await service.listConflicts(book.id)).map((conflict) => conflict.savedAs)).toEqual([result.savedAs]);
  });
});
