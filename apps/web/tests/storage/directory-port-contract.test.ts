import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryFileSnapshot
} from "@ai-book-studio/core/library/port";
import { DirectoryHandleLibraryPort, webLock, webLocksAvailable } from "../../src/storage/directory-port";
import { FakeDirectory, domError } from "./support/fake-directory";

/**
 * The folder adapter, on its own.
 *
 * This is the object both browser storage and a chosen folder are made of, and the desktop library
 * is built on the same port contract. Everything that can cost an author a file happens in the
 * three lines around `createWritable` — the version check before, the re-check before `close`, and
 * the read-back after — so those are what this file is about.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The port, with paths written the way a reader thinks of them.
 *
 * The real port takes a branded `LibraryPath`, which is the right type for production and noise in
 * a test that is about file behaviour. The proxy converts at the boundary so the expectations read
 * `["books", "book_a", "book.json"]` rather than a cast.
 */
interface TestPort {
  readFile(path: string[]): Promise<LibraryFileSnapshot | null>;
  listDirectory(path: string[]): Promise<LibraryEntry[]>;
  stat(path: string[]): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null>;
  ensureDirectory(path: string[]): Promise<void>;
  commitFile(path: string[], bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult>;
  moveFile(from: string[], to: string[]): Promise<void>;
  moveDirectory(from: string[], to: string[]): Promise<void>;
  removeFile(path: string[]): Promise<void>;
  deviceInfo(): Promise<LibraryDeviceInfo>;
}

const PATH_METHODS = new Set([
  "readFile",
  "listDirectory",
  "stat",
  "ensureDirectory",
  "commitFile",
  "moveFile",
  "moveDirectory",
  "removeFile"
]);

function port(hooks: (directory: FakeDirectory) => void = () => {}) {
  const root = new FakeDirectory("library");
  hooks(root);
  const real = new DirectoryHandleLibraryPort(root as unknown as FileSystemDirectoryHandle);
  // A plain `string[]` is what a reader of this file thinks in; the port wants a branded path.
  const api = new Proxy(real, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || !PATH_METHODS.has(String(key))) return value;
      return (...args: unknown[]) =>
        (value as (...given: unknown[]) => unknown).apply(
          target,
          args.map((argument) => (Array.isArray(argument) ? toLibraryPath(argument as string[]) : argument))
        );
    }
  }) as unknown as TestPort;
  return { root, api };
}

async function seed(api: TestPort, path: string[], text: string): Promise<void> {
  const written = await api.commitFile(path, encoder.encode(text), { kind: "absent" });
  expect(written.status).toBe("written");
}

