import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { basename, dirname, join } from "node:path";
import { createLibraryArchive } from "@ai-book-studio/core/archive/export";
import { importLibraryArchive, type ArchiveSource } from "@ai-book-studio/core/archive/import";
import { createFileSystemEnvironment } from "./fs-port";
import { LibraryError } from "./errors";
import { Library } from "./store";

export interface ArchiveExportSummary {
  path: string;
  entryCount: number;
  expandedBytes: number;
}

export interface ImportedLibrary {
  root: string;
  bookCount: number;
}

/**
 * Write a portable archive beside the chosen file, then swap it into place.
 *
 * A previous export at the destination stays intact until the new archive is complete.
 */
export async function writeLibraryArchive(
  library: Library,
  destination: string,
  appVersion: string
): Promise<ArchiveExportSummary> {
  const archive = await createLibraryArchive(createFileSystemEnvironment(library.root), { appVersion });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.partial`);
  await mkdir(dirname(destination), { recursive: true });

  const stream = createWriteStream(temporary, { flags: "w" });
  try {
    for await (const chunk of archive.chunks) {
      if (!stream.write(chunk)) await once(stream, "drain");
    }
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.end(() => {
        stream.off("error", reject);
        resolve();
      });
    });
    await rename(temporary, destination).catch(async (error: NodeJS.ErrnoException) => {
      // Windows refuses to rename over an existing file in some states.
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      await rm(destination, { force: true });
      await rename(temporary, destination);
    });
  } catch (error) {
    stream.destroy();
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  return {
    path: destination,
    entryCount: archive.manifest.entryCount,
    expandedBytes: archive.manifest.expandedBytes
  };
}

/** Import into a new or empty folder. The destination is never merged with an existing library. */
export async function importLibraryArchiveToFolder(archivePath: string, destination: string): Promise<ImportedLibrary> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(destination);
  if (entries.length > 0) {
    throw new LibraryError(
      "invalid",
      "Choose an empty folder for the imported library. Nothing was imported, and the existing files were not changed."
    );
  }

  const environment = createFileSystemEnvironment(destination);
  await importLibraryArchive(archiveSourceFromFile(archivePath), environment.storage, environment.runtime);

  const library = await Library.open(destination);
  const books = await library.listBooks();
  return { root: library.root, bookCount: books.length };
}

function archiveSourceFromFile(path: string): ArchiveSource {
  return {
    async *open() {
      const stream = createReadStream(path);
      for await (const chunk of stream) {
        yield new Uint8Array(chunk as Buffer);
      }
    }
  };
}
