import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { toLibraryPath } from "../src/library/path";
import { syncJournalPath } from "../src/library/paths";
import { noteMovedPrefix, notePlannedWrite, readSyncJournal } from "../src/sync/journal";
import { taskPath } from "../src/workflow/paths";
import { makeBook, runId, taskRecord } from "./workflow/record-fixtures";

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic value");
  return value;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function pausedWrite(kind: "workflow" | "shared", history: "new" | "existing") {
  const f = await makeBook();
  const other = await LibraryService.open({ storage: f.port, runtime: f.port });
  const path = kind === "workflow" ? taskPath(f.book.id, runId, "task_00000001")
    : toLibraryPath(["books", f.book.id, "notes", "verified-owner.txt"]);
  const name = path.join("/");
  let value = taskRecord(f.book.id);
  if (history === "existing") {
    if (kind === "workflow") {
      const initial = await f.library.workflowRecords.saveTask(f.book.id, runId, value);
      value = taskRecord(f.book.id, { revision: 2, base: { kind: "sha256", value: initial.record.hash, revision: 1 } });
    } else {
      await f.library.writeHost.withBook(f.book.id, () => f.library.writeHost.commitFile(path, encode("initial"), { kind: "absent" }));
    }
  }
  const record = async () => (await readSyncJournal(f.port, f.library.deviceId))?.files[name];
  const before = await record();
  const commit = f.port.commitFile.bind(f.port);
  const entered = gate(), released = gate();
  let calls = 0;
  let intended = new Uint8Array();
  let intendedHash = "";
  f.port.commitFile = async (target, bytes, expected) => {
    const result = await commit(target, bytes, expected);
    if (target.join("/") === name && ++calls === 1) {
      if (result.status !== "written") throw new Error("Synthetic checked save refused");
      intended = result.snapshot.bytes.slice();
      intendedHash = result.snapshot.sha256;
      entered.release();
      await released.promise;
    }
    return result;
  };
  const pending = kind === "workflow" ? f.library.workflowRecords.saveTask(f.book.id, runId, value)
    : f.library.writeHost.withBook(f.book.id, () => f.library.writeHost.commitFile(path, encode("intended"),
      before ? { kind: "sha256", value: before.sha256 } : { kind: "absent" }));
  await entered.promise;
  const outside = kind === "workflow" ? encode(JSON.stringify({ ...JSON.parse(decode(intended)), synthetic: "reviewed outside" }))
    : encode("reviewed outside");
  const finish = async () => {
    released.release();
    expect((await pending).status).toBe(kind === "workflow" ? "saved" : "written");
  };
  return { ...f, other, path, name, record, before, commit, intended, intendedHash, outside, finish,
    calls: () => calls, drift: async () => (await f.library.checkDrift()).entries.find((entry) => entry.path === name) };
}

