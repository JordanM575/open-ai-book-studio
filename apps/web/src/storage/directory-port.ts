import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import { toLibraryPath, validateLibraryPath, type LibraryPath } from "@ai-book-studio/core/library/path";
import { devicePath } from "@ai-book-studio/core/library/paths";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryFileSnapshot,
  LibraryPort
} from "@ai-book-studio/core/library/port";

export type StorageLock = <T>(name: string, work: () => Promise<T>) => Promise<T>;

export interface DirectoryPortOptions {
  /** Cross-tab lock, when the browser has the Web Locks API. */
  lock?: StorageLock;
  /** Shown in library metadata; there is no hostname to use in a browser. */
  deviceName?: string;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * A `LibraryPort` over one browser directory handle.
 *
 * The same implementation serves a folder the author picked and the origin-private file system.
 * Permission is owned by the caller: this class reports a missing grant as `permission-required`
 * and never switches storage tiers.
 */
export class DirectoryHandleLibraryPort implements LibraryPort {
  constructor(
    private readonly root: FileSystemDirectoryHandle,
    private readonly options: DirectoryPortOptions = {}
  ) {}

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    try {
      const { handle } = await this.fileHandle(path, false);
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return {
        bytes,
        sha256: await sha256(bytes),
        createdAt: null,
        modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw toPortError(error);
    }
  }

  async listDirectory(path: LibraryPath): Promise<LibraryEntry[]> {
    try {
      const directory = await this.directory(path, false);
      const entries: LibraryEntry[] = [];
      for await (const [name, handle] of directory.entries()) {
        entries.push({ name, kind: handle.kind === "directory" ? "directory" : "file" });
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw toPortError(error);
    }
  }

  async stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    try {
      const { handle } = await this.fileHandle(path, false);
      const file = await handle.getFile();
      return {
        size: file.size,
        createdAt: null,
        modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw toPortError(error);
    }
  }

  async ensureDirectory(path: LibraryPath): Promise<void> {
    try {
      await this.directory(path, true);
    } catch (error) {
      throw toPortError(error);
    }
  }

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const name = `write:${validateLibraryPath(path).join("/")}`;
    return this.options.lock ? this.options.lock(name, () => this.commitUnlocked(path, bytes, expected)) : this.commitUnlocked(path, bytes, expected);
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    const name = `move:${validateLibraryPath(from).join("/")}`;
    const work = async (): Promise<void> => {
      const source = await this.readFile(from);
      if (!source) throw new LibraryPortError("not-found", "The library file was not found.");
      if (await this.readFile(to)) throw new LibraryPortError("already-exists", "The destination already exists.");
      const written = await this.commitFile(to, source.bytes, { kind: "absent" });
      if (written.status !== "written") throw new LibraryPortError("already-exists", "The destination already exists.");
      await this.removeFile(from);
    };
    return this.options.lock ? this.options.lock(name, work) : work();
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    const name = `move-dir:${validateLibraryPath(from).join("/")}`;
    const work = async (): Promise<void> => {
      if (!(await this.directoryOrNull(from))) {
        throw new LibraryPortError("not-found", "The library folder was not found.");
      }
      if (await this.directoryOrNull(to)) {
        throw new LibraryPortError("already-exists", "The destination already exists.");
      }
      await this.copyDirectory(from, to);
      await this.removeDirectory(from);
    };
    return this.options.lock ? this.options.lock(name, work) : work();
  }

  async removeFile(path: LibraryPath): Promise<void> {
    try {
      const { directory, name } = await this.parent(path, false);
      await directory.removeEntry(name);
    } catch (error) {
      if (isNotFound(error)) throw new LibraryPortError("not-found", "The library file was not found.");
      throw toPortError(error);
    }
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    const existing = await this.readFile(devicePath());
    if (existing) {
      try {
        const parsed = JSON.parse(textDecoder.decode(existing.bytes)) as Partial<LibraryDeviceInfo>;
        if (parsed.id && parsed.name) {
          return { id: parsed.id, name: parsed.name, createdAt: parsed.createdAt ?? new Date().toISOString() };
        }
      } catch {
        // A damaged identity file is safe to replace; it is not author content.
      }
    }

    const device: LibraryDeviceInfo = {
      id: `device_${randomId()}`,
      name: this.options.deviceName ?? "This browser",
      createdAt: new Date().toISOString()
    };
    /*
     * A file that is there but cannot be read is replaced, and one that is not there at all is
     * written only if nobody else got there first. Using `absent` for both meant a single damaged
     * `.studio/device.json` made the whole library unopenable: the write was refused because
     * *something* was present, and the read-back then parsed the damaged bytes and threw.
     */
    const result = await this.commitFile(
      devicePath(),
      textEncoder.encode(`${JSON.stringify(device, null, 2)}\n`),
      existing ? { kind: "any" } : { kind: "absent" }
    );
    if (result.status === "written") return device;

    const winner = await this.readFile(devicePath());
    if (!winner) throw new LibraryPortError("io", "The library identity could not be created.");
    try {
      return JSON.parse(textDecoder.decode(winner.bytes)) as LibraryDeviceInfo;
    } catch {
      // Two tabs both saw a damaged file and both tried to replace it. Whoever lost this race
      // reads back something unparseable; the next call will see a good file and return it.
      throw new LibraryPortError("io", "The library identity could not be written. Reload the page.", true);
    }
  }

