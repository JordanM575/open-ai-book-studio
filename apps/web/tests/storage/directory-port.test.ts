import { describe, expect, test } from "bun:test";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { DirectoryHandleLibraryPort } from "../../src/storage/directory-port";
import { FakeDirectory, domError } from "./support/fake-directory";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array | undefined): string {
  return decoder.decode(value);
}

function portFor(root: FakeDirectory): DirectoryHandleLibraryPort {
  return new DirectoryHandleLibraryPort(root as unknown as FileSystemDirectoryHandle);
}

describe("DirectoryHandleLibraryPort", () => {
  test("creates directories and commits complete files with hashes", async () => {
    const root = new FakeDirectory("library");
    const port = portFor(root);
    const path = toLibraryPath(["books", "book_test000001", "book.json"]);

    await port.ensureDirectory(toLibraryPath(["books", "book_test000001"]));
    const result = await port.commitFile(path, bytes('{"title":"A book"}'), { kind: "absent" });
    expect(result.status).toBe("written");
    if (result.status !== "written") return;

    const read = await port.readFile(path);
    expect(text(read?.bytes)).toBe('{"title":"A book"}');
    expect(read?.sha256).toBe(result.snapshot.sha256);
    expect(read?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await port.listDirectory(toLibraryPath(["books"]))).toEqual([{ name: "book_test000001", kind: "directory" }]);
  });

  test("refuses a stale hash without touching the committed bytes", async () => {
    const root = new FakeDirectory("library");
    const port = portFor(root);
    const path = toLibraryPath(["notes.txt"]);
    await port.commitFile(path, bytes("first"), { kind: "absent" });

    const stale = await port.commitFile(path, bytes("second"), { kind: "sha256", value: "0".repeat(64) });
    expect(stale.status).toBe("changed");
    expect(text((await port.readFile(path))?.bytes)).toBe("first");

    const overwrite = await port.commitFile(path, bytes("second"), { kind: "any" });
    expect(overwrite.status).toBe("written");
    expect(text((await port.readFile(path))?.bytes)).toBe("second");
  });

  test("moves files without overwriting a destination", async () => {
    const root = new FakeDirectory("library");
    const port = portFor(root);
    const from = toLibraryPath(["chapters", "one.md"]);
    const to = toLibraryPath(["trash", "one.md"]);
    await port.commitFile(from, bytes("one"), { kind: "absent" });

    await port.moveFile(from, to);
    expect(await port.readFile(from)).toBeNull();
    expect(text((await port.readFile(to))?.bytes)).toBe("one");

    await port.commitFile(from, bytes("two"), { kind: "absent" });
    await expect(port.moveFile(from, to)).rejects.toMatchObject({ code: "already-exists" });
    expect(text((await port.readFile(from))?.bytes)).toBe("two");
    expect(text((await port.readFile(to))?.bytes)).toBe("one");
  });

  test("keeps one device identity in the library", async () => {
    const root = new FakeDirectory("library");
    const first = await portFor(root).deviceInfo();
    const second = await portFor(root).deviceInfo();
    expect(first.id).toMatch(/^device_[a-f0-9]{16}$/);
    expect(second).toEqual(first);
    expect(root.directories.get(".studio")?.files.has("device.json")).toBe(true);
  });

  test("reports permission loss and missing files as safe port errors", async () => {
    const denied = {
      async getDirectoryHandle() {
        throw domError("NotAllowedError");
      },
      async getFileHandle() {
        throw domError("NotAllowedError");
      }
    } as unknown as FileSystemDirectoryHandle;
    const port = new DirectoryHandleLibraryPort(denied);
    await expect(port.readFile(toLibraryPath(["book.json"]))).rejects.toMatchObject({ code: "permission-required" });

    const root = new FakeDirectory("library");
    const normal = portFor(root);
    await expect(normal.removeFile(toLibraryPath(["missing.md"]))).rejects.toMatchObject({ code: "not-found" });
  });

  test("lists a missing directory as empty", async () => {
    const port = portFor(new FakeDirectory("library"));
    expect(await port.listDirectory(toLibraryPath(["books"]))).toEqual([]);
    expect(await port.readFile(toLibraryPath(["books", "book.json"]))).toBeNull();
  });
});
