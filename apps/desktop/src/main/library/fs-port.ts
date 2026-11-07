import { createHash, randomUUID } from "node:crypto";
import { lstatSync, watch as watchFiles, type Stats } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, sep } from "node:path";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import { devicePath } from "@ai-book-studio/core/library/paths";
import { toLibraryPath, type LibraryPath } from "@ai-book-studio/core/library/path";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryInspectedEntry,
  LibraryEnvironment,
  LibraryFileSnapshot,
  LibraryPort
} from "@ai-book-studio/core/library/port";
import { writeFileAtomic } from "./atomic";
import { noteOwnFile, noteOwnRemoval } from "./own-writes";
import { isoNow, safeJoin } from "./paths";

/**
 * The reference storage adapter: Electron's main process, over an ordinary folder.
 *
 * It owns atomic replacement and device identity; the shared service owns every promise about
 * the book format. The renderer never sees this class or a host path.
 *
 * The selected root may use platform aliases (or itself be a symlink). Below that boundary,
 * existing symlinks and special files are unsupported, just as in archive enumeration. These
 * pathname checks do not prevent hostile concurrent path swaps or provide OS-level CAS.
 */
export class FileSystemLibraryPort implements LibraryPort {
  constructor(readonly root: string) {}

  private absolute(path: LibraryPath): string {
    return safeJoin(this.root, ...toLibraryPath(path));
  }

  private descendants(path: LibraryPath): string[] {
    const segments = toLibraryPath(path);
    return segments.map((_, index) => safeJoin(this.root, ...segments.slice(0, index + 1)));
  }

  private async checkedAbsolute(path: LibraryPath): Promise<string> {
    const descendants = this.descendants(path);
    for (const [index, absolute] of descendants.entries()) {
      try {
        assertSupportedEntry(await lstat(absolute), index < descendants.length - 1);
      } catch (error) {
        // lstat sees broken links themselves; only a truly missing suffix is allowed.
        if (errorCode(error) === "ENOENT") break;
        throw toPortError(error);
      }
    }
    return this.absolute(path);
  }

