import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryFileSnapshot,
  LibraryPath,
  LibraryPort
} from "@ai-book-studio/core/library/port";
import { fileArchiveSource, importBrowserArchive } from "../../src/storage/archive-io";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestFor(entries: Array<{ path: string; size: number; sha256: string }>) {
  return {
    formatVersion: 1,
    appVersion: "0.1.0",
    createdAt: "2026-10-25T00:00:00.000Z",
    entryCount: entries.length,
    expandedBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    entries
  };
}

function archiveFile(manifest: unknown, files: Record<string, Uint8Array>): File {
  const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files });
  return new File([bytes as unknown as BlobPart], "library.zip", { type: "application/zip" });
}

class RecordingPort implements LibraryPort {
  readonly files = new Map<string, Uint8Array>();

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    const bytes = this.files.get(path.join("/"));
    if (!bytes) return null;
    return { bytes: bytes.slice(), sha256: hash(bytes), createdAt: null, modifiedAt: null };
  }

  async listDirectory(): Promise<LibraryEntry[]> {
    return [];
  }

  async stat(): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    return null;
  }

  async ensureDirectory(): Promise<void> {}

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const key = path.join("/");
    const current = this.files.get(key);
    const matches =
      expected.kind === "any" ? true : expected.kind === "absent" ? current === undefined : current !== undefined && hash(current) === expected.value;
    if (!matches) {
      return {
        status: "changed",
        current: current ? { bytes: current.slice(), sha256: hash(current), createdAt: null, modifiedAt: null } : null
      };
    }
    const copy = bytes.slice();
    this.files.set(key, copy);
    return {
      status: "written",
      snapshot: { bytes: copy.slice(), sha256: hash(copy), createdAt: null, modifiedAt: null }
    };
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    const bytes = this.files.get(from.join("/"));
    if (!bytes) throw new Error("not found");
    this.files.set(to.join("/"), bytes);
    this.files.delete(from.join("/"));
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    const prefix = `${from.join("/")}/`;
    for (const [key, value] of [...this.files]) {
      if (!key.startsWith(prefix)) continue;
      this.files.set(`${to.join("/")}/${key.slice(prefix.length)}`, value);
      this.files.delete(key);
    }
  }

  async removeFile(path: LibraryPath): Promise<void> {
    this.files.delete(path.join("/"));
  }

  async removeDirectory(path: LibraryPath): Promise<void> {
    const prefix = `${path.join("/")}/`;
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    return { id: "device_test", name: "Test", createdAt: "2026-10-25T00:00:00.000Z" };
  }
}

const runtime = {
  now: () => "2026-10-25T00:00:00.000Z",
  newId: (prefix: string) => `${prefix}_00000001`,
  sha256: async (bytes: Uint8Array) => hash(bytes)
};

describe("browser archive I/O", () => {
  test("imports a File and commits every verified entry", async () => {
    const payload = encoder.encode("A browser archive.");
    const manifest = manifestFor([{ path: "notes.txt", size: payload.length, sha256: hash(payload) }]);
    const file = archiveFile(manifest, { "notes.txt": payload });
    const target = new RecordingPort();

    const imported = await importBrowserArchive(file, target, runtime);
    expect(imported.entries).toEqual(manifest.entries);
    expect(decoder.decode(target.files.get("notes.txt"))).toBe("A browser archive.");
  });

  test("a File source can be opened twice for the two-pass importer", async () => {
    const payload = encoder.encode("again");
    const file = new File([payload as unknown as BlobPart], "notes.txt");
    const source = fileArchiveSource(file);

    const first: Uint8Array[] = [];
    for await (const chunk of source.open()) first.push(chunk);
    const second: Uint8Array[] = [];
    for await (const chunk of source.open()) second.push(chunk);

    expect(decoder.decode(first[0])).toBe("again");
    expect(decoder.decode(second[0])).toBe("again");
  });

  test("rejects an unsafe path before writing", async () => {
    const payload = encoder.encode("outside");
    const manifest = manifestFor([{ path: "../outside.txt", size: payload.length, sha256: hash(payload) }]);
    const file = archiveFile(manifest, { "../outside.txt": payload });
    const target = new RecordingPort();

    await expect(importBrowserArchive(file, target, runtime)).rejects.toMatchObject({ code: "unsafe-path" });
    expect(target.files.size).toBe(0);
  });
});
