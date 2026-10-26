import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { BrowserLibraries } from "../../src/runtime/browser-libraries";
import { FakeDirectory } from "./support/fake-directory";

type GlobalWithWindow = { window?: unknown };
const originalWindow = (globalThis as GlobalWithWindow).window;

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as GlobalWithWindow).window;
  else (globalThis as GlobalWithWindow).window = originalWindow;
});

describe("browser folder mode", () => {
  test("opens a picked folder and writes a book through it", async () => {
    const root = new FakeDirectory("Novel");
    (globalThis as GlobalWithWindow).window = {
      showDirectoryPicker: async () => root as unknown as FileSystemDirectoryHandle
    };
    const libraries = new BrowserLibraries();

    const info = await libraries.chooseFolder();
    expect(info?.root).toBe("folder://Novel");
    expect(info?.storage?.tier).toBe("folder");

    const book = await libraries.require().createBook({ title: "Folder Book" });
    const chapter = await libraries.require().createChapter(book.id, { title: "One", content: "Folder prose.\n" });
    const saved = await libraries.require().saveChapter(book.id, chapter.id, "Updated.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(saved.status).toBe("saved");
    expect((await libraries.require().readChapter(book.id, chapter.id)).content).toBe("Updated.\n");
  });
});
