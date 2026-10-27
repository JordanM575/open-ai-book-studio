import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/main/library/atomic";

/**
 * The atomic write, which is the promise that a manuscript is never half-written.
 *
 * A save in this app is a write to a temporary sibling and a rename over the target. If that is
 * wrong, the failure is an author opening their book to find the first half of the new chapter and
 * the second half of the old one — or nothing at all. So the tests are about what is on disk after
 * a failure, not about the happy path alone: the previous complete file has to still be there, and
 * the temporary file has to be gone.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "studio-atomic-"));
  cleanups.push(root);
  return root;
}

/** Every entry in a directory, so a leftover temporary file cannot hide. */
async function entries(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

describe("writing a file", () => {
  test("creates it with the bytes it was given", async () => {
    const dir = await folder();
    const path = join(dir, "chapter.md");
    await writeFileAtomic(path, "The storm came in low.\n");
    expect(await readFile(path, "utf8")).toBe("The storm came in low.\n");
  });

  test("replaces a file in one step, and leaves nothing beside it", async () => {
    const dir = await folder();
    const path = join(dir, "chapter.md");
    await writeFileAtomic(path, "first version\n");
    await writeFileAtomic(path, "second version\n");

    expect(await readFile(path, "utf8")).toBe("second version\n");
    // A temp file left behind is a temp file that will be mistaken for a chapter one day.
    expect(await entries(dir)).toEqual(["chapter.md"]);
  });

  test("writes binary bytes without turning them into text", async () => {
    const dir = await folder();
    const path = join(dir, "page.png");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await writeFileAtomic(path, bytes);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
  });

  test("honours the mode it is given, because a library is the author's alone", async () => {
    const dir = await folder();
    const path = join(dir, "private.md");
    await writeFileAtomic(path, "not for others\n", { mode: 0o600 });
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("a large file lands whole rather than in pieces", async () => {
    const dir = await folder();
    const path = join(dir, "long.md");
    const text = `${"The lamp would not turn. ".repeat(20_000)}\n`;
    await writeFileAtomic(path, text);
    expect((await readFile(path, "utf8")).length).toBe(text.length);
    expect(await entries(dir)).toEqual(["long.md"]);
  });
});

describe("when the write cannot finish", () => {
  test("a missing folder fails, and nothing is left anywhere", async () => {
    const dir = await folder();
    const path = join(dir, "gone", "chapter.md");
    await expect(writeFileAtomic(path, "text")).rejects.toThrow();
    expect(await entries(dir)).toEqual([]);
  });

  test("a target that cannot be replaced leaves the previous file exactly as it was", async () => {
    // A directory where the file should be is the shape a bad restore leaves behind. The rename
    // fails, and the important part is that the failure does not become a deletion.
    const dir = await folder();
    const path = join(dir, "chapter.md");
    await mkdir(path);
    await writeFile(join(path, "inside.md"), "unrelated\n");

    await expect(writeFileAtomic(path, "replacement")).rejects.toThrow();

    // Nothing was renamed over the folder, nothing was left next to it, and what was there is there.
    expect(await entries(dir)).toEqual(["chapter.md"]);
    expect(await readFile(join(path, "inside.md"), "utf8")).toBe("unrelated\n");
  });

  test("two writers at once never produce a mingled file", async () => {
    // Each version is long enough that an interleaved write would be visible as mixed lines.
    const dir = await folder();
    const path = join(dir, "chapter.md");
    const a = `${"alpha ".repeat(5_000)}\n`;
    const b = `${"bravo ".repeat(5_000)}\n`;

    await Promise.allSettled([writeFileAtomic(path, a), writeFileAtomic(path, b)]);

    // One of the two has to be the whole file; the losing writer's rename simply replaces it.
    const text = await readFile(path, "utf8");
    expect([a, b]).toContain(text);
    // And no temp files survive the race.
    expect(await entries(dir)).toEqual(["chapter.md"]);
  });

  test("a file that already exists is untouched when the replacement cannot be made", async () => {
    // A write that cannot even open its temporary file is the common failure: a read-only volume,
    // a full disk, a folder removed underneath the app. The file that is there has to survive it.
    const dir = await folder();
    const path = join(dir, "chapter.md");
    await writeFileAtomic(path, "the version that must survive\n");
    const original = await readFile(path, "utf8");

    // Turning the folder read-only makes the temporary file impossible to create.
    await chmod(dir, 0o500);
    try {
      const failure = await writeFileAtomic(path, "never lands").catch((error: unknown) => error);
      // Some environments (a root user, a filesystem without modes) can still write; nothing is
      // asserted about the error in that case, only that the file is correct afterwards.
      void failure;
    } finally {
      await chmod(dir, 0o700);
    }

    expect(await readFile(path, "utf8")).toBe(original);
    expect(await entries(dir)).toEqual(["chapter.md"]);
  });
});
