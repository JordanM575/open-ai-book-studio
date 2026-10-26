import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { libraryPathFromArchivePath, toLibraryPath } from "@ai-book-studio/core/library/path";
import { LibraryService } from "@ai-book-studio/core/library/service";
import { serializeChapter } from "@ai-book-studio/core/markdown";
import { DirectoryHandleLibraryPort } from "../../src/storage/directory-port";
import { FakeDirectory, domError } from "./support/fake-directory";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CHAPTER = toLibraryPath(["chapter.md"]);

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array | undefined): string {
  return value ? decoder.decode(value) : "";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function portFor(root: FakeDirectory): DirectoryHandleLibraryPort {
  return new DirectoryHandleLibraryPort(root as unknown as FileSystemDirectoryHandle);
}

function runtime() {
  let next = 1;
  return {
    now: () => "2026-10-25T23:00:00.000Z",
    newId: (prefix: string) => `${prefix}_test${String(next++).padStart(6, "0")}`,
    sha256: async (value: Uint8Array) => createHash("sha256").update(value).digest("hex")
  };
}

describe("browser save failures", () => {
  test("a stale base is refused before any bytes are written", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });

    const result = await portFor(root).commitFile(CHAPTER, bytes("mine"), {
      kind: "sha256",
      value: hash("someone else")
    });

    expect(result.status).toBe("changed");
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("old");
  });

  test("an external edit during the write is re-checked and the swap file is aborted", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.afterWrite = (name, directory) => {
      directory.files.set(name, { bytes: bytes("external"), lastModified: 2 });
    };

    const result = await portFor(root).commitFile(CHAPTER, bytes("mine"), {
      kind: "sha256",
      value: hash("old")
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") expect(text(result.current?.bytes)).toBe("external");
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("external");
  });

  test("creating a missing file still commits when its handle creates an empty placeholder", async () => {
    const root = new FakeDirectory("library");

    const result = await portFor(root).commitFile(CHAPTER, bytes("new"), { kind: "absent" });

    expect(result.status).toBe("written");
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("new");
  });

  test("a concurrent create during an absent write is reported, not overwritten", async () => {
    const root = new FakeDirectory("library");
    root.hooks.afterWrite = (name, directory) => {
      directory.files.set(name, { bytes: bytes("external"), lastModified: 2 });
    };

    const result = await portFor(root).commitFile(CHAPTER, bytes("mine"), { kind: "absent" });

    expect(result.status).toBe("changed");
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("external");
  });

  test("permission loss leaves the old bytes intact", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.fail = (stage) => (stage === "getFileHandle" ? domError("NotAllowedError") : undefined);

    await expect(portFor(root).commitFile(CHAPTER, bytes("mine"), { kind: "any" })).rejects.toMatchObject({
      code: "permission-required"
    });
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("old");
  });

  test("a read-only folder leaves the old bytes intact", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.fail = (stage) => (stage === "createWritable" ? domError("NoModificationAllowedError") : undefined);

    await expect(portFor(root).commitFile(CHAPTER, bytes("mine"), { kind: "any" })).rejects.toMatchObject({
      code: "read-only"
    });
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("old");
  });

  test("quota exhaustion leaves the old bytes intact", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.fail = (stage) => (stage === "write" ? domError("QuotaExceededError") : undefined);

    await expect(portFor(root).commitFile(CHAPTER, bytes("mine"), { kind: "any" })).rejects.toMatchObject({
      code: "storage-full"
    });
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("old");
  });

  test("an interrupted close leaves the old bytes intact", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.fail = (stage) => (stage === "close" ? domError("InvalidStateError") : undefined);

    await expect(portFor(root).commitFile(CHAPTER, bytes("mine"), { kind: "any" })).rejects.toMatchObject({
      code: "io"
    });
    expect(text(root.files.get("chapter.md")?.bytes)).toBe("old");
  });

  test("a read-back mismatch is reported as changed, not written", async () => {
    const root = new FakeDirectory("library");
    root.files.set("chapter.md", { bytes: bytes("old"), lastModified: 1 });
    root.hooks.afterClose = (name, directory) => {
      directory.files.set(name, { bytes: bytes("external"), lastModified: 2 });
    };

    const result = await portFor(root).commitFile(CHAPTER, bytes("mine"), {
      kind: "sha256",
      value: hash("old")
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") expect(text(result.current?.bytes)).toBe("external");
  });

  test("a browser save conflict preserves the author's text", async () => {
    const root = new FakeDirectory("library");
    const port = portFor(root);
    const service = await LibraryService.open({ storage: port, runtime: runtime() });
    const book = await service.createBook({ title: "The Salt Road" });
    const chapter = await service.createChapter(book.id, { title: "The Door", content: "Original.\n" });

    const { content: _content, path: _path, wordCount: _wordCount, hash: _hash, ...meta } = chapter;
    const external = serializeChapter(
      { ...meta, version: chapter.version + 1, updatedAt: "2026-10-25T23:30:00.000Z" },
      "External text.\n"
    );
    const chapterPath = toLibraryPath(["books", book.id, "chapters", chapter.path]);
    const wrote = await port.commitFile(chapterPath, bytes(external), { kind: "any" });
    expect(wrote.status).toBe("written");

    const result = await service.saveChapter(book.id, chapter.id, "My unsaved text.\n", {
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });

    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") return;
    const preserved = await port.readFile(libraryPathFromArchivePath(result.conflict.savedAs));
    expect(text(preserved?.bytes)).toContain("My unsaved text.");
    expect(text((await port.readFile(chapterPath))?.bytes)).toContain("External text.");
  });
});
