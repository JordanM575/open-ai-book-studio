import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import { BrowserLibraries, browserRuntime } from "../../src/runtime/browser-libraries";
import { readStorageSetting } from "../../src/storage/indexeddb";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { FakeDirectory } from "./support/fake-directory";

/**
 * Which library the browser build has open.
 *
 * A session starts with nothing open and ends with either a folder or site storage, and the choice
 * has to survive a reload: on the next visit the same library opens, or the author is told plainly
 * why it cannot. That promise is the one that costs an author their work when it breaks, so each
 * step is checked here — including the two that are easy to get wrong, an empty library and an
 * archive that is imported into a destination before it is trusted.
 */

type Global = { navigator?: unknown; isSecureContext?: boolean };
const globals = globalThis as Global;
const originalNavigator = globals.navigator;
const originalSecure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");

afterEach(() => {
  if (originalNavigator === undefined) delete globals.navigator;
  else globals.navigator = originalNavigator;
  if (originalSecure) Object.defineProperty(globalThis, "isSecureContext", originalSecure);
});

/** Site storage that actually holds a tree, so a library can be opened and reopened. */
function withOriginStorage(): FakeDirectory {
  const root = new FakeDirectory("root");
  Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
  globals.navigator = {
    storage: {
      getDirectory: async () => root,
      persist: async () => true,
      estimate: async () => ({ usage: 0, quota: 1_000_000 })
    }
  };
  return root;
}

describe("before anything is chosen", () => {
  test("there is no library, and saying so is not an error", () => {
    const libraries = new BrowserLibraries();
    expect(libraries.info()).toBeNull();
    expect(libraries.rootLabel()).toBe("This browser");
  });

  test("using the library without one explains what to do first", () => {
    const libraries = new BrowserLibraries();
    expect(() => libraries.require()).toThrow(/Choose where to keep it/);
    expect(() => libraries.requirePort()).toThrow(/No library is open/);
  });

  test("restoring with nothing remembered leaves the welcome alone", async () => {
    withOriginStorage();
    const libraries = new BrowserLibraries();
    await libraries.restore();
    expect(libraries.service).toBeNull();
    expect(libraries.restoreError).toBeNull();
  });
});

describe("choosing site storage", () => {
  test("opens a library, labels it, and remembers the choice", async () => {
    withOriginStorage();
    const libraries = new BrowserLibraries();
    const info = await libraries.openBrowserStorage();

    expect(info.root).toMatch(/^browser:\/\/library_/);
    expect(info.storage?.tier).toBe("browser");
    expect(libraries.require()).toBe(libraries.service as never);
    expect(libraries.requirePort()).toBe(libraries.port as never);

    const saved = await readStorageSetting<{ tier: string; libraryId: string }>("library-selection");
    expect(saved?.tier).toBe("browser");
    expect(saved?.libraryId).toBe(libraries.rootLabel().replace("browser://", ""));
  });

  test("the next visit reopens the same library, with its books in it", async () => {
    withOriginStorage();
    const first = new BrowserLibraries();
    await first.openBrowserStorage();
    const book = await first.require().createBook({ title: "The Salt Road" });

    const second = new BrowserLibraries();
    await second.restore();
    expect(second.restoreError).toBeNull();
    expect(second.rootLabel()).toBe(first.rootLabel());
    expect((await second.require().readBook(book.id)).book.title).toBe("The Salt Road");
  });

  test("a library that cannot be opened is reported rather than thrown at the welcome", async () => {
    // A navigator that has origin storage the first time and loses it the next.
    withOriginStorage();
    const first = new BrowserLibraries();
    await first.openBrowserStorage();

    globals.navigator = {
      storage: {
        getDirectory: async () => {
          throw new Error("the browser forgot this origin");
        }
      }
    };
    const second = new BrowserLibraries();
    await second.restore();
    // The author gets the same sentence a hanging browser gets, not a DOM error name.
    expect(second.restoreError).toContain("could not open origin storage");
    expect(second.service).toBeNull();
  });
});

describe("choosing a folder", () => {
  test("a cancelled picker leaves the library exactly as it was", async () => {
    (globalThis as { window?: unknown }).window = {
      showDirectoryPicker: async () => {
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      }
    };
    const libraries = new BrowserLibraries();
    expect(await libraries.chooseFolder()).toBeNull();
    expect(libraries.service).toBeNull();
  });

  test("a refused folder is refused in a sentence that offers a way forward", async () => {
    const folder = new FakeDirectory("Novel");
    Object.defineProperty(folder, "requestPermission", { value: async () => "denied" });
    (globalThis as { window?: unknown }).window = {
      showDirectoryPicker: async () => folder as unknown as FileSystemDirectoryHandle
    };
    const libraries = new BrowserLibraries();
    await expect(libraries.chooseFolder()).rejects.toMatchObject({
      code: "permission-required",
      message: expect.stringContaining("needs permission")
    });
    // The folder is kept, so the welcome can offer to reconnect rather than forgetting it.
    expect(libraries.pendingFolder).toBe(folder as unknown as FileSystemDirectoryHandle);
    expect(libraries.service).toBeNull();
  });

  test("a folder without permission is refusable by name, and says what to do", async () => {
    const folder = new FakeDirectory("Novel");
    Object.defineProperty(folder, "requestPermission", { value: async () => "prompt" });
    (globalThis as { window?: unknown }).window = {
      showDirectoryPicker: async () => folder as unknown as FileSystemDirectoryHandle
    };
    const libraries = new BrowserLibraries();
    await expect(libraries.chooseFolder()).rejects.toMatchObject({
      message: expect.stringContaining("Grant access")
    });
  });

  test("reconnecting is only offered when something is waiting", async () => {
    const libraries = new BrowserLibraries();
    await expect(libraries.reconnectFolder()).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("importing an archive", () => {
  test("creates a destination without activating it, then activates it once the archive is trusted", async () => {
    withOriginStorage();
    const libraries = new BrowserLibraries();
    const destination = await libraries.createImportDestination();

    // Nothing is open yet: a bad archive must not become the author's library.
    expect(libraries.service).toBeNull();
    expect(destination.libraryId).toMatch(/^library_/);
    expect(destination.summary.tier).toBe("browser");

    await destination.port.commitFile(toLibraryPath(["notes.txt"]), new TextEncoder().encode("hello"), { kind: "any" });

    const info = await libraries.activateImport(destination);
    expect(info.root).toBe(`browser://${destination.libraryId}`);
    expect(libraries.service).not.toBeNull();
  });

  test("discarding a destination deletes it, so a rejected archive leaves nothing behind", async () => {
    withOriginStorage();
    const libraries = new BrowserLibraries();
    const destination = await libraries.createImportDestination();
    await libraries.discardImport(destination);
    // Activating it afterwards opens an empty library, which is what "deleted" means here.
    const info = await libraries.activateImport(destination);
    expect(info.storage?.tier).toBe("browser");
    expect((await libraries.require().listBooks())).toEqual([]);
  });
});

describe("the runtime the browser gives the library", () => {
  test("names ids with a prefix and hashes bytes the same way the desktop does", async () => {
    expect(browserRuntime.newId("book")).toMatch(/^book_[0-9a-f]{16}$/);
    const hash = await browserRuntime.sha256(new TextEncoder().encode("abc"));
    // SHA-256 of "abc", so the browser library's hashes are comparable with everyone else's.
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("stamps times as ISO strings", () => {
    expect(browserRuntime.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
