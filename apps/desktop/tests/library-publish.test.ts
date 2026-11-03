import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import { FileSystemLibraryPort } from "../src/main/library/fs-port";

/**
 * The publication boundary an importer can rely on (spec 029 T003).
 *
 * A staged book becomes visible with one directory rename inside the same library.
 * Readers see either the old location or the new one, never a partial tree — but only
 * when staging and destination share a device, which is why the port refuses a
 * cross-device move instead of copying file by file.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function library(): Promise<{ root: string; port: FileSystemLibraryPort }> {
  const root = await mkdtemp(join(tmpdir(), "studio-publish-"));
  cleanups.push(root);
  return { root, port: new FileSystemLibraryPort(root) };
}

async function stage(port: FileSystemLibraryPort, name: string): Promise<string[]> {
  const staged = [".studio", "staging", name];
  await port.ensureDirectory(toLibraryPath([...staged, "chapters"]));
  await port.commitFile(toLibraryPath([...staged, "book.json"]), new TextEncoder().encode(`{"id": "${name}"}`), {
    kind: "absent"
  });
  await port.commitFile(
    toLibraryPath([...staged, "chapters", "0001-first.md"]),
    new TextEncoder().encode("First.\n"),
    { kind: "absent" }
  );
  return staged;
}

describe("staging and atomic publication", () => {
  test("staging and the published tree share one device, so a rename publishes atomically", async () => {
    const { root } = await library();
    await mkdir(join(root, ".studio", "staging"), { recursive: true });
    await mkdir(join(root, "books"), { recursive: true });
    expect((await stat(join(root, ".studio", "staging"))).dev).toBe((await stat(join(root, "books"))).dev);
  });

  test("one move makes the complete book visible and removes the staging tree", async () => {
    const { root, port } = await library();
    const staged = await stage(port, "import_test000001");
    const published = toLibraryPath(["books", "book_test000001"]);

    await port.moveDirectory(toLibraryPath(staged), published);

    const entries = await readdir(join(root, "books", "book_test000001")).then((names) => names.sort());
    expect(entries).toEqual(["book.json", "chapters"]);
    expect(await readFile(join(root, "books", "book_test000001", "book.json"), "utf8")).toBe(
      `{"id": "import_test000001"}`
    );
    await expect(stat(join(root, ".studio", "staging", "import_test000001"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("publishing refuses to cover an existing destination and keeps staging intact", async () => {
    const { port } = await library();
    const staged = await stage(port, "import_test000002");
    const published = toLibraryPath(["books", "book_test000002"]);
    await port.ensureDirectory(published);

    await expect(port.moveDirectory(toLibraryPath(staged), published)).rejects.toMatchObject({
      code: "already-exists"
    });
    expect(await port.readFile(toLibraryPath([...staged, "book.json"]))).not.toBeNull();
  });

  test("staging cleanup removes only its own tree and fails loudly when missing", async () => {
    const { root, port } = await library();
    const staged = await stage(port, "import_test000003");
    await port.commitFile(
      toLibraryPath(["books", "book_test000003", "book.json"]),
      new TextEncoder().encode("keep"),
      { kind: "absent" }
    );

    await port.removeDirectory(toLibraryPath(staged));

    await expect(stat(join(root, ".studio", "staging", "import_test000003"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(await readFile(join(root, "books", "book_test000003", "book.json"), "utf8")).toBe("keep");
    await expect(port.removeDirectory(toLibraryPath(staged))).rejects.toBeInstanceOf(LibraryPortError);
  });
});
