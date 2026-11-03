import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickImportSource, readImportSource, type ImportFilePicker } from "../src/main/import";

/**
 * The picker and source-read boundary an importer can rely on (spec 029 T008).
 *
 * Choosing a file shows a native dialog through an injected picker, so these
 * tests never touch Electron. Host paths stay in the main process: refusals
 * name only the file, and the renderer will receive bytes plus validation.
 */

const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop() as string, { recursive: true, force: true });
});

function pickerReturning(filePaths: string[]): ImportFilePicker {
  return {
    showOpenDialog: async () => ({ canceled: filePaths.length === 0, filePaths })
  };
}

async function stageFile(name: string, bytes: Uint8Array | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "studio-import-"));
  cleanups.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

describe("pickImportSource", () => {
  test("a cancelled dialog cancels without a refusal", async () => {
    expect(await pickImportSource(pickerReturning([]), "darwin")).toEqual({ status: "cancelled" });
  });

  test("a chosen file returns its path and bare file name", async () => {
    const pick = await pickImportSource(pickerReturning(["/Users/author/Books/draft one.txt"]), "darwin");
    expect(pick).toEqual({
      status: "selected",
      absolutePath: "/Users/author/Books/draft one.txt",
      fileName: "draft one.txt"
    });
  });

  test("a non-macOS platform is refused before any dialog opens", async () => {
    let opened = false;
    const watching: ImportFilePicker = {
      showOpenDialog: async () => {
        opened = true;
        return { canceled: true, filePaths: [] };
      }
    };
    for (const platform of ["win32", "linux"] as const) {
      const pick = await pickImportSource(watching, platform);
      expect(pick.status).toBe("refused");
      if (pick.status === "refused") expect(pick.reason).toBe("unsupported-platform");
    }
    expect(opened).toBe(false);
  });
});

describe("readImportSource", () => {
  test("a valid manuscript is ready with shared-core validation", async () => {
    const path = await stageFile("Road.txt", "Salt and stone.\n\nThe second line.\n");
    const read = await readImportSource(path);
    expect(read.status).toBe("ready");
    if (read.status !== "ready") return;
    expect(read.fileName).toBe("Road.txt");
    expect(read.absolutePath).toBe(path);
    expect(read.validation.fileName).toBe("Road.txt");
    expect(new TextDecoder().decode(read.bytes)).toContain("Salt and stone.");
  });

  test("a missing file is a not-found refusal naming only the file", async () => {
    const read = await readImportSource("/definitely/not/here/gone.txt");
    expect(read).toMatchObject({ status: "refused", reason: "not-found" });
    if (read.status !== "refused") return;
    expect(read.message).toContain("gone.txt");
    expect(read.message).not.toContain("/definitely/not/here");
  });

  test("an oversized file is refused from its size before any read", async () => {
    let reads = 0;
    const read = await readImportSource("/staged/huge.txt", {
      stat: async () => ({ size: 5 * 1024 * 1024 + 1 }),
      readFile: async () => {
        reads += 1;
        return new Uint8Array();
      }
    });
    expect(read).toMatchObject({ status: "refused", reason: "too-large" });
    expect(reads).toBe(0);
  });

  test("an unsupported extension is refused without reading", async () => {
    let reads = 0;
    const read = await readImportSource("/staged/notes.pdf", {
      stat: async () => ({ size: 10 }),
      readFile: async () => {
        reads += 1;
        return new Uint8Array();
      }
    });
    expect(read).toMatchObject({ status: "refused", reason: "unsupported-extension" });
    if (read.status !== "refused") return;
    expect(read.message).toContain(".txt");
    expect(reads).toBe(0);
  });

  test("an unreadable selection is refused without its host path", async () => {
    // A directory stats but does not read as a file.
    const dir = await mkdtemp(join(tmpdir(), "studio-import-dir-"));
    cleanups.push(dir);
    const staged = join(dir, "folder.txt");
    await mkdtemp(staged);
    cleanups.push(staged);
    const read = await readImportSource(staged);
    expect(read.status).toBe("refused");
    if (read.status !== "refused") return;
    expect(read.message).toContain("folder.txt");
    expect(read.message).not.toContain(staged);
  });

  test("invalid encoding is refused through shared-core validation", async () => {
    const path = await stageFile("Broken.txt", new Uint8Array([0xff, 0xfe, 0x41]));
    const read = await readImportSource(path);
    expect(read).toMatchObject({ status: "refused", reason: "invalid-encoding" });
  });
});
