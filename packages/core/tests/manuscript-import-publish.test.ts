import { describe, expect, test } from "bun:test";
import { LibraryService } from "../src/library/service";
import { LibraryError, LibraryPortError } from "../src/library/errors";
import { toLibraryPath } from "../src/library/path";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryEntry,
  LibraryFileSnapshot,
  LibraryPath,
  LibraryPort
} from "../src/library/port";
import { InMemoryLibraryPort } from "./support/in-memory-port";

/**
 * The staged complete-book publication an importer can rely on (spec 029 T009).
 *
 * A manuscript is written under a unique unpublished staging path, read back file
 * by file, and published with one directory move — never as sequential visible
 * `createBook`/`createChapter` calls. Every failure below leaves no visible book.
 */

interface Faults {
  /** Throw from the nth commitFile call onward (1-based), or never when absent. */
  failCommitFileFrom?: { count: number; error: Error };
  failMoveDirectory?: Error;
  failRemoveDirectory?: Error;
  /** Return a valid book record with the wrong title on read-back. */
  corruptBookJson?: boolean;
}

/** A recording decorator over the in-memory port. The first failure flag wins. */
class FaultPort implements LibraryPort {
  readonly mutatingCalls: string[] = [];
  private commits = 0;

  constructor(
    private readonly inner: InMemoryLibraryPort,
    private readonly faults: Faults = {}
  ) {}

  private pathString(path: LibraryPath): string {
    return [...path].join("/");
  }

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    const snapshot = await this.inner.readFile(path);
    if (this.faults.corruptBookJson && snapshot && this.pathString(path).endsWith("/book.json")) {
      const tampered = { ...JSON.parse(new TextDecoder().decode(snapshot.bytes)), title: "Someone else" };
      return { ...snapshot, bytes: new TextEncoder().encode(`${JSON.stringify(tampered, null, 2)}\n`) };
    }
    return snapshot;
  }

  async listDirectory(path: LibraryPath): Promise<LibraryEntry[]> {
    return this.inner.listDirectory(path);
  }

  async stat(path: LibraryPath) {
    return this.inner.stat(path);
  }

  async ensureDirectory(path: LibraryPath): Promise<void> {
    return this.inner.ensureDirectory(path);
  }

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    this.commits += 1;
    this.mutatingCalls.push(`commitFile ${this.pathString(path)}`);
    const fault = this.faults.failCommitFileFrom;
    if (fault && this.commits >= fault.count) throw fault.error;
    return this.inner.commitFile(path, bytes, expected);
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    return this.inner.moveFile(from, to);
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    this.mutatingCalls.push(`moveDirectory ${this.pathString(from)} -> ${this.pathString(to)}`);
    if (this.faults.failMoveDirectory) throw this.faults.failMoveDirectory;
    return this.inner.moveDirectory(from, to);
  }

  async removeFile(path: LibraryPath): Promise<void> {
    return this.inner.removeFile(path);
  }

  async removeDirectory(path: LibraryPath): Promise<void> {
    this.mutatingCalls.push(`removeDirectory ${this.pathString(path)}`);
    if (this.faults.failRemoveDirectory) throw this.faults.failRemoveDirectory;
    return this.inner.removeDirectory(path);
  }

  watch(path: LibraryPath, onChange: (changedPath: LibraryPath) => void): () => void {
    return this.inner.watch(path, onChange);
  }

  async deviceInfo() {
    return this.inner.deviceInfo();
  }
}

const DRAFTS = [
  { title: "Beginnings", content: "One.\nTwo.\n" },
  { title: "The Crossing", content: "Three.\nFour.\n\nFive.\n" }
];

async function openLibrary(faults: Faults = {}) {
  const inner = new InMemoryLibraryPort();
  const port = new FaultPort(inner, faults);
  const service = await LibraryService.open({ storage: port, runtime: inner });
  return { inner, port, service };
}

async function stagingIsGone(port: FaultPort): Promise<boolean> {
  const entries = await port.listDirectory(toLibraryPath([".studio", "staging"]));
  return entries.length === 0;
}

