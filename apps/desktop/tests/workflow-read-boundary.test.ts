import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WORKFLOW_LIMITS } from "../../../packages/core/src/authoring/wire";
import { toLibraryPath, type LibraryPath } from "@ai-book-studio/core/library/path";
import { readBoundedBytes } from "../src/main/library/bounded-read";
import { ChangeBatcher } from "../src/main/library/changes";
import { FileSystemLibraryPort } from "../src/main/library/fs-port";
import { copyAcrossDevices } from "../src/main/library/move-file";
import { isOwnState, noteOwnFile } from "../src/main/library/own-writes";

const small = new TextEncoder().encode("small synthetic file");
const intended = new TextEncoder().encode("intended synthetic file");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let root: string;

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pr43-bounded-desktop-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function pathFor(kind: "task" | "md" | "json"): { path: LibraryPath; limit: number } {
  const directory = kind === "task" ? "tasks" : "artifacts";
  const name = kind === "task" ? "task_fixture.json" : `artifact_fixture.${kind}`;
  return { path: toLibraryPath(["books", "book_fixture", "workflows", "run_fixture", directory, name]),
    limit: kind === "task" ? WORKFLOW_LIMITS.recordBytes : WORKFLOW_LIMITS.artifactBytes };
}

async function put(path: LibraryPath, bytes: Uint8Array): Promise<void> {
  const absolute = join(root, ...path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
}

for (const kind of ["task", "md", "json"] as const) {
  test(`${kind}: desktop stat/read replacement refuses and preserves the oversized file`, async () => {
    const { path, limit } = pathFor(kind);
    const port = new FileSystemLibraryPort(root);
    await put(path, small);
    expect((await port.stat(path))?.size).toBe(small.byteLength);
    const replacement = new Uint8Array(limit + 1).fill(88);
    await put(path, replacement);
    await expect(port.readFile(path)).rejects.toMatchObject({ code: "too-large" });
    expect(new Uint8Array(await readFile(join(root, ...path)))).toEqual(replacement);
  });

  for (const stage of ["current", "readback"] as const) {
    test(`${kind}: desktop checked-commit ${stage} is bounded`, async () => {
      const { path, limit } = pathFor(kind);
      const replacement = new Uint8Array(limit + 1).fill(89);
      await put(path, small);
      class RacingPort extends FileSystemLibraryPort {
        reads = 0;
        override async readFile(candidate: LibraryPath, options?: { maxBytes: number }) {
          if (candidate.join("/") === path.join("/")) {
            this.reads++;
            if (this.reads === (stage === "current" ? 1 : 2)) await put(path, replacement);
          }
          return super.readFile(candidate, options);
        }
      }
      const port = new RacingPort(root);
      await expect(port.commitFile(path, intended, { kind: "sha256", value: hash(small) }))
        .rejects.toMatchObject({ code: "too-large" });
      expect(port.reads).toBe(stage === "current" ? 1 : 2);
      expect(new Uint8Array(await readFile(join(root, ...path)))).toEqual(replacement);
    });
  }
}

test("desktop bounded stream detects growth after descriptor stat using at most one sentinel byte", async () => {
  const limit = WORKFLOW_LIMITS.recordBytes;
  const growing = new Uint8Array(limit * 3).fill(90);
  let offset = 0;
  const requests: number[] = [];
  const read = async (buffer: Buffer) => {
    requests.push(buffer.byteLength);
    const count = Math.min(buffer.byteLength, growing.byteLength - offset);
    buffer.set(growing.subarray(offset, offset + count));
    offset += count;
    return count;
  };
  await expect(readBoundedBytes(read, limit)).rejects.toMatchObject({ code: "too-large" });
  expect(offset).toBe(limit + 1);
  expect(requests.reduce((sum, size) => sum + size, 0)).toBe(limit + 1);
  expect(Math.max(...requests)).toBeLessThanOrEqual(65_536);
  expect(requests.at(-1)).toBe(1);
});

test("desktop bounded stream returns complete exact-bound data, including partial reads", async () => {
  const expected = new Uint8Array(73).fill(42);
  let offset = 0;
  const result = await readBoundedBytes(async (buffer) => {
    const count = Math.min(7, buffer.byteLength, expected.length - offset);
    buffer.set(expected.subarray(offset, offset + count));
    offset += count;
    return count;
  }, expected.length);
  expect(result).toEqual(expected);
  expect(offset).toBe(expected.length);
  expect((await readBoundedBytes(async () => 0, 0)).byteLength).toBe(0);
});

test("cross-device fallback refuses a source that grew after an earlier snapshot", async () => {
  const { path, limit } = pathFor("task");
  const port = new FileSystemLibraryPort(root);
  const source = join(root, ...path);
  const destination = join(root, "synthetic-destination");
  await put(path, small);
  expect((await port.readFile(path))?.bytes).toEqual(small);
  const replacement = new Uint8Array(limit + 1).fill(88);
  await put(path, replacement);
  await expect(copyAcrossDevices(source, destination, limit)).rejects.toMatchObject({ code: "too-large" });
  expect(new Uint8Array(await readFile(source))).toEqual(replacement);
  await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  await put(path, small);
  await copyAcrossDevices(source, destination, limit);
  expect(new Uint8Array(await readFile(destination))).toEqual(small);
  await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
});

test("moving into a workflow path bounds even the initial source read", async () => {
  const { path, limit } = pathFor("task");
  const source = toLibraryPath(["synthetic-source"]);
  const replacement = new Uint8Array(limit + 1).fill(88);
  await put(source, replacement);
  await expect(new FileSystemLibraryPort(root).moveFile(source, path)).rejects.toMatchObject({ code: "too-large" });
  expect(new Uint8Array(await readFile(join(root, ...source)))).toEqual(replacement);
  await expect(readFile(join(root, ...path))).rejects.toMatchObject({ code: "ENOENT" });
});

test("watcher reports an oversized workflow path rather than accepting or allocating it", async () => {
  const { path, limit } = pathFor("task");
  const ordinary = toLibraryPath(["books", "book_fixture", "chapters", "synthetic.md"]);
  const oversized = new Uint8Array(limit + 1).fill(90);
  await put(path, oversized);
  await put(ordinary, oversized);
  noteOwnFile(join(root, ...path), hash(oversized));
  noteOwnFile(join(root, ...ordinary), hash(oversized));
  expect(await isOwnState(join(root, ...path), limit)).toBe(false);
  expect(await isOwnState(join(root, ...ordinary))).toBe(true);
  let batcher: ChangeBatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const notified = new Promise<string[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Watcher did not report the oversized workflow path")), 2_000);
      batcher = new ChangeBatcher(root, (event) => resolve(event.paths), 1);
      batcher.add(path.join("/"));
      batcher.add(ordinary.join("/"));
    });
    expect(await notified).toEqual([path.join("/")]);
  } finally {
    if (timer) clearTimeout(timer);
    batcher?.stop();
  }
});
