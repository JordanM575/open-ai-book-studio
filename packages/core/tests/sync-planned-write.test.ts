import { describe, expect, test } from "bun:test";
import { toLibraryPath } from "../src/library/path";
import { syncJournalPath } from "../src/library/paths";
import { notePlannedWrite, noteRemovedFiles, noteWrittenFiles, readSyncJournal, writeSyncJournal } from "../src/sync/journal";
import { contextPath, taskPath } from "../src/workflow/paths";
import { contextRecord, makeBook, runId, taskRecord } from "./workflow/record-fixtures";

const bytes = (value: string) => new TextEncoder().encode(value);
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic value");
  return value;
}

describe("definitive prepublication journal reconciliation", () => {
  for (const kind of ["task", "context", "shared"] as const) {
    for (const history of ["new", "existing"] as const) {
      for (const outside of ["equal", "different"] as const) {
        test(`${history} ${kind}, ${outside} outside bytes remain reviewable`, async () => {
          const { port, library, book } = await makeBook();
          const host = library.writeHost;
          const path = kind === "task" ? taskPath(book.id, runId, "task_00000001")
            : kind === "context" ? contextPath(book.id, runId, "context_00000001")
            : toLibraryPath(["books", book.id, "notes", "race.txt"]);
          const name = path.join("/");
          let value: unknown = kind === "task" ? taskRecord(book.id) : kind === "context" ? contextRecord(book.id) : bytes("intended");
          if (history === "existing") {
            if (kind === "task") {
              const first = await library.workflowRecords.saveTask(book.id, runId, value);
              value = taskRecord(book.id, { revision: 2, base: { kind: "sha256", value: first.record.hash, revision: 1 }, synthetic: "new" });
            } else if (kind === "context") {
              await library.workflowRecords.createContext(book.id, runId, value);
              await port.removeFile(path);
              value = contextRecord(book.id, { synthetic: "new" });
            } else {
              expect((await host.withBook(book.id, () => host.commitFile(path, bytes("original"), { kind: "absent" }))).status).toBe("written");
            }
          }
          const before = (await readSyncJournal(port, library.deviceId))?.files[name];
          const commit = port.commitFile.bind(port);
          let calls = 0;
          let installed = new Uint8Array();
          port.commitFile = async (target, intended, expected) => {
            if (target.join("/") !== name) return commit(target, intended, expected);
            calls++;
            installed = outside === "equal" ? new Uint8Array(intended)
              : kind === "shared" ? bytes("outside")
              : bytes(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(intended)), synthetic: "outside" }));
            expect((await commit(target, installed, { kind: "any" })).status).toBe("written");
            const result = await commit(target, intended, expected);
            expect(result).toMatchObject({ status: "changed" });
            if (result.status === "changed") expect(result.publication).toBeUndefined();
            return result;
          };
          const operation = kind === "task" ? library.workflowRecords.saveTask(book.id, runId, value)
            : kind === "context" ? library.workflowRecords.createContext(book.id, runId, value)
            : host.withBook(book.id, () => host.commitFile(path, value as Uint8Array,
              before ? { kind: "sha256", value: before.sha256 } : { kind: "absent" }));
          if (kind !== "shared" && outside === "different") await expect(operation).rejects.toMatchObject({ code: "conflict" });
          else expect((await operation).status).toBe(kind === "shared" ? "changed" : "unchanged");
          expect(calls).toBe(1);
          expect((await port.readFile(path))?.bytes).toEqual(installed);
          expect((await readSyncJournal(port, library.deviceId))?.files[name]).toEqual(before);
          const drift = await library.checkDrift();
          expect(drift.entries.find((entry) => entry.path === name)?.kind).toBe(history === "new" ? "new-remote" : "remote-changed");
          expect(drift.clean).toBe(false);
        });
      }
    }
  }
});

