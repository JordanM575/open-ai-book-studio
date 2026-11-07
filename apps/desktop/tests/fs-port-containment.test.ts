import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createLibraryArchive } from "@ai-book-studio/core/archive/export";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import { toLibraryPath, type LibraryPath } from "@ai-book-studio/core/library/path";
import { FileSystemLibraryPort, createFileSystemEnvironment } from "../src/main/library/fs-port";
import { asOtherWriter, isOwnState } from "../src/main/library/own-writes";

const history = ["books", "book_synthetic", "history"];
const chapter = [...history, "ch_synthetic"];
const record = [...chapter, "2026-snapshot.md"];
const bytes = new TextEncoder().encode("Synthetic saved history.\n");
const p = toLibraryPath;
let fixture: string;
let root: string;
let outside: string;
let port: FileSystemLibraryPort;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "wfs-containment-"));
  root = join(fixture, "library");
  outside = join(fixture, "outside");
  await mkdir(root);
  await mkdir(outside);
  port = new FileSystemLibraryPort(root);
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

async function put(path: string, content: string | Uint8Array = bytes): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Snapshot only this synthetic fixture; never follow links while checking preservation. */
async function tree(directory = fixture): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) result[name] = `link:${await readlink(path)}`;
    else if (info.isDirectory()) {
      result[`${name}/`] = "directory";
      for (const [child, value] of Object.entries(await tree(path))) result[`${name}/${child}`] = value;
    } else if (info.isFile()) result[name] = (await readFile(path)).toString("hex");
    else result[name] = "special";
  }
  return result;
}

async function refuses(operation: () => Promise<unknown>, code = "unsupported"): Promise<void> {
  await expect(operation()).rejects.toMatchObject({ name: "LibraryPortError", code });
}

async function assertArchive(path: LibraryPath, selectedRoot = root): Promise<void> {
  const archive = await createLibraryArchive(createFileSystemEnvironment(selectedRoot), { appVersion: "synthetic-test" });
  const snapshot = await port.readFile(path);
  if (!snapshot) throw new Error("Synthetic archive source is missing");
  expect(archive.manifest.entries).toContainEqual({
    path: path.join("/"),
    size: bytes.length,
    sha256: snapshot.sha256
  });
  let size = 0;
  for await (const chunk of archive.chunks) size += chunk.length;
  expect(size).toBeGreaterThan(bytes.length);
}

test("ordinary history-shaped files retain checked writes, archive inclusion, moves and bookkeeping", async () => {
  const path = p(record);
  expect(await port.readFile(path)).toBeNull();
  expect(await port.stat(path)).toBeNull();
  expect(await port.listDirectory(p(chapter))).toEqual([]);
  await port.ensureDirectory(p(chapter));
  await port.ensureDirectory(p(chapter));
  expect((await port.commitFile(path, bytes, { kind: "absent" })).status).toBe("written");
  expect((await port.readFile(path))?.bytes).toEqual(bytes);
  expect((await port.stat(path))?.size).toBe(bytes.length);
  expect(await port.stat(p(chapter))).toBeNull();
  expect(await isOwnState(join(root, ...record))).toBe(true);
  expect((await port.commitFile(path, new Uint8Array([1]), { kind: "absent" })).status).toBe("changed");
  expect((await port.commitFile(path, new Uint8Array([1]), { kind: "sha256", value: "stale" })).status).toBe("changed");
  const snapshot = await port.readFile(path);
  expect(snapshot).not.toBeNull();
  expect((await port.commitFile(path, bytes, { kind: "sha256", value: snapshot?.sha256 ?? "" })).status).toBe("written");
  await assertArchive(path);

  const moved = p([...chapter, "moved.md"]);
  await port.moveFile(path, moved);
  expect(await port.readFile(path)).toBeNull();
  expect(await isOwnState(join(root, ...record))).toBe(true);
  expect(await isOwnState(join(root, ...moved))).toBe(true);
  await port.moveDirectory(p(history), p(["retained", "history"]));
  const retained = p(["retained", "history", "ch_synthetic", "moved.md"]);
  expect((await port.readFile(retained))?.bytes).toEqual(bytes);
  expect(await isOwnState(join(root, ...retained))).toBe(true);
  await port.removeFile(retained);
  expect(await isOwnState(join(root, ...retained))).toBe(true);
  await port.removeDirectory(p(["retained"]));
  expect(await port.listDirectory(p(["retained"]))).toEqual([]);
  await refuses(() => port.removeDirectory(p(["retained"])), "not-found");

  await asOtherWriter(() => port.commitFile(p(["other.md"]), bytes, { kind: "absent" }));
  expect(await isOwnState(join(root, "other.md"))).toBe(false);
});