describe("verified journal notes retain their initiating owner", () => {
  for (const kind of ["workflow", "shared"] as const) {
    for (const history of ["new", "existing"] as const) {
      test(`${kind} ${history}: a later accepted baseline survives and a return to old saved bytes is outside drift`, async () => {
        const f = await pausedWrite(kind, history);
        await f.commit(f.path, f.outside, { kind: "sha256", value: f.intendedHash });
        await f.library.acceptDrift([f.name]);
        const accepted = required(await f.record());
        await f.finish();
        expect(await f.record()).toEqual(accepted);
        expect(await f.drift()).toBeUndefined();
        expect((await f.port.readFile(f.path))?.bytes).toEqual(f.outside);
        await f.commit(f.path, f.intended, { kind: "sha256", value: accepted.sha256 });
        expect((await f.drift())?.kind).toBe("remote-changed");
        expect((await f.library.checkDrift()).clean).toBe(false);
        expect(f.calls()).toBe(1);
      });

      for (const bytes of ["same", "different"] as const) {
        for (const outcome of ["verified", "uncertain"] as const) {
          test(`${kind} ${history}: a newer ${outcome} ${bytes}-byte same-port write survives`, async () => {
            const f = await pausedWrite(kind, history);
            if (outcome === "uncertain") f.port.commitFile = async (path, intended, expected) => {
              const result = await f.commit(path, intended, expected);
              return path.join("/") === f.name && result.status === "written"
                ? { status: "changed", current: result.snapshot, publication: "uncertain" } : result;
            };
            const newerBytes = bytes === "same" ? f.intended : f.outside;
            const result = await f.other.writeHost.withBook(f.book.id, () =>
              f.other.writeHost.commitFile(f.path, newerBytes, { kind: "sha256", value: f.intendedHash }));
            expect(result.status).toBe(outcome === "verified" ? "written" : "changed");
            const newer = await f.record();
            await f.finish();
            expect(await f.record()).toEqual(newer);
            expect((await f.port.readFile(f.path))?.bytes).toEqual(newerBytes);
            if (outcome === "uncertain" && history === "existing") expect(newer?.plannedWriteId).toBeString();
            if (outcome === "verified" && bytes === "different") {
              await f.commit(f.path, f.intended, { kind: "sha256", value: required(newer).sha256 });
              expect((await f.drift())?.kind).toBe("remote-changed");
            }
          });
        }
      }

      for (const removal of ["accepted", "noted", "moved"] as const) {
        test(`${kind} ${history}: a newer ${removal} removal survives the delayed snapshot`, async () => {
          const f = await pausedWrite(kind, history);
          if (removal === "moved") {
            const destination = toLibraryPath([".studio", "trash", "synthetic-owner", "removed.json"]);
            await f.port.moveFile(f.path, destination);
            await noteMovedPrefix({ storage: f.port, deviceId: f.library.deviceId, from: f.name,
              to: destination.join("/"), now: f.port.now() });
          } else {
            await f.port.removeFile(f.path);
            if (removal === "accepted") await f.library.acceptDrift([f.name]);
            else await f.library.noteOwnFiles({ removed: [f.name] });
          }
          const removed = await f.record();
          await f.finish();
          expect(await f.record()).toEqual(removed);
          expect(await f.port.readFile(f.path)).toBeNull();
          await f.commit(f.path, f.intended, { kind: "absent" });
          expect((await f.drift())?.kind).toBe(history === "new" ? "new-remote" : "local-deleted");
          expect((await f.library.checkDrift()).clean).toBe(false);
        });
      }

      test(`${kind} ${history}: accepting another path does not hide an unaccepted replacement`, async () => {
        const f = await pausedWrite(kind, history);
        const unrelated = toLibraryPath(["books", f.book.id, "notes", "unrelated.txt"]);
        await f.commit(unrelated, encode("other outside"), { kind: "absent" });
        await f.library.acceptDrift([unrelated.join("/")]);
        await f.commit(f.path, f.outside, { kind: "sha256", value: f.intendedHash });
        await f.finish();
        expect((await f.record())?.sha256).toBe(f.intendedHash);
        expect((await f.drift())?.kind).toBe("remote-changed");
        expect((await f.port.readFile(f.path))?.bytes).toEqual(f.outside);
      });
    }
  }
});

for (const failure of ["plan-before", "plan-after", "verified-before", "verified-after"] as const) {
  test(`${failure} journal failure remains best effort without a repeated author commit`, async () => {
    const { port, library, book } = await makeBook();
    const first = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    const path = taskPath(book.id, runId, "task_00000001"), name = path.join("/");
    const journalName = syncJournalPath(library.deviceId).join("/");
    const commit = port.commitFile.bind(port);
    let notes = 0, authorCalls = 0;
    let savedHash = "";
    port.commitFile = async (target, bytes, expected) => {
      if (target.join("/") === journalName && ++notes === (failure.startsWith("plan-") ? 1 : 2)) {
        if (failure.endsWith("after")) await commit(target, bytes, expected);
        throw new Error(`Synthetic ${failure}`);
      }
      const result = await commit(target, bytes, expected);
      if (target.join("/") === name) {
        authorCalls++;
        if (result.status === "written") savedHash = result.snapshot.sha256;
      }
      return result;
    };
    const next = taskRecord(book.id, { revision: 2, base: { kind: "sha256", value: first.record.hash, revision: 1 } });
    expect((await library.workflowRecords.saveTask(book.id, runId, next)).status).toBe("saved");
    expect(authorCalls).toBe(1);
    expect(notes).toBe(2);
    const record = required((await readSyncJournal(port, library.deviceId))?.files[name]);
    expect(record.sha256).toBe(failure === "verified-before" ? first.record.hash : savedHash);
    expect(record.writtenSha256).toBe(savedHash);
    expect(Boolean(record.plannedWriteId)).toBe(failure === "verified-before");
  });
}

for (const history of ["new", "existing"] as const) {
  test(`${history}: a newer refused intent restores the predecessor's verified snapshot`, async () => {
    const f = await pausedWrite("shared", history);
    const newer = await notePlannedWrite({ storage: f.port, deviceId: f.library.deviceId, paths: [f.name],
      sha256: await f.port.sha256(encode("refused newer")), now: f.port.now() });
    await f.finish();
    await newer.settle("not-published");
    const record = required(await f.record());
    expect(record.sha256).toBe(f.intendedHash);
    expect(record.plannedWriteId).toBeUndefined();
    await f.commit(f.path, f.outside, { kind: "sha256", value: f.intendedHash });
    expect((await f.drift())?.kind).toBe("remote-changed");
    await newer.settle({ kind: "verified", size: 999, now: "ignored repeated settlement" });
    expect(await f.record()).toEqual(record);
  });
}
