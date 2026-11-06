import type { ArchiveManifest } from "@ai-book-studio/core/archive/manifest";
import { importLibraryArchive, type ArchiveSource } from "@ai-book-studio/core/archive/import";
import { createLibraryArchive, type ArchiveExportOptions } from "@ai-book-studio/core/archive/export";
import type { LibraryEnvironment, LibraryPort, LibraryRuntime } from "@ai-book-studio/core/library/port";

interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

export interface BrowserExportResult {
  manifest: ArchiveManifest;
  fileName: string;
  /** `picker` streams to the chosen file; `download` used a Blob because the browser lacks a picker. */
  method: "picker" | "download";
}

export function saveFilePickerAvailable(): boolean {
  return typeof window !== "undefined" && globalThis.isSecureContext === true && "showSaveFilePicker" in window;
}

/**
 * Export a library without sending a byte to a server.
 *
 * Where the browser offers a save picker, the archive streams straight into the chosen file.
 * Otherwise the bytes are assembled into a Blob and handed to the browser's download UI; that
 * fallback uses memory proportional to the archive, so the archive limits still apply.
 */
export async function exportBrowserArchive(
  env: LibraryEnvironment,
  options: ArchiveExportOptions & { fileName?: string }
): Promise<BrowserExportResult> {
  const archive = await createLibraryArchive(env, options);
  const fileName = options.fileName ?? `ai-book-studio-${new Date().toISOString().slice(0, 10)}.zip`;
  const picker = typeof window === "undefined" ? undefined : (window as unknown as SavePickerWindow).showSaveFilePicker;

  if (picker && saveFilePickerAvailable()) {
    const handle = await picker.call(window, {
      suggestedName: fileName,
      types: [{ description: "Open Book Studio library", accept: { "application/zip": [".zip"] } }]
    });
    const writable = await handle.createWritable();
    try {
      for await (const chunk of archive.chunks) {
        await writable.write(chunk as unknown as FileSystemWriteChunkType);
      }
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === "function") await writable.abort().catch(() => {});
      throw error;
    }
    return { manifest: archive.manifest, fileName: handle.name || fileName, method: "picker" };
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of archive.chunks) chunks.push(chunk);
  const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
  downloadBlob(blob, fileName);
  return { manifest: archive.manifest, fileName, method: "download" };
}

/** Open the browser's file picker. Separated from the API so the DOM path can be tested. */
export function pickArchiveFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** Import a file the author chose. The target must be a new or empty library folder. */
export async function importBrowserArchive(
  file: File,
  target: LibraryPort,
  runtime: LibraryRuntime
): Promise<ArchiveManifest> {
  return importLibraryArchive(fileArchiveSource(file), target, runtime);
}

/** A File can be streamed more than once, which is what the two-pass importer needs. */
export function fileArchiveSource(file: Blob): ArchiveSource {
  return {
    async *open() {
      const reader = file.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
