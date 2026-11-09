import { expect, test } from "bun:test";
import { toLibraryPath } from "../src/library/path";
import { syncJournalPath } from "../src/library/paths";
import { LibraryService } from "../src/library/service";
import { noteMovedPrefix, readSyncJournal } from "../src/sync/journal";
import { taskPath } from "../src/workflow/paths";
import { makeBook, runId, taskRecord } from "./workflow/record-fixtures";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

type History = "new" | "live" | "deleted";
type Retirement = "remove" | "move" | "accept";
type JournalFailure = "none" | "before" | "after";

async function retiredWrite(history: History, retirement: Retirement, equal: boolean,
  newestFirst: boolean, failure: JournalFailure = "none") {
  const { port, library, book } = await makeBook();
  const other = await LibraryService.open({ storage: port, runtime: port });
  const path = taskPath(book.id, runId, "task_00000001");
  const name = path.join("/");
  const destination = toLibraryPath([".studio", "trash", book.id, "retired-task.json"]);
  const commit = port.commitFile.bind(port);
  let candidate = taskRecord(book.id, { synthetic: "published before retirement" });
  if (history !== "new") {
    const initial = await library.workflowRecords.saveTask(book.id, runId, taskRecord(book.id));
    if (history === "live") candidate = taskRecord(book.id, {
      revision: 2, base: { kind: "sha256", value: initial.record.hash, revision: 1 },
      synthetic: "published before retirement"
    });
    else {
      await port.removeFile(path);
      await library.noteOwnFiles({ removed: [name] });
    }
  }
  const record = async () => (await readSyncJournal(port, library.deviceId))?.files[name];
  const published = gate(), returnPublished = gate(), attempting = gate(), refuse = gate();
  let attempts = 0;
  let original = new Uint8Array();
  let hash = "";
  let duringRetirement = false;
  let journalFailures = 0;
  const journalName = syncJournalPath(library.deviceId).join("/");
  port.commitFile = async (target, bytes, expected) => {
    if (duringRetirement && target.join("/") === journalName && failure !== "none") {
      journalFailures++;
      if (failure === "after") await commit(target, bytes, expected);
      throw new Error("Synthetic retirement journal failure");
    }
    if (target.join("/") !== name) return commit(target, bytes, expected);
    attempts++;
    if (attempts === 1) {
      const result = await commit(target, bytes, expected);
      if (result.status !== "written") throw new Error("Synthetic initial publication failed");
      original = result.snapshot.bytes.slice();
      hash = result.snapshot.sha256;
      published.release();
      await returnPublished.promise;
      return result;
    }
    if (attempts !== 2) throw new Error("Unexpected author-file retry");
    attempting.release();
    await refuse.promise;
    return commit(target, bytes, expected);
  };
  const first = library.workflowRecords.saveTask(book.id, runId, candidate);
  await published.promise;
  const second = other.writeHost.withBook(book.id, () => other.writeHost.commitFile(path,
    equal ? original : new TextEncoder().encode("different pending content"), { kind: "sha256", value: hash }));
  await attempting.promise;
  const beforeRetirement = await record();
  if (retirement === "move") await port.moveFile(path, destination);
  else await port.removeFile(path);
  duringRetirement = true;
  if (retirement === "move") await noteMovedPrefix({ storage: port, deviceId: library.deviceId,
    from: name, to: destination.join("/"), now: port.now() });
  else if (retirement === "accept") await library.acceptDrift([name]);
  else await library.noteOwnFiles({ removed: [name] });
  duringRetirement = false;
  const retired = await record();
  if (failure !== "none") expect(journalFailures).toBe(1);
  if (failure === "before") expect(retired).toEqual(beforeRetirement);
  if (history === "deleted" && retirement !== "accept") expect(retired).toEqual(beforeRetirement);
  if (newestFirst) {
    refuse.release();
    expect(await second).toMatchObject({ status: "changed", current: null });
    returnPublished.release();
    expect((await first).status).toBe("saved");
  } else {
    returnPublished.release();
    expect((await first).status).toBe("saved");
    refuse.release();
    expect(await second).toMatchObject({ status: "changed", current: null });
  }
  expect(attempts).toBe(2);
  expect(await record()).toEqual(retired);
  expect(await port.readFile(path)).toBeNull();
  if (retirement === "move") expect((await port.readFile(destination))?.bytes).toEqual(original);
  expect((await commit(path, original, { kind: "absent" })).status).toBe("written");
  const drift = await library.checkDrift();
  if (history === "new") {
    expect(drift.entries.find((entry) => entry.path === name)?.kind).toBe("new-remote");
    expect(drift.clean).toBe(false);
  } else if (failure !== "before" || history === "deleted") {
    expect(retired?.deleted).toBe(true);
    expect(drift.entries.find((entry) => entry.path === name)?.kind).toBe("local-deleted");
    expect(drift.clean).toBe(false);
  }
  // Failed retirement persistence can retain the earlier intent; that is not a successful update.
  expect((await port.readFile(path))?.bytes).toEqual(original);
}

for (const history of ["new", "live", "deleted"] as const) {
  for (const retirement of ["remove", "move"] as const) {
    for (const equal of [false, true]) {
      for (const newestFirst of [false, true]) {
        test(`${history} ${retirement} retires equal=${equal}, newest-first=${newestFirst} writes`, () =>
          retiredWrite(history, retirement, equal, newestFirst));
      }
    }
  }
}

for (const newestFirst of [false, true]) {
  test(`accepting an absent tombstone retires its pending chain, newest-first=${newestFirst}`, () =>
    retiredWrite("deleted", "accept", true, newestFirst));
  for (const history of ["live", "deleted"] as const) {
    for (const failure of ["before", "after"] as const) {
      test(`${history} move journal failure ${failure} publication, newest-first=${newestFirst}`, () =>
        retiredWrite(history, "move", true, newestFirst, failure));
    }
  }
}