async function setup() {
  const { port, library, book } = await makeBook();
  const path = toLibraryPath(["books", book.id, "notes", "intent.txt"]);
  const name = path.join("/");
  const commit = port.commitFile.bind(port);
  await commit(path, bytes("observed"), { kind: "absent" });
  await library.acceptDrift([name]);
  const input = { storage: port, deviceId: library.deviceId, paths: [name], now: port.now() };
  const record = async () => required((await readSyncJournal(port, library.deviceId))?.files[name]);
  const plan = async (text: string) => notePlannedWrite({ ...input, sha256: await port.sha256(bytes(text)) });
  const write = (text: string) => library.writeHost.withBook(book.id,
    async () => library.writeHost.commitFile(path, bytes(text), { kind: "sha256", value: (await record()).sha256 }));
  return { port, library, path, name, commit, input, record, plan, write };
}

test.each(["absent", "different", "same"] as const)("a refusal restores the exact %s prior intent", async (prior) => {
  const f = await setup();
  if (prior !== "absent") await (await f.plan(prior === "same" ? "intended" : "older intent")).settle("possible");
  const before = await f.record();
  f.port.commitFile = async (path, intended, expected) => {
    if (path.join("/") !== f.name) return f.commit(path, intended, expected);
    await f.commit(path, intended, { kind: "any" });
    return f.commit(path, intended, expected);
  };
  expect((await f.write("intended")).status).toBe("changed");
  expect(await f.record()).toEqual(before);
  const drift = await f.library.checkDrift();
  expect(drift.entries.find((entry) => entry.path === f.name)?.kind).toBe(prior === "same" ? "local-changed" : "remote-changed");
  // A preexisting interrupted same-byte attempt is retained, rather than claiming it did not write.
});

test.each(["same", "different"] as const)("a refusal preserves a concurrent %s-hash newer intent", async (value) => {
  const f = await setup();
  let newer!: Awaited<ReturnType<typeof f.plan>>;
  let newerRecord!: Awaited<ReturnType<typeof f.record>>;
  const before = await f.record();
  f.port.commitFile = async (path, intended, expected) => {
    if (path.join("/") !== f.name) return f.commit(path, intended, expected);
    await f.commit(path, intended, { kind: "any" });
    newer = await f.plan(value === "same" ? "intended" : "newer intent");
    newerRecord = await f.record();
    return f.commit(path, intended, expected);
  };
  expect((await f.write("intended")).status).toBe("changed");
  expect(await f.record()).toEqual(newerRecord);
  // Retiring the newer refusal must not resurrect the older refused intent.
  await newer.settle("not-published");
  expect(await f.record()).toEqual(before);
  expect((await f.library.checkDrift()).entries.find((entry) => entry.path === f.name)?.kind).toBe("remote-changed");
});

for (const order of ["oldest-first", "newest-first", "middle-first"] as const) {
  test(`overlapping same-hash refusals settle ${order} without resurrecting another refusal`, async () => {
    const f = await setup();
    const before = await f.record();
    const receipts = [await f.plan("one"), await f.plan("one"), await f.plan("one")];
    const indices = order === "oldest-first" ? [0, 1, 2] : order === "newest-first" ? [2, 1, 0] : [1, 0, 2];
    for (const index of indices) await required(receipts[index]).settle("not-published");
    expect(await f.record()).toEqual(before);
    // A completed receipt is one-shot, even if asked again after another plan.
    const next = await f.plan("next");
    const nextRecord = await f.record();
    await required(receipts[0]).settle("not-published");
    expect(await f.record()).toEqual(nextRecord);
    await next.settle("not-published");
    expect(await f.record()).toEqual(before);
  });
}

test.each(["written", "removed", "accepted", "other-path"] as const)("a concurrent %s note survives refusal", async (note) => {
  const f = await setup();
  const before = await f.record();
  const receipt = await f.plan("intended");
  const other = toLibraryPath([...f.path.slice(0, -1), "other.txt"]);
  if (note === "written") {
    await f.commit(f.path, bytes("intended"), { kind: "any" });
    await noteWrittenFiles(f.input);
  } else if (note === "removed") {
    await f.port.removeFile(f.path);
    await noteRemovedFiles(f.input);
  } else if (note === "accepted") {
    await f.commit(f.path, bytes("outside"), { kind: "any" });
    await f.library.acceptDrift([f.name]);
  } else {
    await f.commit(other, bytes("other file"), { kind: "absent" });
    await noteWrittenFiles({ ...f.input, paths: [other.join("/")] });
  }
  const intervening = required(await readSyncJournal(f.port, f.library.deviceId));
  await receipt.settle("not-published");
  const after = required(await readSyncJournal(f.port, f.library.deviceId));
  expect(after.files[f.name]).toEqual(note === "other-path" ? before : intervening.files[f.name]);
  expect(after.files[other.join("/")]).toEqual(intervening.files[other.join("/")]);
});

