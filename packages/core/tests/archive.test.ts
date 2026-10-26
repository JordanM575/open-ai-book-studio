import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { createLibraryArchive } from "../src/archive/export";
import { archiveSourceFromBytes, importLibraryArchive } from "../src/archive/import";
import { ARCHIVE_LIMITS, type ArchiveEntry } from "../src/archive/manifest";
import { LibraryPortError } from "../src/library/errors";
import { LibraryService } from "../src/library/service";
import { toLibraryPath } from "../src/library/path";
import type { LibraryPort } from "../src/library/port";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function fixture() {
  const port = new InMemoryLibraryPort();
  const service = await LibraryService.open({ storage: port, runtime: port });
  const book = await service.createBook({ title: "The Salt Road", description: "A crossing." });
  const chapter = await service.createChapter(book.id, { title: "The Door", content: "The hall was cold.\n" });

  await port.commitFile(toLibraryPath(["books", book.id, "conflicts", "0001-the-door.conflict.md"]), bytes("conflict"), {
    kind: "any"
  });
  await port.commitFile(toLibraryPath([".studio", "trash", book.id, "old.md"]), bytes("trash"), { kind: "any" });
  await port.commitFile(toLibraryPath(["books", book.id, "images", "map.png"]), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
    kind: "any"
  });
  await port.commitFile(toLibraryPath(["notes.txt"]), bytes("an unknown author file"), { kind: "any" });

  // These must never travel.
  await port.commitFile(toLibraryPath([".studio", "credentials.json"]), bytes("secret"), { kind: "any" });
  await port.commitFile(toLibraryPath([".studio", "device.json"]), bytes("device"), { kind: "any" });
  await port.commitFile(toLibraryPath(["books", book.id, "chapters", "0002-draft.tmp"]), bytes("temporary"), { kind: "any" });
  await port.commitFile(toLibraryPath(["library.json"]), bytes("catalog"), { kind: "any" });

  return { port, service, book, chapter };
}

async function exportBytes(port: InMemoryLibraryPort): Promise<{ manifest: Awaited<ReturnType<typeof createLibraryArchive>>["manifest"]; bytes: Uint8Array }> {
  const archive = await createLibraryArchive({ storage: port, runtime: port }, { appVersion: "0.1.0" });
  const chunks: Uint8Array[] = [];
  for await (const chunk of archive.chunks) chunks.push(chunk);
  return { manifest: archive.manifest, bytes: concat(chunks) };
}

function craftedArchive(manifest: unknown, files: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    ...files
  });
}

function manifestWith(entries: ArchiveEntry[], overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    appVersion: "0.1.0",
    createdAt: "2026-10-25T00:00:00.000Z",
    entryCount: entries.length,
    expandedBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    entries,
    ...overrides
  };
}

