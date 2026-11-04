import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAtomicWriter, isAtomicTempName } from "../src/main/library/atomic";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-atomic-fault-"));
  roots.push(root);
  const path = join(root, "chapter.md");
  await writeFile(path, "original");
  return { root, path };
}
function errno(code: string) { return Object.assign(new Error(code), { code }); }

test("exclusive collisions preserve sentinels, including exhausted attempts", async () => {
  const { root, path } = await fixture();
  const sentinel = join(root, ".chapter.md.1.abc.tmp");
  await writeFile(sentinel, "sentinel");
  let count = 0;
  const write = createAtomicWriter({ tempName: () => ++count === 1 ? ".chapter.md.1.abc.tmp" : ".chapter.md.1.def.tmp" });
  await write(path, "new");
  expect(await readFile(sentinel, "utf8")).toBe("sentinel");
  expect(await readFile(path, "utf8")).toBe("new");
  expect(isAtomicTempName(".chapter.md.1.def.tmp")).toBe(true);
  await expect(createAtomicWriter({ tempName: () => ".chapter.md.1.abc.tmp" })(path, "bad")).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(sentinel, "utf8")).toBe("sentinel");
  expect(await readFile(path, "utf8")).toBe("new");
});

for (const code of ["EPERM", "EACCES", "EBUSY"]) {
  test(`rename ${code} retries with the same intact private temp`, async () => {
    const { root, path } = await fixture();
    let calls = 0;
    let temp = "";
    const settled: boolean[] = [];
    const writer = createAtomicWriter({
      rename: async (from, to) => {
        calls++;
        expect(await readFile(from, "utf8")).toBe("new");
        if (calls === 1) { temp = String(from); throw errno(code); }
        expect(String(from)).toBe(temp);
        return rename(from, to);
      },
      wait: async () => {},
      noteOwnWrite: () => (success) => { settled.push(success); },
    });
    await writer(path, "new");
    expect(calls).toBe(2);
    expect(settled).toEqual([true]);
    expect(await readdir(root)).toEqual(["chapter.md"]);
  });
}

for (const operation of ["writeFile", "chmod", "sync", "close"] as const) {
  test(`${operation} failure preserves original and primary error even if cleanup fails`, async () => {
    const { root, path } = await fixture();
    const primary = errno(`FAIL_${operation}`);
    const openFault = (async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      if (args[1] !== "wx") return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === operation) return async () => {
            if (key === "close") await target.close();
            throw primary;
          };
          if (key === "close" && operation !== "close") return async () => { await target.close(); throw errno("CLOSE"); };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof open;
    const writer = createAtomicWriter({ open: openFault });
    expect(await writer(path, "new").catch((error) => error)).toBe(primary);
    expect(await readFile(path, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["chapter.md"]);
  });
}

test("terminal rename and failed cleanup preserve the primary error and original", async () => {
  const { root, path } = await fixture();
  const primary = errno("ENOSPC");
  const settled: boolean[] = [];
  const writer = createAtomicWriter({
    rename: async () => { throw primary; },
    unlink: async () => { throw errno("EACCES"); },
    noteOwnWrite: () => (success) => { settled.push(success); },
  });
  expect(await writer(path, "new").catch((error) => error)).toBe(primary);
  expect(settled).toEqual([false]);
  expect(await readFile(path, "utf8")).toBe("original");
  expect((await readdir(root)).length).toBe(2);
});

test("a second retryable rename failure cleans up and reports the second error", async () => {
  const { root, path } = await fixture();
  const last = errno("EBUSY");
  let calls = 0;
  const settled: boolean[] = [];
  const writer = createAtomicWriter({
    rename: async () => { if (++calls === 1) throw errno("EPERM"); throw last; },
    wait: async () => {},
    noteOwnWrite: () => (success) => { settled.push(success); },
  });
  expect(await writer(path, "new").catch((error) => error)).toBe(last);
  expect(calls).toBe(2);
  expect(settled).toEqual([false]);
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await readdir(root)).toEqual(["chapter.md"]);
});

test("hash failure cleans the created temp without publishing", async () => {
  const { root, path } = await fixture();
  const primary = errno("HASH");
  const writer = createAtomicWriter({ sha256: () => { throw primary; } });
  expect(await writer(path, "new").catch((error) => error)).toBe(primary);
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await readdir(root)).toEqual(["chapter.md"]);
});

test("temp is private while bytes are written", async () => {
  const { path } = await fixture();
  const openInspect = (async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    if (args[1] === "wx") expect((await handle.stat()).mode & 0o777).toBe(0o600 & ~process.umask());
    return handle;
  }) as typeof open;
  await createAtomicWriter({ open: openInspect })(path, "new");
});

test("new and explicit modes respect umask; replacement preserves its mode", async () => {
  const { root, path } = await fixture();
  const previous = process.umask(0o077);
  try {
    await chmod(path, 0o640);
    const seen: number[] = [];
    const writer = createAtomicWriter({ rename: async (from, to) => {
      seen.push((await stat(from)).mode & 0o777);
      return rename(from, to);
    } });
    await writer(path, "replacement");
    await writer(join(root, "new"), "new");
    await writer(join(root, "explicit"), "new", { mode: 0o666 });
    expect(seen).toEqual([0o640, 0o600, 0o600]);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  } finally { process.umask(previous); }
});