describe("existing descendant directory links", () => {
  for (const level of ["history", "chapter"] as const) {
    for (const target of ["outside", "inside-unarchived", "broken"] as const) {
      test(`${level} → ${target}: all direct operations refuse without changing any fixture entry`, async () => {
        const link = level === "history" ? history : chapter;
        const targetRoot = target === "inside-unarchived" ? join(root, ".studio", "held") : join(outside, "held");
        if (target !== "broken") {
          const contentRoot = level === "history" ? join(targetRoot, "ch_synthetic") : targetRoot;
          await put(join(contentRoot, "2026-snapshot.md"));
          await put(join(contentRoot, "nested", "keep.md"));
        }
        await mkdir(dirname(join(root, ...link)), { recursive: true });
        await symlink(targetRoot, join(root, ...link), "dir");
        await put(join(root, "source.md"));
        await put(join(root, "source-dir", "keep.md"));
        const before = await tree();
        const path = p(record);
        for (const operation of [
          () => port.readFile(path),
          () => port.stat(path),
          () => port.listDirectory(p(chapter)),
          () => port.listDirectory(p(link)),
          () => port.ensureDirectory(p([...chapter, "new", "deep"])),
          () => port.commitFile(path, bytes, { kind: "any" }),
          () => port.commitFile(path, bytes, { kind: "absent" }),
          () => port.commitFile(path, bytes, { kind: "sha256", value: "stale" }),
          () => port.commitFile(p([...chapter, "new", "deep", "write.md"]), bytes, { kind: "absent" }),
          () => port.moveFile(path, p(["new", "moved.md"])),
          () => port.moveFile(p(["source.md"]), p([...chapter, "new", "moved.md"])),
          () => port.moveDirectory(p([...chapter, "nested"]), p(["new", "moved-dir"])),
          () => port.moveDirectory(p(["source-dir"]), p([...chapter, "new", "moved-dir"])),
          () => port.moveDirectory(p(link), p(["new", "history"])),
          () => port.removeFile(path),
          () => port.removeDirectory(p([...chapter, "nested"])),
          () => port.removeDirectory(p(link))
        ]) await refuses(operation);
        expect(() => port.watch(p(link), () => {})).toThrow(LibraryPortError);
        expect(() => port.watch(p(chapter), () => {})).toThrow(LibraryPortError);
        expect(await port.listDirectory(p(link.slice(0, -1)))).not.toContainEqual({ name: link.at(-1), kind: "directory" });
        expect(await tree()).toEqual(before); // Includes outside bytes, broken targets and absent new directories.
      });
    }
  }
});

describe("existing descendant file links", () => {
  for (const target of ["outside", "inside", "broken"] as const) {
    test(`${target} leaf links are errors, never absent files or replacement destinations`, async () => {
      const targetPath = target === "inside" ? join(root, "original.md") : join(outside, "original.md");
      if (target !== "broken") await put(targetPath);
      await mkdir(join(root, ...chapter), { recursive: true });
      await symlink(targetPath, join(root, ...record), "file");
      await put(join(root, "source.md"));
      await put(join(root, "source-dir", "keep.md"));
      const before = await tree();
      const path = p(record);
      for (const operation of [
        () => port.readFile(path),
        () => port.stat(path),
        () => port.listDirectory(path),
        () => port.ensureDirectory(path),
        () => port.commitFile(path, bytes, { kind: "any" }),
        () => port.commitFile(path, bytes, { kind: "absent" }),
        () => port.commitFile(path, bytes, { kind: "sha256", value: "stale" }),
        () => port.moveFile(path, p(["moved.md"])),
        () => port.moveFile(p(["source.md"]), path),
        () => port.moveDirectory(path, p(["moved-dir"])),
        () => port.moveDirectory(p(["source-dir"]), path),
        () => port.removeFile(path),
        () => port.removeDirectory(path)
      ]) await refuses(operation);
      expect(() => port.watch(path, () => {})).toThrow(LibraryPortError);
      expect(await port.listDirectory(p(chapter))).toEqual([]);
      expect(await tree()).toEqual(before);
    });
  }
});

