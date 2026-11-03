/// <reference types="bun" />
import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createHash } from "node:crypto";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryFileSnapshot,
  LibraryPath,
  LibraryPort
} from "@ai-book-studio/core/library/port";

/**
 * Exporting the library from a browser.
 *
 * There are two ways out of a browser tab and they fail differently. Where the File System Access
 * API exists the archive streams into the file the author picked, and a failed write has to be
 * aborted rather than left half-written. Where it does not — Safari, Firefox, a page that is not a
 * secure context — the bytes go into a Blob and the browser's download UI takes over, which costs
 * memory proportional to the archive.
 */

const registered = typeof document === "undefined";
if (registered) GlobalRegistrator.register({ url: "http://localhost" });
const { exportBrowserArchive, saveFilePickerAvailable } = await import("../../src/storage/archive-io");

afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const encoder = new TextEncoder();

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A library port with the files already in it, enough for the exporter to walk. */
class Files extends Map<string, Uint8Array> implements LibraryPort {
  constructor(files: Record<string, string>) {
    super(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
  }

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    const bytes = this.get(path.join("/"));
    return bytes ? { bytes: bytes.slice(), sha256: hash(bytes), createdAt: null, modifiedAt: null } : null;
  }

  /** One level at a time, the way a real directory port answers. */
  async listDirectory(directory: LibraryPath): Promise<LibraryEntry[]> {
    const prefix = directory.length > 0 ? `${directory.join("/")}/` : "";
    const seen = new Map<string, LibraryEntry>();
    for (const key of this.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) seen.set(rest, { name: rest, kind: "file" });
      else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), kind: "directory" });
    }
    return [...seen.values()];
  }

  async stat(): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    return null;
  }

  async ensureDirectory(): Promise<void> {}

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const key = path.join("/");
    const current = this.get(key);
    const matches =
      expected.kind === "any"
        ? true
        : expected.kind === "absent"
          ? current === undefined
          : current !== undefined && hash(current) === expected.value;
    if (!matches) return { status: "changed", current: null };
    const copy = bytes.slice();
    this.set(key, copy);
    return {
      status: "written",
      snapshot: { bytes: copy.slice(), sha256: hash(copy), createdAt: null, modifiedAt: null }
    };
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    const bytes = this.get(from.join("/"));
    if (!bytes) throw new Error("not found");
    this.set(to.join("/"), bytes);
    this.delete(from.join("/"));
  }

  async moveDirectory(): Promise<void> {}

  async removeFile(path: LibraryPath): Promise<void> {
    this.delete(path.join("/"));
  }

  async removeDirectory(path: LibraryPath): Promise<void> {
    const prefix = `${path.join("/")}/`;
    for (const key of [...this.keys()]) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    return { id: "device_test", name: "Test", createdAt: "2026-10-25T00:00:00.000Z" };
  }
}

const env = {
  storage: new Files({
    "books/book_a/book.json": '{"id":"book_a","title":"The Salt Road","schemaVersion":1}',
    "books/book_a/chapters/0001-one.md": "---\nid: ch_one000001\ntitle: One\n---\n\nThe storm came in low.\n"
  }),
  runtime: {
    now: () => "2026-10-25T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_00000001`,
    sha256: async (bytes: Uint8Array) => hash(bytes)
  }
} as never;

