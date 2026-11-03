/**
 * Manuscript import: the main-process picker and source-read boundary (029 T008).
 *
 * The renderer never sees host paths. Picking shows a macOS file dialog through
 * an injected dependency (so unit tests never touch Electron), and reading goes
 * through the filesystem with typed refusals for cancel, missing, oversized,
 * unsupported and unreadable selections. Encoding and content rules stay in
 * shared core (`validateSource`); this module only guards the boundary.
 */
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import {
  ACCEPTED_EXTENSIONS,
  MAX_SOURCE_BYTES,
  refuseUnsupportedExtension,
  validateSource,
  type SourceRefusalReason,
  type ValidatedSource
} from "@ai-book-studio/core/manuscript-import";

export const IMPORT_DIALOG_EXTENSIONS = [...ACCEPTED_EXTENSIONS].map((extension) => extension.slice(1));

export interface ImportFilePicker {
  showOpenDialog(options: {
    properties: ["openFile"];
    filters: [{ name: string; extensions: string[] }];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export type ImportPick =
  | { status: "cancelled" }
  | { status: "refused"; reason: "unsupported-platform"; message: string }
  | { status: "selected"; absolutePath: string; fileName: string };

/**
 * Show the manuscript picker. macOS-only for this milestone (the native rename,
 * dialog and staging paths used later are verified on macOS first).
 */
export async function pickImportSource(
  picker: ImportFilePicker,
  platform: NodeJS.Platform = process.platform
): Promise<ImportPick> {
  if (platform !== "darwin") {
    return {
      status: "refused",
      reason: "unsupported-platform",
      message: "Manuscript import is available on macOS only in this milestone."
    };
  }
  const result = await picker.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Manuscript", extensions: IMPORT_DIALOG_EXTENSIONS }]
  });
  if (result.canceled || result.filePaths.length === 0) return { status: "cancelled" };
  const absolutePath = result.filePaths[0] as string;
  return { status: "selected", absolutePath, fileName: basename(absolutePath) };
}

export type ImportRead =
  | { status: "ready"; absolutePath: string; fileName: string; bytes: Uint8Array; validation: ValidatedSource }
  | {
      status: "refused";
      reason: SourceRefusalReason | "not-found" | "unreadable";
      message: string;
    };

export interface ImportSourceIo {
  stat: (path: string) => Promise<{ size: number }>;
  readFile: (path: string) => Promise<Uint8Array>;
}

const defaultIo: ImportSourceIo = {
  stat: async (path) => stat(path),
  readFile: async (path) => readFile(path)
};

/**
 * Read one picked source file. Refusal copy names only the file name, never a
 * host path. Oversized selections are refused from `stat` before any read.
 */
export async function readImportSource(
  absolutePath: string,
  io: ImportSourceIo = defaultIo
): Promise<ImportRead> {
  const fileName = basename(absolutePath);
  let size: number;
  try {
    size = (await io.stat(absolutePath)).size;
  } catch {
    return {
      status: "refused",
      reason: "not-found",
      message: `“${fileName}” could not be found. Choose the file again.`
    };
  }
  if (size > MAX_SOURCE_BYTES) {
    return {
      status: "refused",
      reason: "too-large",
      message: `“${fileName}” is larger than the 5 MiB import limit. Choose a smaller file.`
    };
  }
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    const refusal = refuseUnsupportedExtension(fileName);
    return { status: "refused", reason: refusal.reason, message: refusal.message };
  }
  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(absolutePath);
  } catch {
    return {
      status: "refused",
      reason: "unreadable",
      message: `“${fileName}” could not be read. Check the file and try again.`
    };
  }
  const validation = validateSource({ fileName, bytes });
  if (validation.status === "refused") {
    return { status: "refused", reason: validation.reason, message: validation.message };
  }
  return { status: "ready", absolutePath, fileName, bytes, validation };
}
