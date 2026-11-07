import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createAtomicWriter } from "./library/atomic";
import { LibraryError } from "./library/errors";

export const DESTINATION_CHANGED = "The file changed before the export was saved. Nothing was written. Try the export again.";
const inspectionFs = {
  realpath: (path: string) => realpath(path),
  lstat: (path: string) => lstat(path),
  readFile: (path: string) => readFile(path)
};
export type ExportInspectionOverrides = Partial<typeof inspectionFs>;

function inside(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path));
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

/** Fail closed on unreadable destinations; only ENOENT means there is nothing to replace. */
export async function inspectExportDestination(libraryRoot: string, path: string, overrides: ExportInspectionOverrides = {}): Promise<{ exists: boolean; fingerprint: string; resolvedPath: string }> {
  const fs = { ...inspectionFs, ...overrides };
  const [root, parent] = await Promise.all([fs.realpath(libraryRoot), fs.realpath(dirname(path))]);
  const resolvedPath = join(parent, basename(path));
  if (inside(libraryRoot, path) || inside(root, parent)) {
    throw new LibraryError("invalid", "That location is inside the open library. Choose another folder so the export cannot overwrite the book's own files.");
  }
  let state: import("node:fs").Stats;
  try {
    state = await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, fingerprint: `${parent}\nmissing`, resolvedPath };
    throw error;
  }
  // Reject links instead of guessing whether their other name belongs to an author's source.
  if (!state.isFile() || state.nlink !== 1) {
    throw new LibraryError("invalid", "That destination is a link or is not an ordinary file. Choose a different export file.");
  }
  const hash = createHash("sha256").update(await fs.readFile(path)).digest("hex");
  return { exists: true, fingerprint: JSON.stringify([parent, state.dev, state.ino, state.size, state.mtimeMs, state.ctimeMs, hash]), resolvedPath };
}

export type ExportAtomicOverrides = Parameters<typeof createAtomicWriter>[0];

/** Reuse the central atomic writer, adding export-specific last-moment validation and diagnostics. */
export function createExportWriter(beforePublish: () => Promise<void>, overrides: ExportAtomicOverrides = {}) {
  return async (path: string, bytes: Uint8Array): Promise<void> => {
    let leftover: string | null = null;
    const write = createAtomicWriter({
      ...overrides,
      rename: async (from, to) => {
        await beforePublish();
        await (overrides.rename ?? rename)(from, to);
      },
      unlink: async (temp) => {
        try {
          await (overrides.unlink ?? unlink)(temp);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") leftover = String(temp);
          throw error;
        }
      }
    });
    try {
      await write(path, bytes);
    } catch (error) {
      if (leftover) {
        const reason = error instanceof Error ? error.message : String(error);
        throw Object.assign(new LibraryError("io", `The export was not published. ${reason} Temporary output could not be removed: ${leftover}. Remove that temporary file when it is no longer needed, then try again.`), { cause: error, temporaryPath: leftover });
      }
      throw error;
    }
  };
}