test.each(["uncertain", "throw", "bad-readback", "verified"] as const)("%s outcome retains recovery or the verified baseline", async (outcome) => {
  const f = await setup();
  const before = await f.record();
  let calls = 0;
  f.port.commitFile = async (path, intended, expected) => {
    const result = await f.commit(path, intended, expected);
    if (path.join("/") !== f.name) return result;
    calls++;
    if (outcome === "throw") throw new Error("Synthetic failure after publication");
    if (result.status !== "written") throw new Error("Expected synthetic publication");
    if (outcome === "uncertain") return { status: "changed", current: result.snapshot, publication: "uncertain" };
    if (outcome === "bad-readback") return { status: "written", snapshot: { ...result.snapshot, sha256: "0".repeat(64) } };
    return result;
  };
  if (outcome === "throw") await expect(f.write("intended")).rejects.toThrow("Synthetic failure");
  else expect((await f.write("intended")).status).toBe(outcome === "uncertain" ? "changed" : "written");
  expect(calls).toBe(1);
  const after = await f.record();
  const intendedHash = await f.port.sha256(bytes("intended"));
  expect(after.writtenSha256).toBe(intendedHash);
  expect(after.sha256).toBe(outcome === "verified" ? intendedHash : before.sha256);
  if (outcome === "verified") expect(after.plannedWriteId).toBeUndefined();
  else expect(after.plannedWriteId).toBeString();
  expect((await f.library.checkDrift()).clean).toBe(true);
});

test.each(["before", "after"] as const)("an intent-note exception %s journal publication is reconciled by identity", async (when) => {
  const f = await setup();
  const before = await f.record();
  const journalName = syncJournalPath(f.library.deviceId).join("/");
  let failed = false;
  f.port.commitFile = async (path, intended, expected) => {
    if (path.join("/") === journalName && !failed) {
      failed = true;
      if (when === "after") await f.commit(path, intended, expected);
      throw new Error("Synthetic journal note error");
    }
    if (path.join("/") === f.name) await f.commit(path, intended, { kind: "any" });
    return f.commit(path, intended, expected);
  };
  expect((await f.write("intended")).status).toBe("changed");
  expect(failed).toBe(true);
  expect(await f.record()).toEqual(before);
  expect((await f.library.checkDrift()).clean).toBe(false);
});

test("journal reconciliation failure does not repeat or fail the author-file refusal", async () => {
  const f = await setup();
  const journalName = syncJournalPath(f.library.deviceId).join("/");
  let calls = 0;
  let journalWrites = 0;
  f.port.commitFile = async (path, intended, expected) => {
    if (path.join("/") === journalName && ++journalWrites === 2) throw new Error("Synthetic reconciliation refusal");
    if (path.join("/") === f.name) {
      calls++;
      await f.commit(path, intended, { kind: "any" });
    }
    return f.commit(path, intended, expected);
  };
  expect((await f.write("intended")).status).toBe("changed");
  expect(calls).toBe(1);
  expect(journalWrites).toBe(2);
  expect((await f.port.readFile(f.path))?.bytes).toEqual(bytes("intended"));
  // Best-effort journal I/O can leave the recovery intent; this is not successful reconciliation.
  expect((await f.record()).plannedWriteId).toBeString();
});

test("legacy journals round-trip without inventing a planned owner", async () => {
  const f = await setup();
  const journal = required(await readSyncJournal(f.port, f.library.deviceId));
  expect(journal.files[f.name]?.plannedWriteId).toBeUndefined();
  await writeSyncJournal(f.port, journal);
  expect(await readSyncJournal(f.port, f.library.deviceId)).toEqual(journal);
});