describe("reading", () => {
  test("a missing file is null, not an error", async () => {
    const { api } = port();
    expect(await api.readFile(["nope.md"])).toBeNull();
  });

  test("a file comes back with the bytes and the hash the rest of the app verifies against", async () => {
    const { api } = port();
    await seed(api, ["books", "book_a", "book.json"], '{"id":"book_a"}');
    const snapshot = await api.readFile(["books", "book_a", "book.json"]);
    expect(decoder.decode(snapshot?.bytes)).toBe('{"id":"book_a"}');
    expect(snapshot?.sha256).toBe(hash(encoder.encode('{"id":"book_a"}')));
    expect(snapshot?.createdAt).toBeNull();
  });

  test("a file's path is validated before it touches the browser", async () => {
    const { api } = port();
    // A traversal is refused by the port rather than by the platform, so it is the same on disk.
    const refusal = await (async () => {
      try {
        return await api.readFile(["..", "outside.txt"]);
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toMatchObject({ name: "LibraryPortError", code: "invalid-path" });
  });

  test("a directory listing is sorted, and says which entries are folders", async () => {
    const { api } = port();
    await seed(api, ["books", "book_a", "b.json"], "{}");
    await api.ensureDirectory(["books", "book_b"]);
    const entries = await api.listDirectory(["books"]);
    expect(entries).toEqual([
      { name: "book_a", kind: "directory" },
      { name: "book_b", kind: "directory" }
    ]);
    expect(await api.listDirectory(["books", "book_a"])).toEqual([{ name: "b.json", kind: "file" }]);
  });

  test("listing a folder that is not there is an empty list", async () => {
    const { api } = port();
    expect(await api.listDirectory(["missing"])).toEqual([]);
  });

  test("stat reports the size without reading the file", async () => {
    const { api } = port();
    await seed(api, ["one.md"], "12345");
    expect((await api.stat(["one.md"]))?.size).toBe(5);
    expect(await api.stat(["two.md"])).toBeNull();
  });

  test("ensureDirectory creates every level it is given", async () => {
    const { api, root } = port();
    await api.ensureDirectory(["books", "book_a", "chapters"]);
    expect(root.directories.get("books")?.directories.get("book_a")?.directories.has("chapters")).toBe(true);
  });
});

describe("committing a file", () => {
  test("writes the bytes and reports the hash it wrote", async () => {
    const { api } = port();
    const bytes = encoder.encode("The storm came in low.");
    const result = await api.commitFile(["ch.md"], bytes, { kind: "absent" });
    expect(result.status).toBe("written");
    if (result.status === "written") expect(result.snapshot.sha256).toBe(hash(bytes));
  });

  test("refuses a file that appeared when it expected none", async () => {
    const { api } = port();
    await seed(api, ["ch.md"], "someone else's words");
    const result = await api.commitFile(["ch.md"], encoder.encode("mine"), { kind: "absent" });
    expect(result.status).toBe("changed");
    if (result.status === "changed") expect(decoder.decode(result.current?.bytes)).toBe("someone else's words");
    // Nothing was overwritten: the author's file is exactly as it was.
    expect(decoder.decode((await api.readFile(["ch.md"]))?.bytes)).toBe("someone else's words");
  });

  test("refuses a write based on a version that has moved", async () => {
    const { api } = port();
    await seed(api, ["ch.md"], "first");
    const result = await api.commitFile(["ch.md"], encoder.encode("second"), {
      kind: "sha256",
      value: hash(encoder.encode("not what is there"))
    });
    expect(result.status).toBe("changed");
    expect(decoder.decode((await api.readFile(["ch.md"]))?.bytes)).toBe("first");
  });

  test("writes when the hash it was given is the one on disk", async () => {
    const { api } = port();
    await seed(api, ["ch.md"], "first");
    const result = await api.commitFile(["ch.md"], encoder.encode("second"), {
      kind: "sha256",
      value: hash(encoder.encode("first"))
    });
    expect(result.status).toBe("written");
    expect(decoder.decode((await api.readFile(["ch.md"]))?.bytes)).toBe("second");
  });

  test("a writer that lands between the read and the close loses nothing", async () => {
    // The other tab writes while our swap file is open. close() is the commit point, so the
    // re-check before it is the only thing that keeps one of the two versions alive.
    let writes = 0;
    const { root, api } = port((directory) => {
      directory.hooks.afterWrite = (name, dir) => {
        if (name !== "ch.md") return;
        writes += 1;
        // The seed write is ours; the second one is the other tab landing mid-commit.
        if (writes === 1) return;
        dir.files.set("ch.md", { bytes: encoder.encode("the other tab"), lastModified: Date.now() });
      };
    });
    await seed(api, ["ch.md"], "first");
    const result = await api.commitFile(["ch.md"], encoder.encode("mine"), {
      kind: "sha256",
      value: hash(encoder.encode("first"))
    });
    expect(result.status).toBe("changed");
    expect(decoder.decode(root.files.get("ch.md")?.bytes)).toBe("the other tab");
  });

  test("a file that changes under the close is reported as theirs, not ours", async () => {
    const { root, api } = port((directory) => {
      directory.hooks.afterClose = (name, dir) => {
        if (name !== "ch.md") return;
        dir.files.set("ch.md", { bytes: encoder.encode("changed after the close"), lastModified: Date.now() });
      };
    });
    const result = await api.commitFile(["ch.md"], encoder.encode("mine"), { kind: "absent" });
    // Our bytes are not what a reader would find, so reporting success would be a lie.
    expect(result.status).toBe("changed");
    expect(decoder.decode(root.files.get("ch.md")?.bytes)).toBe("changed after the close");
  });

  test("a full disk is a storage-full refusal rather than a DOM error name", async () => {
    const { api } = port((directory) => {
      directory.hooks.fail = (stage) => (stage === "write" ? domError("QuotaExceededError") : undefined);
    });
    const failure = await api.commitFile(["ch.md"], encoder.encode("x"), { kind: "absent" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "storage-full", retryable: true });
  });

  test("a permission that was taken away says so, in the author's words", async () => {
    const { api } = port((directory) => {
      directory.hooks.fail = (stage) => (stage === "createWritable" ? domError("NotAllowedError") : undefined);
    });
    const failure = await api.commitFile(["ch.md"], encoder.encode("x"), { kind: "absent" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "permission-required" });
    expect((failure as Error).message).toContain("permission");
  });

  test("a read-only folder says nothing was replaced", async () => {
    const { api } = port((directory) => {
      directory.hooks.fail = (stage) => (stage === "createWritable" ? domError("NoModificationAllowedError") : undefined);
    });
    const failure = await api.commitFile(["ch.md"], encoder.encode("x"), { kind: "absent" }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "read-only" });
    expect((failure as Error).message).toContain("Nothing was replaced");
  });

  test("a layout the port cannot understand is an io failure, not a crash", async () => {
    const { api } = port((directory) => {
      directory.hooks.fail = (stage) => (stage === "getFileHandle" ? domError("TypeMismatchError") : undefined);
    });
    expect(await api.commitFile(["ch.md"], encoder.encode("x"), { kind: "absent" }).catch((error: unknown) => error)).toMatchObject({
      code: "io"
    });
  });
});

describe("moving", () => {
  test("moves a file without losing either copy's bytes", async () => {
    const { api } = port();
    await seed(api, ["trash", ".keep"], "");
    await seed(api, ["ch.md"], "prose");
    await api.moveFile(["ch.md"], ["trash", "ch.md"]);
    expect(await api.readFile(["ch.md"])).toBeNull();
    expect(decoder.decode((await api.readFile(["trash", "ch.md"]))?.bytes)).toBe("prose");
  });

  test("refuses to move a file that is not there", async () => {
    const { api } = port();
    expect(await api.moveFile(["gone.md"], ["there.md"]).catch((error: unknown) => error)).toMatchObject({
      code: "not-found"
    });
  });

  test("refuses to move onto something, rather than replacing it", async () => {
    const { api } = port();
    await seed(api, ["one.md"], "one");
    await seed(api, ["two.md"], "two");
    expect(await api.moveFile(["one.md"], ["two.md"]).catch((error: unknown) => error)).toMatchObject({
      code: "already-exists"
    });
    expect(decoder.decode((await api.readFile(["two.md"]))?.bytes)).toBe("two");
  });

  test("moves a whole folder, nested files and all", async () => {
    const { api } = port();
    await seed(api, ["books", "book_a", "book.json"], "{}");
    await seed(api, ["books", "book_a", "chapters", "0001.md"], "prose");
    await api.moveDirectory(["books", "book_a"], ["trash", "book_a"]);
    expect(await api.listDirectory(["books"])).toEqual([]);
    expect(decoder.decode((await api.readFile(["trash", "book_a", "chapters", "0001.md"]))?.bytes)).toBe("prose");
  });

  test("refuses to move a folder that is not there", async () => {
    const { api } = port();
    expect(await api.moveDirectory(["gone"], ["here"]).catch((error: unknown) => error)).toMatchObject({
      code: "not-found"
    });
  });

  test("refuses to move a folder onto an existing one", async () => {
    const { api } = port();
    await api.ensureDirectory(["one"]);
    await api.ensureDirectory(["two"]);
    expect(await api.moveDirectory(["one"], ["two"]).catch((error: unknown) => error)).toMatchObject({
      code: "already-exists"
    });
  });
});

describe("removing", () => {
  test("removes a file", async () => {
    const { api } = port();
    await seed(api, ["ch.md"], "prose");
    await api.removeFile(["ch.md"]);
    expect(await api.readFile(["ch.md"])).toBeNull();
  });

  test("says a file was already gone rather than pretending it removed one", async () => {
    const { api } = port();
    expect(await api.removeFile(["never.md"]).catch((error: unknown) => error)).toMatchObject({ code: "not-found" });
  });

  test("refuses to treat the library root as a file", async () => {
    const { api } = port();
    // An empty path is the library root, which is not a file and must never be removed.
    expect(await api.removeFile([]).catch((error: unknown) => error)).toMatchObject({
      code: "invalid-path"
    });
  });
});

describe("the library's identity", () => {
  test("is created once and kept in device.json", async () => {
    const { api } = port();
    const first = await api.deviceInfo();
    expect(first.id).toMatch(/^device_[0-9a-f]{16}$/);
    const second = await api.deviceInfo();
    expect(second).toEqual(first);
    // The identity lives under `.studio/`, which is what the desktop writes too.
    const stored = await api.readFile([".studio", "device.json"]);
    expect(JSON.parse(decoder.decode(stored?.bytes)).id).toBe(first.id);
  });

  test("names itself for the device it is on", async () => {
    const root = new FakeDirectory("library");
    const api = new DirectoryHandleLibraryPort(root as unknown as FileSystemDirectoryHandle, {
      deviceName: "This browser"
    });
    expect((await api.deviceInfo()).name).toBe("This browser");
  });

  test("replaces a damaged identity file, because it is not the author's work", async () => {
    const { api } = port();
    await seed(api, [".studio", "device.json"], "not json at all");
    const device = await api.deviceInfo();
    expect(device.id).toMatch(/^device_/);
    const repaired = await api.readFile([".studio", "device.json"]);
    expect(JSON.parse(decoder.decode(repaired?.bytes)).id).toBe(device.id);
  });

  test("keeps the winner when two tabs create an identity at once", async () => {
    // The second tab loses the absent-write, so it must read the winner rather than invent one.
    const { root, api } = port();
    const original = api.readFile.bind(api);
    let calls = 0;
    (api as unknown as { readFile: typeof original }).readFile = async (path) => {
      calls += 1;
      // Answer "nothing there" for the first look, then show the other tab's file.
      if (path.join("/") === ".studio/device.json" && calls === 1) return null;
      return original(path);
    };
    const studio = await root.getDirectoryHandle(".studio", { create: true });
    studio.files.set("device.json", {
      bytes: encoder.encode(JSON.stringify({ id: "device_winner", name: "Other tab", createdAt: "2026-01-01T00:00:00.000Z" })),
      lastModified: Date.now()
    });
    const device = await api.deviceInfo();
    expect(device.id).toBe("device_winner");
    expect(device.name).toBe("Other tab");
  });
});

describe("the browser's write lock", () => {
  test("runs the work directly when the browser has no locks", async () => {
    expect(webLocksAvailable()).toBe(false);
    let ran = false;
    await webLock("write:ch.md", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