/** Collect what the download fallback did, and put the DOM back afterwards. */
function watchDownloads() {
  const made: string[] = [];
  const clicked: string[] = [];
  const revoked: string[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;

  URL.createObjectURL = (blob: Blob | MediaSource) => {
    // happy-dom keeps the blob, so its size is a real measure of what would have downloaded.
    made.push(String((blob as Blob).size));
    return "blob:test";
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  };
  return {
    made,
    clicked,
    revoked,
    restore() {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
    }
  };
}

describe("where the browser offers a save picker", () => {
  test("says whether it is available at all", () => {
    // happy-dom is a secure context at http://localhost and has no picker, which is honest.
    expect(typeof saveFilePickerAvailable()).toBe("boolean");
  });

  test("streams the archive into the file the author chose", async () => {
    const chunks: Uint8Array[] = [];
    let closed = false;
    const handle = {
      name: "the-salt-road.zip",
      async createWritable() {
        return {
          async write(chunk: unknown) {
            chunks.push(chunk as Uint8Array);
          },
          async close() {
            closed = true;
          },
          async abort() {}
        };
      }
    };
    const pickerWindow = window as unknown as { showSaveFilePicker?: unknown };
    const real = pickerWindow.showSaveFilePicker;
    const asked: Array<{ suggestedName?: string }> = [];
    pickerWindow.showSaveFilePicker = async (options: { suggestedName?: string }) => {
      asked.push(options);
      return handle;
    };
    const secure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
    Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });

    try {
      const result = await exportBrowserArchive(env, { appVersion: "0.1.0", fileName: "the-salt-road.zip" });
      expect(result.method).toBe("picker");
      expect(result.fileName).toBe("the-salt-road.zip");
      expect(result.manifest.entryCount).toBeGreaterThan(0);
      expect(asked[0]?.suggestedName).toBe("the-salt-road.zip");
      // The whole archive arrives as one or more chunks, and the file is closed rather than left open.
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeGreaterThan(100);
      expect(closed).toBe(true);
    } finally {
      pickerWindow.showSaveFilePicker = real;
      if (secure) Object.defineProperty(globalThis, "isSecureContext", secure);
      else Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
    }
  });

  test("aborts a half-written file rather than leaving it broken", async () => {
    let aborted = false;
    const handle = {
      name: "broken.zip",
      async createWritable() {
        return {
          async write() {
            throw new Error("the disk filled up");
          },
          async close() {},
          async abort() {
            aborted = true;
          }
        };
      }
    };
    const pickerWindow = window as unknown as { showSaveFilePicker?: unknown };
    const real = pickerWindow.showSaveFilePicker;
    pickerWindow.showSaveFilePicker = async () => handle;
    const secure = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
    Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });

    try {
      await expect(exportBrowserArchive(env, { appVersion: "0.1.0" })).rejects.toThrow("the disk filled up");
      expect(aborted).toBe(true);
    } finally {
      pickerWindow.showSaveFilePicker = real;
      if (secure) Object.defineProperty(globalThis, "isSecureContext", secure);
      else Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
    }
  });
});

describe("where the browser has no picker", () => {
  test("falls back to a download, and names the file", async () => {
    const watch = watchDownloads();
    try {
      const result = await exportBrowserArchive(env, { appVersion: "0.1.0" });
      expect(result.method).toBe("download");
      // No file name was given, so the date is used rather than an empty suggestion.
      expect(result.fileName).toMatch(/^ai-book-studio-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(watch.clicked).toEqual([result.fileName]);
      // The bytes really were assembled: a zip of one book is more than a few dozen bytes.
      expect(Number(watch.made[0])).toBeGreaterThan(100);
    } finally {
      watch.restore();
    }
  });

  test("revokes the object URL after the download has had time to start", async () => {
    const watch = watchDownloads();
    const realSetTimeout = globalThis.setTimeout;
    // Captured in an array rather than a variable, so the assertion reads what the code scheduled
    // rather than what TypeScript narrowed at the call site.
    const scheduled: Array<() => void> = [];
    let delay = 0;
    globalThis.setTimeout = ((callback: () => void, ms?: number) => {
      scheduled.push(callback);
      delay = ms ?? 0;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      await exportBrowserArchive(env, { appVersion: "0.1.0", fileName: "mine.zip" });
      // A revoked-too-early URL is a download that cancels itself.
      expect(delay).toBeGreaterThanOrEqual(1000);
      for (const later of scheduled) later();
      expect(watch.revoked).toEqual(["blob:test"]);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      watch.restore();
    }
  });
});