describe("portable library archive", () => {
  test("round-trips every author file and excludes metadata, credentials and temporary files", async () => {
    const { port, book, chapter } = await fixture();
    const { manifest, bytes: archive } = await exportBytes(port);

    const paths = manifest.entries.map((entry) => entry.path);
    expect(paths).toContain("notes.txt");
    expect(paths).toContain(`books/${book.id}/book.json`);
    expect(paths).toContain(`books/${book.id}/chapters/${chapter.path}`);
    expect(paths).toContain(`books/${book.id}/conflicts/0001-the-door.conflict.md`);
    expect(paths).toContain(`.studio/trash/${book.id}/old.md`);
    expect(paths).toContain(`books/${book.id}/images/map.png`);
    expect(paths).not.toContain("library.json");
    expect(paths).not.toContain(".studio/device.json");
    expect(paths).not.toContain(".studio/credentials.json");
    expect(paths.some((path) => path.endsWith(".tmp"))).toBe(false);

    const target = new InMemoryLibraryPort();
    const imported = await importLibraryArchive(archiveSourceFromBytes(archive), target, target);
    expect(imported.entries).toEqual(manifest.entries);

    for (const entry of manifest.entries) {
      const source = await port.readFile(toLibraryPath(entry.path.split("/")));
      const destination = await target.readFile(toLibraryPath(entry.path.split("/")));
      expect(destination?.sha256).toBe(entry.sha256);
      expect(destination?.bytes).toEqual(source?.bytes);
    }

    const reopened = await LibraryService.open({ storage: target, runtime: target });
    const detail = await reopened.readBook(book.id);
    expect(detail.chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect(detail.chapters[0]?.content).toBe("The hall was cold.\n");
  });

  test("rejects path traversal, duplicate paths and unsupported versions before writing", async () => {
    const outside = bytes("outside");
    const traversal = craftedArchive(
      manifestWith([{ path: "../outside.txt", size: outside.length, sha256: hash(outside) }]),
      { "../outside.txt": outside }
    );
    const target = new InMemoryLibraryPort();
    await expect(importLibraryArchive(archiveSourceFromBytes(traversal), target, target)).rejects.toMatchObject({
      code: "unsafe-path"
    });
    expect(await target.listDirectory(toLibraryPath([]))).toEqual([]);

    const duplicate = manifestWith([
      { path: "notes.txt", size: 1, sha256: hash(new Uint8Array([1])) },
      { path: "notes.txt", size: 1, sha256: hash(new Uint8Array([1])) }
    ]);
    await expect(
      importLibraryArchive(archiveSourceFromBytes(craftedArchive(duplicate)), new InMemoryLibraryPort(), target)
    ).rejects.toMatchObject({ code: "duplicate-path" });

    const future = manifestWith([], { formatVersion: 2 });
    await expect(
      importLibraryArchive(archiveSourceFromBytes(craftedArchive(future)), new InMemoryLibraryPort(), target)
    ).rejects.toMatchObject({ code: "unsupported-version" });
  });

  test("rejects an archive that is missing its manifest or contains an unexpected file", async () => {
    const target = new InMemoryLibraryPort();
    const noManifest = zipSync({ "notes.txt": strToU8("no manifest") });
    await expect(importLibraryArchive(archiveSourceFromBytes(noManifest), target, target)).rejects.toMatchObject({
      code: "missing-entry"
    });

    const payload = bytes("listed");
    const unexpected = craftedArchive(manifestWith([{ path: "notes.txt", size: payload.length, sha256: hash(payload) }]), {
      "notes.txt": payload,
      "extra.txt": bytes("extra")
    });
    await expect(importLibraryArchive(archiveSourceFromBytes(unexpected), target, target)).rejects.toMatchObject({
      code: "unexpected-entry"
    });
  });

  test("rejects a hash mismatch and removes the files it had already written", async () => {
    const first = bytes("first");
    const second = bytes("second");
    const manifest = manifestWith([
      { path: "a.txt", size: first.length, sha256: hash(first) },
      { path: "b.txt", size: second.length, sha256: "0".repeat(64) }
    ]);
    const archive = craftedArchive(manifest, { "a.txt": first, "b.txt": second });
    const target = new InMemoryLibraryPort();

    await expect(importLibraryArchive(archiveSourceFromBytes(archive), target, target)).rejects.toMatchObject({
      code: "hash-mismatch"
    });
    expect(await target.readFile(toLibraryPath(["a.txt"]))).toBeNull();
    expect(await target.readFile(toLibraryPath(["b.txt"]))).toBeNull();
  });

  test("refuses a destination that already contains a library file", async () => {
    const payload = bytes("new");
    const manifest = manifestWith([{ path: "notes.txt", size: payload.length, sha256: hash(payload) }]);
    const archive = craftedArchive(manifest, { "notes.txt": payload });
    const target = new InMemoryLibraryPort();
    await target.commitFile(toLibraryPath(["notes.txt"]), bytes("keep me"), { kind: "absent" });

    await expect(importLibraryArchive(archiveSourceFromBytes(archive), target, target)).rejects.toMatchObject({
      code: "destination-not-empty"
    });
    expect(new TextDecoder().decode((await target.readFile(toLibraryPath(["notes.txt"])))?.bytes)).toBe("keep me");
  });

  test("rejects entry and size limits from the manifest", async () => {
    const tooLarge = manifestWith([
      { path: "huge.bin", size: ARCHIVE_LIMITS.maxFileBytes + 1, sha256: "0".repeat(64) }
    ]);
    await expect(
      importLibraryArchive(archiveSourceFromBytes(craftedArchive(tooLarge)), new InMemoryLibraryPort(), new InMemoryLibraryPort())
    ).rejects.toMatchObject({ code: "too-large" });

    const tooMany = manifestWith(
      Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({
        path: `file-${index}.txt`,
        size: 1,
        sha256: hash(new Uint8Array([1]))
      }))
    );
    await expect(
      importLibraryArchive(archiveSourceFromBytes(craftedArchive(tooMany)), new InMemoryLibraryPort(), new InMemoryLibraryPort())
    ).rejects.toMatchObject({ code: "too-many-entries" });
  });

  test("a failed commit removes the files this import had already written", async () => {
    const first = bytes("first");
    const second = bytes("second");
    const manifest = manifestWith([
      { path: "a.txt", size: first.length, sha256: hash(first) },
      { path: "b.txt", size: second.length, sha256: hash(second) }
    ]);
    const archive = craftedArchive(manifest, { "a.txt": first, "b.txt": second });
    const inner = new InMemoryLibraryPort();
    const failing = new FailSecondCommitPort(inner);

    await expect(importLibraryArchive(archiveSourceFromBytes(archive), failing, inner)).rejects.toMatchObject({
      code: "storage-full"
    });
    expect(await inner.readFile(toLibraryPath(["a.txt"]))).toBeNull();
    expect(await inner.readFile(toLibraryPath(["b.txt"]))).toBeNull();
  });
});

class FailSecondCommitPort implements LibraryPort {
  private commits = 0;

  constructor(private readonly inner: InMemoryLibraryPort) {}

  readFile(path: Parameters<LibraryPort["readFile"]>[0]) {
    return this.inner.readFile(path);
  }

  listDirectory(path: Parameters<LibraryPort["listDirectory"]>[0]) {
    return this.inner.listDirectory(path);
  }

  stat(path: Parameters<LibraryPort["stat"]>[0]) {
    return this.inner.stat(path);
  }

  ensureDirectory(path: Parameters<LibraryPort["ensureDirectory"]>[0]) {
    return this.inner.ensureDirectory(path);
  }

  async commitFile(...args: Parameters<LibraryPort["commitFile"]>) {
    this.commits += 1;
    if (this.commits === 2) throw new LibraryPortError("storage-full", "The disk is full.", true);
    return this.inner.commitFile(...args);
  }

  moveFile(from: Parameters<LibraryPort["moveFile"]>[0], to: Parameters<LibraryPort["moveFile"]>[1]) {
    return this.inner.moveFile(from, to);
  }

  removeFile(path: Parameters<LibraryPort["removeFile"]>[0]) {
    return this.inner.removeFile(path);
  }

  deviceInfo() {
    return this.inner.deviceInfo();
  }
}
