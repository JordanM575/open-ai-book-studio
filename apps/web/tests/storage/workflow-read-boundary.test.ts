import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { WORKFLOW_LIMITS } from "../../../../packages/core/src/authoring/wire";
import { toLibraryPath } from "@ai-book-studio/core/library/path";
import { DirectoryHandleLibraryPort } from "../../src/storage/directory-port";
import { FakeDirectory } from "./support/fake-directory";

const encoder = new TextEncoder();
const small = encoder.encode("small synthetic file");
const intended = encoder.encode("intended synthetic file");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fixture(kind: "task" | "md" | "json") {
  const root = new FakeDirectory("synthetic");
  const port = new DirectoryHandleLibraryPort(root as unknown as FileSystemDirectoryHandle);
  const parent = ["books", "book_fixture", "workflows", "run_fixture", kind === "task" ? "tasks" : "artifacts"];
  const name = kind === "task" ? "task_fixture.json" : `artifact_fixture.${kind}`;
  let directory = root;
  for (const segment of parent) directory = await directory.getDirectoryHandle(segment, { create: true });
  directory.files.set(name, { bytes: small, lastModified: 1 });
  return { root, port, directory, name, path: toLibraryPath([...parent, name]),
    limit: kind === "task" ? WORKFLOW_LIMITS.recordBytes : WORKFLOW_LIMITS.artifactBytes };
}

for (const kind of ["task", "md", "json"] as const) {
  test(`${kind}: browser stat/read replacement refuses without materializing the oversized file`, async () => {
    const { port, directory, name, path, limit } = await fixture(kind);
    const reads: Array<{ method: string; size: number }> = [];
    directory.hooks.onRead = (_name, method, size) => reads.push({ method, size });
    expect((await port.stat(path))?.size).toBe(small.byteLength);
    const replacement = new Uint8Array(limit + 1).fill(88);
    directory.files.set(name, { bytes: replacement, lastModified: 2 });
    await expect(port.readFile(path)).rejects.toMatchObject({ code: "too-large" });
    expect(reads).toEqual([]);
    expect(directory.files.get(name)?.bytes).toEqual(replacement);
  });

  for (const stage of ["current", "recheck", "readback"] as const) {
    test(`${kind}: browser checked-commit ${stage} enforces its workflow bound`, async () => {
      const { port, directory, name, path, limit } = await fixture(kind);
      const replacement = new Uint8Array(limit + 1).fill(89);
      const reads: Array<{ method: string; size: number }> = [];
      let closes = 0;
      directory.hooks.onRead = (_name, method, size) => reads.push({ method, size });
      directory.hooks.afterClose = () => {
        closes++;
        if (stage === "readback") directory.files.set(name, { bytes: replacement, lastModified: 3 });
      };
      if (stage === "current") directory.files.set(name, { bytes: replacement, lastModified: 2 });
      if (stage === "recheck") directory.hooks.afterWrite = () => {
        directory.files.set(name, { bytes: replacement, lastModified: 2 });
      };
      await expect(port.commitFile(path, intended, { kind: "sha256", value: hash(small) }))
        .rejects.toMatchObject({ code: "too-large" });
      expect(closes).toBe(stage === "readback" ? 1 : 0);
      expect(directory.files.get(name)?.bytes).toEqual(replacement);
      expect(reads.every((read) => read.method === "slice" && read.size <= limit + 1)).toBe(true);
      expect(reads.length).toBe(stage === "current" ? 0 : stage === "recheck" ? 1 : 2);
    });
  }
}

test("a browser bounded slice remains bounded even if reported size is unexpectedly stale", async () => {
  const { port, directory, name, path, limit } = await fixture("task");
  const replacement = new Uint8Array(limit * 3).fill(90);
  const reads: Array<{ method: string; size: number }> = [];
  directory.files.set(name, { bytes: replacement, lastModified: 2 });
  directory.hooks.reportedSize = () => 1;
  directory.hooks.onRead = (_name, method, size) => reads.push({ method, size });
  await expect(port.readFile(path)).rejects.toMatchObject({ code: "too-large" });
  expect(reads).toEqual([{ method: "slice", size: limit + 1 }]);
  expect(directory.files.get(name)?.bytes).toEqual(replacement);
});

test("a tighter caller limit is enforced without truncation; exact-bound bytes succeed", async () => {
  const { port, path } = await fixture("task");
  expect((await port.readFile(path, { maxBytes: small.byteLength }))?.bytes).toEqual(small);
  await expect(port.readFile(path, { maxBytes: small.byteLength - 1 })).rejects.toMatchObject({ code: "too-large" });
  expect((await port.readFile(path))?.bytes).toEqual(small);
});

test("browser file and directory copies into workflow paths bound their source reads", async () => {
  const { root, port, path, limit } = await fixture("task");
  const oversized = new Uint8Array(limit + 1).fill(90);
  root.files.set("synthetic-source", { bytes: oversized, lastModified: 1 });
  const reads: Array<{ method: string; size: number }> = [];
  root.hooks.onRead = (_name, method, size) => reads.push({ method, size });
  await expect(port.moveFile(toLibraryPath(["synthetic-source"]), path)).rejects.toMatchObject({ code: "too-large" });
  expect(reads).toEqual([]);
  expect(root.files.get("synthetic-source")?.bytes).toEqual(oversized);

  const sourceDir = await root.getDirectoryHandle("synthetic-directory", { create: true });
  sourceDir.files.set("task_other.json", { bytes: oversized, lastModified: 1 });
  sourceDir.hooks.onRead = (_name, method, size) => reads.push({ method, size });
  const destination = toLibraryPath(["books", "book_fixture", "workflows", "run_fixture", "other-tasks"]);
  await expect(port.moveDirectory(toLibraryPath(["synthetic-directory"]), destination))
    .rejects.toMatchObject({ code: "too-large" });
  expect(reads).toEqual([]);
  expect(sourceDir.files.get("task_other.json")?.bytes).toEqual(oversized);
  expect(await port.listDirectory(destination)).toEqual([]);
});