describe("importManuscript", () => {
  test("publishes exactly one complete book with the confirmed mapping", async () => {
    const { port, service } = await openLibrary();
    const detail = await service.importManuscript({ bookTitle: "The Long Road", chapters: DRAFTS });

    expect(detail.book.title).toBe("The Long Road");
    expect(detail.book.description).toBe("");
    expect(detail.chapters.map((chapter) => [chapter.order, chapter.title, chapter.content])).toEqual([
      [1, "Beginnings", "One.\nTwo.\n"],
      [2, "The Crossing", "Three.\nFour.\n\nFive.\n"]
    ]);
    const reread = await service.readBook(detail.book.id);
    expect(reread.chapters.map((chapter) => chapter.content)).toEqual(
      detail.chapters.map((chapter) => chapter.content)
    );
    expect((await service.listBooks()).map((book) => book.id)).toEqual([detail.book.id]);
    expect(await stagingIsGone(port)).toBe(true);

    // Nothing was written under books/ before the single publishing move.
    const moveIndex = port.mutatingCalls.findIndex((call) => call.startsWith("moveDirectory "));
    expect(moveIndex).toBeGreaterThan(-1);
    expect(port.mutatingCalls.filter((call) => call.startsWith("moveDirectory "))).toHaveLength(1);
    // Every book write happens under unpublished staging; the only catalog write
    // before the move is the library's own opening catalog, not the import.
    for (const call of port.mutatingCalls.slice(0, moveIndex)) {
      if (!call.startsWith("commitFile ")) continue;
      const target = call.slice("commitFile ".length);
      expect(target === "library.json" || target.startsWith(".studio/staging/")).toBe(true);
    }
    expect(
      port.mutatingCalls.slice(0, moveIndex).some((call) => call.includes("/books/"))
    ).toBe(false);
  });

  test("a chapter write failure leaves no visible book and removes staging", async () => {
    const { port, service } = await openLibrary({
      failCommitFileFrom: { count: 2, error: new LibraryPortError("io", "The disk gave up.") }
    });
    const error = await service.importManuscript({ bookTitle: "Road", chapters: DRAFTS }).catch((cause) => cause);
    expect(error).toBeInstanceOf(LibraryPortError);
    expect((error as LibraryPortError).message).toContain("gave up");
    expect(await service.listBooks()).toEqual([]);
    expect(await stagingIsGone(port)).toBe(true);
  });

  test("a read-back mismatch fails the import and removes staging", async () => {
    const { port, service } = await openLibrary({ corruptBookJson: true });
    const error = await service.importManuscript({ bookTitle: "Road", chapters: DRAFTS }).catch((cause) => cause);
    expect(error).toBeInstanceOf(LibraryError);
    expect((error as LibraryError).code).toBe("io");
    expect((error as LibraryError).message).toContain("did not read back");
    expect(await service.listBooks()).toEqual([]);
    expect(await stagingIsGone(port)).toBe(true);
  });

  test("a publish failure keeps its code, leaves no visible book and removes staging", async () => {
    const { port, service } = await openLibrary({
      failMoveDirectory: new LibraryPortError("unsupported", "Cross-device staging moves are refused.")
    });
    const error = await service.importManuscript({ bookTitle: "Road", chapters: DRAFTS }).catch((cause) => cause);
    expect(error).toBeInstanceOf(LibraryPortError);
    expect((error as LibraryPortError).code).toBe("unsupported");
    expect(await service.listBooks()).toEqual([]);
    expect(await service.readBook("book_00000001").catch((cause) => cause)).toBeInstanceOf(LibraryError);
    expect(await stagingIsGone(port)).toBe(true);
  });

  test("a cleanup failure names the staging that remains and publishes nothing", async () => {
    const { port, service } = await openLibrary({
      failCommitFileFrom: { count: 2, error: new LibraryPortError("io", "The disk gave up.") },
      failRemoveDirectory: new LibraryPortError("io", "Cleanup is stuck.")
    });
    const error = await service.importManuscript({ bookTitle: "Road", chapters: DRAFTS }).catch((cause) => cause);
    expect(error).toBeInstanceOf(LibraryError);
    expect((error as LibraryError).code).toBe("io");
    expect((error as LibraryError).message).toContain("gave up");
    expect((error as LibraryError).message).toContain(".studio/staging/");
    expect(await service.listBooks()).toEqual([]);
  });

  test("an empty import is refused before any write", async () => {
    const { port, service } = await openLibrary();
    const error = await service.importManuscript({ bookTitle: "Road", chapters: [] }).catch((cause) => cause);
    expect(error).toBeInstanceOf(LibraryError);
    expect((error as LibraryError).code).toBe("format");
    // Opening the library commits its own catalog; the refused import writes nothing of its own.
    expect(
      port.mutatingCalls.filter(
        (call) => call.includes(".studio/staging/") || call.includes("books/")
      )
    ).toEqual([]);
  });
});
