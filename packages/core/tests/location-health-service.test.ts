import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { syncJournalPath } from "../src/library/paths";
import { toLibraryPath, type LibraryPath } from "../src/library/path";
import type { LibraryPort } from "../src/library/port";
import { scanLibrary } from "../src/sync/scan";
import { SYNC_SCHEMA_VERSION } from "../src/sync/types";
import { InMemoryLibraryPort } from "./support/in-memory-port";

const encoder = new TextEncoder();

class FlakyChapterPort extends InMemoryLibraryPort {
  failChapterReads = false;

  override async readFile(target: LibraryPath) {
    const path = target.join("/");
    if (this.failChapterReads && path.includes("/chapters/") && path.endsWith(".md")) {
      throw new Error("EACCES: permission denied");
    }
    return super.readFile(target);
  }
}

async function openService(port: FlakyChapterPort | InMemoryLibraryPort = new InMemoryLibraryPort()) {
  return LibraryService.open({ storage: port, runtime: port });
}

async function conflictCopy(port: LibraryPort, bookId: string): Promise<string> {
  const path = `books/${bookId}/conflicts/0001-clash.md`;
  await port.commitFile(toLibraryPath(path.split("/")), encoder.encode("Clashing text.\n"), {
    kind: "any"
  });
  return path;
}

describe("LibraryService.locationHealth", () => {
  test("a new library with one book is ready", async () => {
    const service = await openService();
    await service.createBook({ title: "The Salt Road" });

    const health = await service.locationHealth();

    expect(health).toMatchObject({ state: "ready", count: 0, severity: "info" });
    expect(health.action.safe).toBe(true);
  });

  test("an unreviewed conflict copy is reported once", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    await conflictCopy(port, book.id);

    const health = await service.locationHealth();

    expect(health).toMatchObject({ state: "conflicts", count: 1 });
    expect(health.message).toContain("1 conflict copy needs");
  });

  test("a journal-reviewed conflict copy is not reported again", async () => {
    const port = new InMemoryLibraryPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    const path = await conflictCopy(port, book.id);
    const { files } = await scanLibrary(port);
    const observed = files.find((file) => file.path === path);
    await port.commitFile(
      syncJournalPath(service.deviceId),
      encoder.encode(
        JSON.stringify({
          schemaVersion: SYNC_SCHEMA_VERSION,
          deviceId: service.deviceId,
          generation: 1,
          scannedAt: "2026-11-03T00:00:00.000Z",
          files: observed?.sha256 ? { [path]: { sha256: observed.sha256, observedAt: "2026-11-03T00:00:00.000Z" } } : {}
        })
      ),
      { kind: "any" }
    );

    const health = await service.locationHealth();

    expect(health).toMatchObject({ state: "ready", count: 0 });
  });

  test("an unreadable chapter needs permission", async () => {
    const port = new FlakyChapterPort();
    const service = await openService(port);
    const book = await service.createBook({ title: "The Salt Road" });
    await service.createChapter(book.id, { title: "The Door", content: "Salt on the floor.\n" });
    port.failChapterReads = true;

    const health = await service.locationHealth();

    expect(health).toMatchObject({ state: "permission-needed" });
    expect(health.action.safe).toBe(true);
  });
});
