import { SCHEMA_VERSION } from "../schema";
import { LibraryError } from "./errors";
import { libraryPathToArchivePath } from "./path";
import { bookFilePath } from "./paths";
import type { LibraryPort } from "./port";

/** Refuse a file another build wrote with a newer schema, before anything here could drop its fields. */
export function assertSchemaVersion(version: unknown, path: string): void {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new LibraryError("invalid", `${path} has no schemaVersion. It may not be an Open Book Studio file.`);
  }
  if (version > SCHEMA_VERSION) {
    throw new LibraryError(
      "newer-schema",
      `${path} was written by a newer version of Open Book Studio (schema ${version}). Update the app before opening this library, so no fields are dropped.`
    );
  }
}

/**
 * Every write into a book checks the book's schema first. Another device may have upgraded
 * `book.json` since the book was opened, and then nothing in the book is written: not a chapter,
 * an image, a conversation or the Story Bible. Only a newer schema is refused here; a missing or
 * unreadable `book.json` is left to the write's own checks, so a half-synced file never blocks a save.
 */
export async function assertBookWritable(storage: LibraryPort, bookId: string): Promise<void> {
  let version: unknown;
  let path = "";
  try {
    const file = bookFilePath(bookId);
    path = libraryPathToArchivePath(file);
    const snapshot = await storage.readFile(file);
    if (!snapshot) return;
    version = (JSON.parse(new TextDecoder().decode(snapshot.bytes)) as { schemaVersion?: unknown } | null)?.schemaVersion;
  } catch {
    return;
  }
  if (typeof version === "number" && version > SCHEMA_VERSION) assertSchemaVersion(version, path);
}