  private async commitUnlocked(
    path: LibraryPath,
    bytes: Uint8Array,
    expected: FileExpectation
  ): Promise<CommitFileResult> {
    const current = await this.readFile(path);
    if (!matchesExpectation(expected, current)) return { status: "changed", current };

    const expectedHash = await sha256(bytes);
    let writable: FileSystemWritableFileStream | null = null;
    try {
      const { handle } = await this.fileHandle(path, true);
      writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);

      // createWritable writes to a swap file; close() is the commit point. Another tab or an
      // external writer can still change the target while the swap file is open, so re-check
      // immediately before committing rather than trusting the first read.
      if (expected.kind !== "any") {
        const latest = await this.readFile(path);
        const ownPlaceholder =
          expected.kind === "absent" && current === null && latest !== null && latest.bytes.byteLength === 0;
        if (!ownPlaceholder && !matchesExpectation(expected, latest)) {
          await abortQuietly(writable);
          writable = null;
          return { status: "changed", current: latest };
        }
      }

      await writable.close();
      writable = null;
    } catch (error) {
      if (writable) await abortQuietly(writable);
      throw toPortError(error);
    }

    const snapshot = await this.readFile(path);
    if (!snapshot) throw new LibraryPortError("io", "The file was written but could not be read back.", true);
    if (snapshot.sha256 !== expectedHash) {
      // The close succeeded, but different bytes are on disk now. Never report them as ours.
      return { status: "changed", current: snapshot };
    }
    return { status: "written", snapshot };
  }

  private async directoryOrNull(path: LibraryPath): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this.directory(path, false);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw toPortError(error);
    }
  }

  private async copyDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    await this.ensureDirectory(to);
    for (const entry of await this.listDirectory(from)) {
      const childFrom = toLibraryPath([...validateLibraryPath(from), entry.name]);
      const childTo = toLibraryPath([...validateLibraryPath(to), entry.name]);
      if (entry.kind === "directory") {
        await this.copyDirectory(childFrom, childTo);
        continue;
      }
      const snapshot = await this.readFile(childFrom);
      if (!snapshot) throw new LibraryPortError("not-found", "A library file disappeared during the move.");
      const written = await this.commitFile(childTo, snapshot.bytes, { kind: "absent" });
      if (written.status !== "written") throw new LibraryPortError("already-exists", "The destination already exists.");
    }
  }

  private async removeDirectory(path: LibraryPath): Promise<void> {
    try {
      const { directory, name } = await this.parent(path, false);
      await directory.removeEntry(name, { recursive: true });
    } catch (error) {
      if (isNotFound(error)) throw new LibraryPortError("not-found", "The library folder was not found.");
      throw toPortError(error);
    }
  }

  private async directory(path: LibraryPath, create: boolean): Promise<FileSystemDirectoryHandle> {
    let current = this.root;
    for (const segment of validateLibraryPath(path)) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  private async parent(path: LibraryPath, create: boolean): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    const segments = validateLibraryPath(path);
    const name = segments.at(-1);
    if (!name) throw new LibraryPortError("invalid-path", "A library file path cannot be the library root.");
    return { directory: await this.directory(toLibraryPath(segments.slice(0, -1)), create), name };
  }

  private async fileHandle(
    path: LibraryPath,
    create: boolean
  ): Promise<{ directory: FileSystemDirectoryHandle; name: string; handle: FileSystemFileHandle }> {
    const { directory, name } = await this.parent(path, create);
    const handle = await directory.getFileHandle(name, { create });
    return { directory, name, handle };
  }
}

/** Wrap a commit in the Web Locks API when the browser provides it. */
export function webLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return work();
  return locks.request(`ai-book-studio:${name}`, { mode: "exclusive" }, work);
}

export function webLocksAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.locks);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new LibraryPortError("unsupported", "This browser cannot verify file hashes in this context.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorName(error: unknown): string {
  return (error as { name?: string } | undefined)?.name ?? "";
}

function isNotFound(error: unknown): boolean {
  return errorName(error) === "NotFoundError";
}

function matchesExpectation(expected: FileExpectation, current: LibraryFileSnapshot | null): boolean {
  if (expected.kind === "any") return true;
  if (expected.kind === "absent") return current === null;
  return current?.sha256 === expected.value;
}

async function abortQuietly(writable: FileSystemWritableFileStream): Promise<void> {
  if (typeof writable.abort !== "function") return;
  try {
    await writable.abort();
  } catch {
    // The original failure is the one worth reporting.
  }
}

function toPortError(error: unknown): LibraryPortError {
  if (error instanceof LibraryPortError) return error;
  const message = (error as Error | undefined)?.message ?? "The browser storage operation failed.";
  switch (errorName(error)) {
    case "NotFoundError":
      return new LibraryPortError("not-found", "The library file was not found.");
    case "NotAllowedError":
    case "SecurityError":
      return new LibraryPortError("permission-required", "The browser needs permission to use this folder again.", true);
    case "QuotaExceededError":
      return new LibraryPortError("storage-full", "This browser's storage is full. Nothing was replaced.", true);
    case "NoModificationAllowedError":
      return new LibraryPortError("read-only", "The folder is read-only. Nothing was replaced.");
    case "TypeMismatchError":
    case "InvalidModificationError":
      return new LibraryPortError("io", "The folder does not have the expected file layout.");
    default:
      return new LibraryPortError("io", message, true);
  }
}