test("static source/destination aliases cannot move a file or directory onto itself through a link", async () => {
  await put(join(root, "original", "record.md"));
  await symlink(join(root, "original"), join(root, "alias"), "dir");
  const before = await tree();
  await refuses(() => port.moveFile(p(["original", "record.md"]), p(["alias", "record.md"])));
  await refuses(() => port.moveFile(p(["alias", "record.md"]), p(["original", "record.md"])));
  await refuses(() => port.moveDirectory(p(["original"]), p(["alias"])));
  await refuses(() => port.moveDirectory(p(["alias"]), p(["original"])));
  expect(await tree()).toEqual(before);
});

for (const alias of ["root", "ancestor", "macOS-var"] as const) {
  test.skipIf(alias === "macOS-var" && process.platform !== "darwin")(`a deliberately selected ${alias} alias retains normal behavior`, async () => {
    let selected: string;
    if (alias === "macOS-var") {
      expect(root.startsWith("/private/var/")).toBe(true);
      selected = root.replace(/^\/private\/var\//, "/var/");
    } else {
      const link = join(fixture, "selected");
      await symlink(alias === "root" ? root : fixture, link, "dir");
      selected = alias === "root" ? link : join(link, "library");
    }
    port = new FileSystemLibraryPort(selected);
    await port.ensureDirectory(p(chapter));
    expect((await port.commitFile(p(record), bytes, { kind: "absent" })).status).toBe("written");
    expect((await port.readFile(p(record)))?.bytes).toEqual(bytes);
    expect(await isOwnState(join(selected, ...record))).toBe(true);
    const device = await port.deviceInfo();
    expect(await port.deviceInfo()).toEqual(device);
    await assertArchive(p(record), selected);
    await port.moveFile(p(record), p([...chapter, "moved.md"]));
    await port.moveDirectory(p(history), p(["retained"]));
    await port.removeFile(p(["retained", "ch_synthetic", "moved.md"]));
    await port.removeDirectory(p(["retained"]));
    expect(await readdir(outside)).toEqual([]);
  });
}

test("whole-tree moves and cleanup do not follow internal links; ordinary moved files are still noted", async () => {
  await put(join(outside, "original.md"));
  await put(join(root, "staged", "nested", "ordinary.md"));
  await symlink(outside, join(root, "staged", "external"), "dir");
  await symlink(join(outside, "original.md"), join(root, "staged", "external.md"), "file");
  const before = await tree(outside);
  await port.moveDirectory(p(["staged"]), p(["published"]));
  expect(await isOwnState(join(root, "published", "nested", "ordinary.md"))).toBe(true);
  expect(await isOwnState(join(root, "published", "external.md"))).toBe(false);
  expect(await isOwnState(join(root, "published", "external", "original.md"))).toBe(false);
  expect((await lstat(join(root, "published", "external"))).isSymbolicLink()).toBe(true);
  await port.removeDirectory(p(["published"]));
  expect(await tree(outside)).toEqual(before);
});

describe("device metadata", () => {
  for (const level of ["studio", "file"] as const) {
    for (const target of ["outside", "inside", "broken"] as const) {
      test(`${level} ${target} link refuses without reading or regenerating identity`, async () => {
        const targetRoot = target === "inside" ? join(root, "held") : join(outside, "held");
        if (target !== "broken") await put(join(targetRoot, "device.json"), '{"id":"device_external","name":"Synthetic external"}');
        if (level === "studio") await symlink(targetRoot, join(root, ".studio"), "dir");
        else {
          await mkdir(join(root, ".studio"));
          await symlink(join(targetRoot, "device.json"), join(root, ".studio", "device.json"), "file");
        }
        const before = await tree();
        await refuses(() => port.deviceInfo());
        expect(await tree()).toEqual(before);
      });
    }
  }

  test("ordinary damaged identity still regenerates and then remains stable", async () => {
    await put(join(root, ".studio", "device.json"), "{broken");
    const device = await port.deviceInfo();
    expect(device.id).toMatch(/^device_[a-f0-9]{16}$/);
    expect(await port.deviceInfo()).toEqual(device);
  });

  test("a device read error propagates instead of initiating a replacement", async () => {
    class UnreadablePort extends FileSystemLibraryPort {
      writes = 0;
      override async readFile(): Promise<never> {
        throw new LibraryPortError("permission-required", "Synthetic unreadable identity.");
      }
      override async commitFile(): Promise<never> {
        this.writes++;
        throw new Error("Replacement must not start");
      }
    }
    const unreadable = new UnreadablePort(root);
    await refuses(() => unreadable.deviceInfo(), "permission-required");
    expect(unreadable.writes).toBe(0);
  });
});

test("a regular file used as a parent is an error, not a missing suffix", async () => {
  await put(join(root, "blocked"));
  const path = p(["blocked", "missing.md"]);
  const before = await tree();
  for (const operation of [
    () => port.readFile(path),
    () => port.stat(path),
    () => port.listDirectory(path),
    () => port.ensureDirectory(path),
    () => port.commitFile(path, bytes, { kind: "absent" })
  ]) await refuses(operation, "io");
  expect(await tree()).toEqual(before);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("real permission failures are not treated as missing descendants or identity", async () => {
  const studio = join(root, ".studio");
  await put(join(studio, "device.json"), '{"id":"device_keep","name":"Keep"}');
  const before = await tree();
  await chmod(studio, 0);
  try {
    const path = p([".studio", "device.json"]);
    for (const operation of [
      () => port.readFile(path),
      () => port.stat(path),
      () => port.listDirectory(p([".studio", "missing"])),
      () => port.ensureDirectory(p([".studio", "missing"])),
      () => port.commitFile(path, bytes, { kind: "absent" }),
      () => port.deviceInfo()
    ]) await refuses(operation, "permission-required");
  } finally {
    await chmod(studio, 0o755);
  }
  expect(await tree()).toEqual(before);
});

test.skipIf(process.platform === "win32")("special files are skipped in listings and refused before opening", async () => {
  const path = p(["special"]);
  execFileSync("mkfifo", [join(root, ...path)]);
  const before = await tree();
  for (const operation of [
    () => port.readFile(path),
    () => port.stat(path),
    () => port.listDirectory(path),
    () => port.ensureDirectory(path),
    () => port.commitFile(path, bytes, { kind: "absent" }),
    () => port.moveFile(path, p(["moved"])),
    () => port.moveDirectory(path, p(["moved"])),
    () => port.removeFile(path),
    () => port.removeDirectory(path)
  ]) await refuses(operation);
  expect(await port.listDirectory(p([]))).toEqual([]);
  expect(await tree()).toEqual(before);
});

test("forged segments cannot hide a descendant link behind lexical normalization", async () => {
  const forged = ["elsewhere", "..", "target.md"] as unknown as LibraryPath;
  await refuses(() => port.commitFile(forged, bytes, { kind: "absent" }), "invalid-path");
  expect(await readdir(root)).toEqual([]);
});

test("advisory watch keeps ordinary edits and deletions while suppressing linked paths", async () => {
  await put(join(root, "ordinary.md"));
  await put(join(outside, "external.md"));
  const events: string[] = [];
  const stop = port.watch(p([]), path => events.push(path.join("/")));
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  try {
    await delay(250); // Match existing watch tests: native registration arms asynchronously.
    await symlink(outside, join(root, "linked"), "dir");
    await symlink(join(outside, "external.md"), join(root, "linked.md"), "file");
    await put(join(root, "ordinary.md"), "Synthetic edit.\n");
    await put(join(outside, "external.md"), "Synthetic outside edit.\n");
    await delay(400);
    expect(events).toContain("ordinary.md");
    expect(events.some(path => path === "linked" || path === "linked.md" || path.startsWith("linked/"))).toBe(false);
    events.length = 0;
    await unlink(join(root, "ordinary.md"));
    await delay(400);
    expect(events).toContain("ordinary.md");
  } finally {
    stop();
  }
});
