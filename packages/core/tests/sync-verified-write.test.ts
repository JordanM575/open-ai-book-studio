import { expect, test } from "bun:test";
import { toLibraryPath } from "../src/library/path";
import { readSyncJournal } from "../src/sync/journal";
import { makeBook } from "./workflow/record-fixtures";

const bytes = (value: string) => new TextEncoder().encode(value);

for (const history of ["new", "existing"] as const) {
  test(`shared non-workflow writer keeps a ${history} external replacement reviewable`, async () => {
    const { port, library, book } = await makeBook();
    const path = toLibraryPath(["books", book.id, "notes", "synthetic.txt"]);
    const name = path.join("/");
    const host = library.writeHost;
    if (history === "existing") {
      const initial = await host.withBook(book.id, () => host.commitFile(path, bytes("original"), { kind: "absent" }));
      expect(initial.status).toBe("written");
    }
    const originalCommit = port.commitFile.bind(port);
    let intendedHash = "";
    let outsideHash = "";
    port.commitFile = async (candidate, intended, expected) => {
      const result = await originalCommit(candidate, intended, expected);
      if (candidate.join("/") === name && result.status === "written") {
        intendedHash = result.snapshot.sha256;
        const outside = await originalCommit(path, bytes("outside"), { kind: "sha256", value: intendedHash });
        if (outside.status !== "written") throw new Error("Synthetic replacement failed");
        outsideHash = outside.snapshot.sha256;
      }
      return result;
    };
    const result = await host.withBook(book.id, () => host.commitFile(path, bytes("intended"), { kind: "any" }));
    expect(result.status).toBe("written");
    expect(intendedHash).not.toBe(outsideHash);
    const recorded = (await readSyncJournal(port, library.deviceId))?.files[name];
    expect(recorded?.sha256).toBe(intendedHash);
    expect(recorded?.writtenSha256).toBe(intendedHash);
    expect((await library.checkDrift()).entries.find((entry) => entry.path === name)?.kind).toBe("remote-changed");
    await originalCommit(path, bytes("later outside"), { kind: "sha256", value: outsideHash });
    expect((await library.checkDrift()).entries.find((entry) => entry.path === name)?.kind).toBe("remote-changed");
  });
}

test("a mismatched shared-writer readback does not become the baseline", async () => {
  const { port, library, book } = await makeBook();
  const path = toLibraryPath(["books", book.id, "notes", "synthetic.txt"]);
  const name = path.join("/");
  const host = library.writeHost;
  const initial = await host.withBook(book.id, () => host.commitFile(path, bytes("original"), { kind: "absent" }));
  if (initial.status !== "written") throw new Error("Synthetic setup failed");
  const originalCommit = port.commitFile.bind(port);
  port.commitFile = async (candidate, intended, expected) => {
    const result = await originalCommit(candidate, intended, expected);
    if (candidate.join("/") !== name || result.status !== "written") return result;
    return originalCommit(path, bytes("outside"), { kind: "sha256", value: result.snapshot.sha256 });
  };
  await host.withBook(book.id, () => host.commitFile(path, bytes("intended"), { kind: "sha256", value: initial.snapshot.sha256 }));
  expect((await readSyncJournal(port, library.deviceId))?.files[name]?.sha256).toBe(initial.snapshot.sha256);
  expect((await library.checkDrift()).entries.find((entry) => entry.path === name)?.kind).toBe("remote-changed");
});

test("legacy explicit non-workflow notes retain observation-based behavior", async () => {
  const { port, library, book } = await makeBook();
  const path = toLibraryPath(["books", book.id, "notes", "synthetic.txt"]);
  const name = path.join("/");
  const written = await port.commitFile(path, bytes("explicitly noted"), { kind: "absent" });
  if (written.status !== "written") throw new Error("Synthetic setup failed");
  await library.noteOwnFiles({ written: [name] });
  expect((await readSyncJournal(port, library.deviceId))?.files[name]?.sha256).toBe(written.snapshot.sha256);
  expect((await library.checkDrift()).entries.find((entry) => entry.path === name)).toBeUndefined();
  await port.commitFile(path, bytes("outside"), { kind: "sha256", value: written.snapshot.sha256 });
  expect((await library.checkDrift()).entries.find((entry) => entry.path === name)?.kind).toBe("remote-changed");
});
