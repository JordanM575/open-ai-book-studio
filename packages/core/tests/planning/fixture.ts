import { LibraryService } from "../../src/library/service";
import type { CommitFileResult, FileExpectation, LibraryPath } from "../../src/library/port";
import { bookFilePath } from "../../src/library/paths";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { PlanningService } from "../../src/planning/service";
import { GoalService, type GoalHost } from "../../src/organization/goals";
import { encoder, decoder, type Planning } from "../../src/planning/schema";
import { sidecarPath, type SidecarRead } from "../../src/planning/checked-sidecar";

export const fields = { name: "Salt road", category: "Place", description: "  Literal\r\n界 😀  ", notes: "e\u0301\n\n" };
export const envelope = <T>(read: SidecarRead<T>) => ({ bookId: read.bookId, source: read.source, baselineJson: read.baselineJson });

export async function fixture() {
  const port = new InMemoryLibraryPort();
  const library = await LibraryService.open({ storage: port, runtime: port });
  const book = await library.createBook({ title: "Synthetic W08" });
  const other = await library.createBook({ title: "Other synthetic W08" });
  const commits: Array<{ path: string; expected: FileExpectation; bytes: Uint8Array }> = [];
  const layouts: string[] = [];
  let queued: Promise<unknown> = Promise.resolve();
  let inQueue = false;
  const host: GoalHost = {
    storage: {
      readFile: (path) => port.readFile(path),
      stat: (path) => port.stat(path),
      ensureDirectory: async (path) => { layouts.push(path.join("/")); await port.ensureDirectory(path); }
    },
    runtime: port,
    deviceId: "device_synthetic",
    withBook: <T>(_bookId: string, work: () => Promise<T>): Promise<T> => {
      const next = queued.then(async () => {
        inQueue = true;
        try { return await work(); } finally { inQueue = false; }
      });
      queued = next.catch(() => {});
      return next;
    },
    commitFile: async (path, bytes, expected) => {
      if (!inQueue) throw new Error("A leaf escaped the host queue.");
      commits.push({ path: path.join("/"), expected, bytes: bytes.slice() });
      return port.commitFile(path, bytes, expected);
    },
    readSavedBook: (id) => library.readBook(id)
  };
  const planning = new PlanningService(host);
  const goals = new GoalService(host);
  const writeRaw = async (path: LibraryPath, value: unknown) => {
    await port.commitFile(path, encoder.encode(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`), { kind: "any" });
  };
  const activePath = sidecarPath(book.id, "planning");
  const goalPath = sidecarPath(book.id, "goals");
  const seedPlanning = async () => {
    const read = await planning.read(book.id);
    await planning.save({ ...envelope(read), draft: { kind: "create-worldbuilding", fields } });
    return planning.read(book.id);
  };
  const edit = (read: SidecarRead<Planning>, patch = {}) => ({
    ...envelope(read),
    draft: { kind: "edit-worldbuilding", id: read.data?.worldbuilding[0]?.id, fields: { ...fields, ...patch } }
  });
  const raw = async (path: LibraryPath) => decoder.decode((await port.readFile(path))?.bytes);
  const mutateBook = async (patch: object) => {
    await writeRaw(bookFilePath(book.id), { ...JSON.parse(await raw(bookFilePath(book.id))), ...patch });
  };
  const intercept = (fn: (path: LibraryPath, bytes: Uint8Array, expected: FileExpectation, original: () => Promise<CommitFileResult>) => Promise<CommitFileResult>) => {
    const original = host.commitFile;
    host.commitFile = (path, bytes, expected) => fn(path, bytes, expected, () => original(path, bytes, expected));
  };
  return { port, library, book, other, host, planning, goals, commits, layouts, writeRaw, raw, activePath, goalPath, seedPlanning, edit, mutateBook, intercept };
}
