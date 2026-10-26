import { LibraryPortError } from "./errors";

declare const libraryPathBrand: unique symbol;

/** A validated sequence of library-relative path segments (not an OS path). */
export type LibraryPath = readonly string[] & { readonly [libraryPathBrand]: true };

const controlCharacters = /[\u0000-\u001f\u007f]/;

/** Validate and freeze path segments before they cross into a storage adapter. */
export function toLibraryPath(segments: readonly string[]): LibraryPath {
  if (!Array.isArray(segments)) {
    throw new LibraryPortError("invalid-path", "Library path must be a list of relative segments.");
  }

  for (const segment of segments) {
    if (
      typeof segment !== "string" ||
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      controlCharacters.test(segment)
    ) {
      throw new LibraryPortError("invalid-path", "Library path contains an unsafe segment.");
    }
  }

  return Object.freeze([...segments]) as LibraryPath;
}

/** File operations must not treat the library root as a file. */
export function toLibraryFilePath(segments: readonly string[]): LibraryPath {
  const path = toLibraryPath(segments);
  if (path.length === 0) {
    throw new LibraryPortError("invalid-path", "A library file path cannot be the library root.");
  }
  return path;
}

export function childLibraryPath(parent: LibraryPath, child: string): LibraryPath {
  return toLibraryPath([...toLibraryPath(parent), child]);
}

export function libraryPathToArchivePath(path: LibraryPath): string {
  const segments = toLibraryPath(path);
  if (segments.length === 0) {
    throw new LibraryPortError("invalid-path", "The library root is not an archive file path.");
  }
  return segments.join("/");
}

/** Parse an archive entry name without URL-decoding or normalizing away unsafe segments. */
export function libraryPathFromArchivePath(path: string): LibraryPath {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\")
  ) {
    throw new LibraryPortError("invalid-path", "Archive entry path is not library-relative.");
  }
  return toLibraryPath(path.split("/"));
}

/** Adapter boundary check for values that may have crossed structured-clone or IPC. */
export function validateLibraryPath(path: LibraryPath): LibraryPath {
  return toLibraryPath(path);
}
