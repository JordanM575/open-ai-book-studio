import { createHash, randomUUID } from "node:crypto";
import { watch as watchFiles } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  LibraryEnvironment,
  LibraryFileSnapshot,
  LibraryPort
} from "@ai-book-studio/core/library/port";
import { writeFileAtomic } from "./atomic";
import { isoNow, safeJoin } from "./paths";

/**
 * The reference storage adapter: Electron's main process, over an ordinary folder.
 *
 * It owns atomic replacement and device identity; the shared service owns every promise about
 * the book format. The renderer never sees this class or a host path.
 */
export class FileSystemLibraryPort implements LibraryPort {
  constructor(readonly root: string) {}

  private absolute(path: LibraryPath): string {
    return safeJoin(this.root, ...path);
  }

  async readFile(path: LibraryPath): Promise<LibraryFileSnapshot | null> {
    const absolute = this.absolute(path);
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
    const absolute = this.absolute(path);
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      const result: LibraryEntry[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) result.push({ name: entry.name, kind: "directory" });
        else if (entry.isFile()) result.push({ name: entry.name, kind: "file" });
        // Symbolic links and special files are not part of the library format.
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw toPortError(error);
    }
  }

  async stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    try {
      const info = await stat(this.absolute(path));
      if (!info.isFile()) return null;
      return { size: info.size, createdAt: dateOrNull(info.birthtime), modifiedAt: dateOrNull(info.mtime) };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw toPortError(error);
    }
  }

  async ensureDirectory(path: LibraryPath): Promise<void> {
    try {
      await mkdir(this.absolute(path), { recursive: true });
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

    const absolute = this.absolute(path);
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
    const source = this.absolute(from);
    const destination = this.absolute(to);
    if (await this.readFile(to)) {
      throw new LibraryPortError("already-exists", "The destination already exists.");
    }
    try {
      await mkdir(dirname(destination), { recursive: true });
      await renameAcrossDevices(source, destination);
    } catch (error) {
      throw toPortError(error);
    }
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    const source = this.absolute(from);
    const destination = this.absolute(to);
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
      throw toPortError(error);
    }
  }

  async removeFile(path: LibraryPath): Promise<void> {
    try {
      await unlink(this.absolute(path));
    } catch (error) {
      throw toPortError(error);
    }
  }

  /** Advisory: the caller still checks versions and hashes before every write. */
  watch(path: LibraryPath, onChange: (changedPath: LibraryPath) => void): () => void {
    const absolute = this.absolute(path);
    let watcher: ReturnType<typeof watchFiles>;
    try {
      watcher = watchFiles(absolute, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const segments = String(filename).split(sep).filter((segment) => segment.length > 0);
        if (segments.length === 0) return;
        try {
          // `filename` is relative to the watched directory; the port reports library-relative paths.
          onChange(toLibraryPath([...path, ...segments]));
        } catch {
          // A provider can create names the library format refuses; they are not book files.
        }
      });
    } catch {
      // Some filesystems do not support recursive watch. The save-time checks remain the guard.
      return () => {};
    }
    return () => watcher.close();
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    const path = this.absolute(devicePath());
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LibraryDeviceInfo>;
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
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, `${JSON.stringify(device, null, 2)}\n`);
    return device;
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
