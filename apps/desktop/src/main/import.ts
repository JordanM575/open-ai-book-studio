/**
 * Manuscript import: the main-process picker and source-read boundary (029 T008).
 *
 * The renderer never sees host paths. Picking shows a macOS file dialog through
 * an injected dependency (so unit tests never touch Electron), and reading goes
 * through the filesystem with typed refusals for cancel, missing, oversized,
 * unsupported and unreadable selections. Encoding and content rules stay in
 * shared core (`validateSource`); Word documents are converted here (D-183) and
 * reach the renderer as the same validated text, never as bytes or a path.
 */
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import {
  ACCEPTED_EXTENSIONS,
  DOCX_EXTENSION,
  MAX_SOURCE_BYTES,
  extensionOf,
  refuseUnsupportedExtension,
  validateSource,
  type ImportSourceReadIssue,
  type ValidatedSource
} from "@ai-book-studio/core/manuscript-import";
import { readDocxSource } from "./docx-import";

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
    filters: [{ name: "Word document, text or Markdown", extensions: IMPORT_DIALOG_EXTENSIONS }]
  });
  if (result.canceled || result.filePaths.length === 0) return { status: "cancelled" };
  const absolutePath = result.filePaths[0] as string;
  return { status: "selected", absolutePath, fileName: basename(absolutePath) };
}

export type ImportRead =
  | { status: "ready"; absolutePath: string; fileName: string; bytes: Uint8Array; validation: ValidatedSource }
  | {
      status: "refused";
      reason: ImportSourceReadIssue;
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
  const extension = extensionOf(fileName);
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
  const validation =
    extension === DOCX_EXTENSION ? await readDocxSource(fileName, bytes) : validateSource({ fileName, bytes });
  if (validation.status === "refused") {
    return { status: "refused", reason: validation.reason, message: validation.message };
  }
  return { status: "ready", absolutePath, fileName, bytes, validation };
}