  /** Watch registration is synchronous; use the same policy before arming it. */
  private checkedAbsoluteSync(path: LibraryPath): string {
    const descendants = this.descendants(path);
    for (const [index, absolute] of descendants.entries()) {
      try {
        assertSupportedEntry(lstatSync(absolute), index < descendants.length - 1);
      } catch (error) {
        if (errorCode(error) === "ENOENT") break;
        throw toPortError(error);
      }
    }
    return this.absolute(path);
  }

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    const absolute = await this.checkedAbsolute(path);
    try {
      const [bytes, info] = await Promise.all([readFile(absolute), stat(absolute)]);
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        createdAt: dateOrNull(info.birthtime),
        modifiedAt: dateOrNull(info.mtime)
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw toPortError(error);
    }
  }

  async listDirectory(path: LibraryPath): Promise<LibraryEntry[]> {
    return (await this.inspectDirectory(path)).filter((entry): entry is LibraryEntry => entry.kind !== "unsupported");
  }

  async inspectDirectory(path: LibraryPath): Promise<LibraryInspectedEntry[]> {
    const absolute = await this.checkedAbsolute(path);
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      const result: LibraryInspectedEntry[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) result.push({ name: entry.name, kind: "directory" });
        else if (entry.isFile()) result.push({ name: entry.name, kind: "file" });
        else result.push({ name: entry.name, kind: "unsupported" });
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw toPortError(error);
    }
  }

  async stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    try {
      const info = await stat(await this.checkedAbsolute(path));
      if (!info.isFile()) return null;
      return { size: info.size, createdAt: dateOrNull(info.birthtime), modifiedAt: dateOrNull(info.mtime) };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw toPortError(error);
    }
  }

  async ensureDirectory(path: LibraryPath): Promise<void> {
    try {
      await mkdir(await this.checkedAbsolute(path), { recursive: true });
    } catch (error) {
      throw toPortError(error);
    }
  }

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const current = await this.readFile(path);
    const matches =
      expected.kind === "any"
        ? true
        : expected.kind === "absent"
          ? current === null
          : current?.sha256 === expected.value;

    if (!matches) return { status: "changed", current };

    const absolute = await this.checkedAbsolute(path);
    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFileAtomic(absolute, bytes);
    } catch (error) {
      throw toPortError(error);
    }

    const snapshot = await this.readFile(path);
    if (!snapshot) {
      throw new LibraryPortError("io", "The file was written but could not be read back.", true);
    }
    return { status: "written", snapshot };
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    const source = await this.checkedAbsolute(from);
    const destination = await this.checkedAbsolute(to);
    if (await this.readFile(to)) {
      throw new LibraryPortError("already-exists", "The destination already exists.");
    }
    const moving = await this.readFile(from);
    try {
      await mkdir(dirname(destination), { recursive: true });
      await renameAcrossDevices(source, destination);
    } catch (error) {
      throw toPortError(error);
    }
    if (moving) noteOwnFile(destination, moving.sha256);
    noteOwnRemoval(source);
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    const source = await this.checkedAbsolute(from);
    const destination = await this.checkedAbsolute(to);
    try {
      await stat(destination);
      throw new LibraryPortError("already-exists", "The destination already exists.");
    } catch (error) {
      if (error instanceof LibraryPortError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw toPortError(error);
    }
    try {
      await mkdir(dirname(destination), { recursive: true });
      await rename(source, destination);
    } catch (error) {
      // A directory copy cannot publish atomically, so a cross-device staging move is
      // refused instead of falling back to copying file by file.
      if (errorCode(error) === "EXDEV") {
        throw new LibraryPortError(
          "unsupported",
          "The staged book and its destination must live on the same volume."
        );
      }
      throw toPortError(error);
    }
    // Linux reports the new files under their destination paths after a directory rename. Keep
    // those events from looking like an outside writer by recording each file's bytes as our own.
    try {
      await this.noteOwnFiles(to);
    } catch {
      // The move has already landed; failed bookkeeping must not report the successful move as a
      // failed delete. Unreadable paths remain visible to the watcher as outside changes.
    }
    // Noted only once it happened: a failed move must not cover a later outside deletion in the folder.
    noteOwnRemoval(source, true);
  }

  async removeDirectory(path: LibraryPath): Promise<void> {
    const absolute = await this.checkedAbsolute(path);
    try {
      await rm(absolute, { recursive: true, force: false });
    } catch (error) {
      throw toPortError(error);
    }
    noteOwnRemoval(absolute, true);
  }

  async removeFile(path: LibraryPath): Promise<void> {
    const absolute = await this.checkedAbsolute(path);
    try {
      await unlink(absolute);
    } catch (error) {
      throw toPortError(error);
    }
    noteOwnRemoval(absolute);
  }

  /** Advisory: the caller still checks versions and hashes before every write. */
  watch(path: LibraryPath, onChange: (changedPath: LibraryPath) => void): () => void {
    const absolute = this.checkedAbsoluteSync(path);
    let watcher: ReturnType<typeof watchFiles>;
    try {
      watcher = watchFiles(absolute, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const segments = String(filename).split(sep).filter((segment) => segment.length > 0);
        if (segments.length === 0) return;
        try {
          // `filename` is relative to the watched directory; the port reports library-relative paths.
          const changed = toLibraryPath([...path, ...segments]);
          this.checkedAbsoluteSync(changed);
          onChange(changed);
        } catch {
          // Unsupported/unreadable paths are not book files. Missing paths still notify deletions.
        }
      });
    } catch {
      // Some filesystems do not support recursive watch. The save-time checks remain the guard.
      return () => {};
    }
    return () => watcher.close();
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    // Filesystem failures must not be mistaken for a damaged or absent identity.
    const snapshot = await this.readFile(devicePath());
    try {
      const parsed = JSON.parse(new TextDecoder().decode(snapshot?.bytes)) as Partial<LibraryDeviceInfo>;
      if (parsed.id && parsed.name) {
        return { id: parsed.id, name: parsed.name, createdAt: parsed.createdAt ?? isoNow() };
      }
    } catch {
      // First run in this library, or a damaged identity file that is safe to replace.
    }
    const device: LibraryDeviceInfo = {
      id: `device_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      name: hostname(),
      createdAt: isoNow()
    };
    await this.commitFile(devicePath(), new TextEncoder().encode(`${JSON.stringify(device, null, 2)}\n`), {
      kind: "any"
    });
    return device;
  }

  private async noteOwnFiles(directory: LibraryPath): Promise<void> {
    for (const entry of await this.listDirectory(directory)) {
      const path = toLibraryPath([...directory, entry.name]);
      if (entry.kind === "directory") {
        await this.noteOwnFiles(path);
      } else {
        const snapshot = await this.readFile(path);
        if (snapshot) noteOwnFile(this.absolute(path), snapshot.sha256);
      }
    }
  }
}

/** Build the desktop environment the shared service runs against. */
export function createFileSystemEnvironment(root: string): LibraryEnvironment {
  return {
    storage: new FileSystemLibraryPort(root),
    runtime: {
      now: isoNow,
      newId: (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      sha256: async (bytes) => createHash("sha256").update(bytes).digest("hex")
    }
  };
}

/* -------------------------------------------------------------------- helpers */

function assertSupportedEntry(info: Stats, parent: boolean): void {
  if (!info.isFile() && !info.isDirectory()) {
    throw new LibraryPortError("unsupported", "Symbolic links and special files are not supported inside a library.");
  }
  if (parent && !info.isDirectory()) {
    throw new LibraryPortError("io", "A library path component is not a directory.");
  }
}

async function renameAcrossDevices(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (errorCode(error) !== "EXDEV") throw error;
    const content = await readFile(from);
    await writeFile(to, content);
    await unlink(from);
  }
}

function dateOrNull(date: Date): string | null {
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function toPortError(error: unknown): LibraryPortError {
  if (error instanceof LibraryPortError) return error;
  const code = errorCode(error);
  const message = (error as Error | undefined)?.message ?? "The library operation failed.";
  switch (code) {
    case "ENOENT":
      return new LibraryPortError("not-found", "The library file was not found.");
    case "EEXIST":
      return new LibraryPortError("already-exists", "The destination already exists.");
    case "ENOSPC":
      return new LibraryPortError("storage-full", "The disk is full. Nothing was replaced.", true);
    case "EROFS":
      return new LibraryPortError("read-only", "The folder is read-only. Nothing was replaced.");
    case "EACCES":
    case "EPERM":
      return new LibraryPortError("permission-required", "The folder cannot be written. Nothing was replaced.", true);
    default:
      return new LibraryPortError("io", message, true);
  }
}
