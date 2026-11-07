import { afterEach, describe, expect, test } from "bun:test";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { Library } from "../src/main/library/store";
import {
  collectManuscriptImages, exportManuscriptDocx, exportManuscriptEpub, exportManuscriptMarkdown,
  exportManuscriptPdf, type ExportDeps
} from "../src/main/export";
import type { BookDetail } from "@ai-book-studio/core/schema";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==", "base64"));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-export-safety-"));
  roots.push(root);
  const library = await Library.open(join(root, "library"));
  const book = await library.createBook({ title: "Synthetic export" });
  const chapter = await library.createChapter(book.id, { title: "First", content: "SYNTHETIC_SAVED_BODY\n" });
  const image = await library.addImage(book.id, { bytes: PNG, kind: "chapter", prompt: "Synthetic pixel", provider: "fixture", model: "fixture" });
  await library.attachImage(book.id, image.id, chapter.id);
  const detail = await library.readBook(book.id);
  const source = async () => {
    const files: Record<string, Buffer> = {};
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files[path] = await readFile(path);
      }
    }
    await walk(library.root);
    return files;
  };
  return { root, library, detail, image, source };
}

type Kind = "docx" | "markdown" | "pdf" | "epub";
async function publish(kind: Kind, detail: BookDetail, library: Library, deps: ExportDeps, libraryRoot = library.root) {
  const { illustrations } = await collectManuscriptImages(detail, library);
  if (kind === "docx") return exportManuscriptDocx(detail, illustrations, libraryRoot, deps);
  if (kind === "markdown") return exportManuscriptMarkdown(detail, libraryRoot, deps);
  // Synthetic renderer bytes exercise publication, not Chromium or PDF conformance.
  if (kind === "pdf") return exportManuscriptPdf(detail, illustrations, libraryRoot, {
    ...deps, renderPdf: async (html) => Buffer.from(`%PDF-SYNTHETIC\n${html}`)
  });
  return exportManuscriptEpub(detail, illustrations, libraryRoot, deps);
}

function dependencies(path: string, overrides: Partial<ExportDeps> = {}): ExportDeps {
  return {
    pickDestination: async () => path,
    confirmReplace: async () => true,
    statDestination: async (file) => {
      try { const value = await stat(file); return { size: value.size, mtimeMs: value.mtimeMs }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    ...overrides
  };
}

function atStaging(operation: "writeFile" | "sync" | "close", run: (handle: Awaited<ReturnType<typeof open>>) => Promise<void>): ExportDeps["atomic"] {
  return { open: async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    if (!String(args[0]).endsWith(".tmp")) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === operation) return () => run(target);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
}

describe("single-file export safety with real synthetic bytes", () => {
  for (const kind of ["docx", "markdown", "pdf", "epub"] as const) {
    test(`${kind}: a library opened through an alias still refuses its real source directory`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const alias = join(root, "library-alias");
      await symlink(library.root, alias);
      const destination = join(library.root, "books", detail.book.id, "book.json");
      await expect(publish(kind, detail, library, dependencies(destination), alias)).rejects.toThrow("inside the open library");
      expect(await source()).toEqual(before);
    });

    test(`${kind}: library root/subdirectory aliases and missing basenames refuse before staging`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      let opens = 0;
      for (const [index, target] of [library.root, join(library.root, "books", detail.book.id)].entries()) {
        const alias = join(root, `alias-${index}`);
        await symlink(target, alias);
        for (const name of ["book.json", "missing-output"]) {
          await expect(publish(kind, detail, library, dependencies(join(alias, name), {
            atomic: { open: async (...args) => { opens++; return open(...args); } }
          }))).rejects.toThrow("inside the open library");
        }
      }
      expect(opens).toBe(0);
      expect(await source()).toEqual(before);
    });

    for (const operation of ["realpath", "lstat", "readFile"] as const) {
      test(`${kind}: ${operation} failure refuses before staging and preserves bytes`, async () => {
        const { root, library, detail, source } = await fixture();
        const before = await source();
        const path = join(root, `previous.${kind}`);
        await writeFile(path, "SYNTHETIC_PREVIOUS");
        let opens = 0;
        await expect(publish(kind, detail, library, dependencies(path, {
          inspection: { [operation]: async () => { throw Object.assign(new Error(`synthetic ${operation} denied`), { code: "EACCES" }); } },
          atomic: { open: async (...args) => { opens++; return open(...args); } }
        }))).rejects.toThrow(`synthetic ${operation} denied`);
        expect(opens).toBe(0);
        expect(await source()).toEqual(before);
        expect(await readFile(path, "utf8")).toBe("SYNTHETIC_PREVIOUS");
      });
    }

    test(`${kind}: an outside parent changed to a library alias during consent refuses before staging`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const outside = join(root, "outside");
      await mkdir(outside);
      const alias = join(root, "chosen-parent");
      await symlink(outside, alias);
      await writeFile(join(outside, "book.json"), "SYNTHETIC_PRIOR");
      let opens = 0;
      await expect(publish(kind, detail, library, dependencies(join(alias, "book.json"), {
        // Keep the legacy stat seam stable so canonicalization, rather than a stat difference, catches it.
        statDestination: async () => ({ size: 15, mtimeMs: 1 }),
        confirmReplace: async () => { await unlink(alias); await symlink(join(library.root, "books", detail.book.id), alias); return true; },
        atomic: { open: async (...args) => { opens++; return open(...args); } }
      }))).rejects.toThrow("inside the open library");
      expect(opens).toBe(0);
      expect(await source()).toEqual(before);
      expect(await readFile(join(outside, "book.json"), "utf8")).toBe("SYNTHETIC_PRIOR");
      expect(await readdir(outside)).toEqual(["book.json"]);
    });

    test(`${kind}: parent alias changed after staging preserves source and cleans the original staging location`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const outside = join(root, "outside");
      await mkdir(outside);
      const alias = join(root, "chosen-parent");
      await symlink(outside, alias);
      await writeFile(join(outside, "book.json"), "SYNTHETIC_PRIOR");
      const atomic = atStaging("sync", async (handle) => {
        await handle.sync();
        await unlink(alias);
        await symlink(join(library.root, "books", detail.book.id), alias);
      });
      await expect(publish(kind, detail, library, dependencies(join(alias, "book.json"), {
        atomic, statDestination: async () => ({ size: 15, mtimeMs: 1 })
      }))).rejects.toThrow("inside the open library");
      expect(await source()).toEqual(before);
      expect(await readFile(join(outside, "book.json"), "utf8")).toBe("SYNTHETIC_PRIOR");
      expect(await readdir(outside)).toEqual(["book.json"]);
    });

    test(`${kind}: a harmless outside parent alias is supported`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const outside = join(root, "outside");
      await mkdir(outside);
      const alias = join(root, "chosen-parent");
      await symlink(outside, alias);
      const path = join(alias, `new.${kind}`);
      expect(await publish(kind, detail, library, dependencies(path))).toBe(path);
      expect((await readFile(path)).length).toBeGreaterThan(10);
      expect(await source()).toEqual(before);
      expect(await readdir(outside)).toEqual([`new.${kind}`]);
    });

    for (const operation of ["writeFile", "sync", "close"] as const) {
      test(`${kind}: ${operation} failure preserves source and previous output and cleans staging`, async () => {
        const { root, library, detail, source } = await fixture();
        const before = await source();
        const path = join(root, `previous.${kind}`);
        await writeFile(path, "SYNTHETIC_PREVIOUS");
        const atomic = atStaging(operation, async (handle) => {
          if (operation === "writeFile") await handle.writeFile("SYNTHETIC_PARTIAL");
          if (operation === "close") await handle.close();
          throw new Error(`synthetic ${operation} failure`);
        });
        await expect(publish(kind, detail, library, dependencies(path, { atomic }))).rejects.toThrow(`synthetic ${operation} failure`);
        expect(await readFile(path, "utf8")).toBe("SYNTHETIC_PREVIOUS");
        expect(await source()).toEqual(before);
        expect((await readdir(root)).sort()).toEqual(["library", `previous.${kind}`]);
      });
    }

    test(`${kind}: rename failure names the actual leftover if cleanup also fails`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const path = join(root, `previous.${kind}`);
      await writeFile(path, "SYNTHETIC_PREVIOUS");
      let leftover = "";
      let message = "";
      const primary = new Error("synthetic rename failure");
      try {
        await publish(kind, detail, library, dependencies(path, { atomic: {
          rename: async () => { throw primary; },
          unlink: async (temp) => { leftover = String(temp); throw new Error("synthetic cleanup failure"); }
        } }));
      } catch (error) { message = (error as Error).message; expect((error as Error).cause).toBe(primary); }
      expect(message).toContain("not published");
      expect(message).toContain("synthetic rename failure");
      expect(message).toContain(leftover);
      expect(leftover).not.toBe("");
      expect((await readFile(leftover)).length).toBeGreaterThan(10);
      expect(await readFile(path, "utf8")).toBe("SYNTHETIC_PREVIOUS");
      expect(await source()).toEqual(before);
    });

    test(`${kind}: a new destination created during staging is preserved`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const path = join(root, `appeared.${kind}`);
      const atomic = atStaging("sync", async (handle) => { await handle.sync(); await writeFile(path, "SYNTHETIC_OTHER_WRITER"); });
      await expect(publish(kind, detail, library, dependencies(path, { atomic }))).rejects.toThrow("file changed");
      expect(await readFile(path, "utf8")).toBe("SYNTHETIC_OTHER_WRITER");
      expect(await source()).toEqual(before);
      expect((await readdir(root)).sort()).toEqual([`appeared.${kind}`, "library"]);
    });

    test(`${kind}: same-size changed bytes during staging are preserved despite a stale stat seam`, async () => {
      const { root, library, detail } = await fixture();
      const path = join(root, `changed.${kind}`);
      await writeFile(path, "OLD_SYNTHETIC");
      const initialStat = await lstat(path);
      const atomic = atStaging("sync", async (handle) => { await handle.sync(); await writeFile(path, "NEW_SYNTHETIC"); });
      await expect(publish(kind, detail, library, dependencies(path, {
        atomic, statDestination: async () => ({ size: 13, mtimeMs: 1 }),
        // Freeze every metadata field: only the actual changed content hash can catch this write.
        inspection: { lstat: async () => initialStat }
      }))).rejects.toThrow("file changed");
      expect(await readFile(path, "utf8")).toBe("NEW_SYNTHETIC");
    });

    test(`${kind}: source aliases are refused and never replaced`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const first = detail.chapters[0];
      if (!first) throw new Error("Synthetic chapter missing");
      const chapter = join(library.root, "books", detail.book.id, "chapters", first.path);
      for (const create of [link, symlink]) {
        const path = join(root, `${create === link ? "hard" : "soft"}.${kind}`);
        await create(chapter, path);
        await expect(publish(kind, detail, library, dependencies(path))).rejects.toThrow("link");
        expect(await readFile(path)).toEqual(await readFile(chapter));
      }
      expect(await source()).toEqual(before);
    });

    test(`${kind}: snapshot survives later input mutation and publication leaves source unchanged`, async () => {
      const { root, library, detail, source } = await fixture();
      const before = await source();
      const path = join(root, `saved.${kind}`);
      const first = detail.chapters[0];
      if (!first) throw new Error("Synthetic chapter missing");
      await publish(kind, detail, library, dependencies(path, {
        pickDestination: async () => { first.content = "SYNTHETIC_LATER_BODY"; return path; }
      }));
      const bytes = await readFile(path);
      const content = kind === "epub" || kind === "docx"
        ? Object.values(unzipSync(bytes)).map((value) => Buffer.from(value).toString()).join("\n") : bytes.toString();
      expect(content).toContain("SYNTHETIC_SAVED_BODY");
      expect(content).not.toContain("SYNTHETIC_LATER_BODY");
      expect(await source()).toEqual(before);
      expect((await readdir(root)).sort()).toEqual(["library", `saved.${kind}`]);
    });
  }

  test("actual destination presence still requires consent when a stat adapter reports null", async () => {
    const { root, library, detail } = await fixture();
    const path = join(root, "prior.md");
    await writeFile(path, "SYNTHETIC_PRIOR");
    let confirmed = false;
    expect(await publish("markdown", detail, library, dependencies(path, {
      statDestination: async () => null, confirmReplace: async () => { confirmed = true; return false; }
    }))).toBeNull();
    expect(confirmed).toBe(true);
    expect(await readFile(path, "utf8")).toBe("SYNTHETIC_PRIOR");
  });
});

describe("snapshot image warnings", () => {
  test("missing and modified real image files report their name without losing text", async () => {
    const { root, library, detail, image } = await fixture();
    const path = join(library.root, "books", detail.book.id, "images", image.fileName);
    for (const damage of ["missing", "changed"]) {
      if (damage === "missing") await rename(path, `${path}.kept`);
      else await writeFile(path, "SYNTHETIC_CHANGED_IMAGE");
      const { illustrations, warnings } = await collectManuscriptImages(detail, library);
      expect(illustrations.size).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(image.fileName);
      expect(warnings[0]).toContain("First");
      const output = join(root, `${damage}.epub`);
      await exportManuscriptEpub(detail, illustrations, library.root, dependencies(output));
      const text = Object.values(unzipSync(await readFile(output))).map((value) => Buffer.from(value).toString()).join("\n");
      expect(text).toContain("SYNTHETIC_SAVED_BODY");
    }
  });

  test("a corrupt real manifest reports its warning and stays byte-identical", async () => {
    const { library, detail } = await fixture();
    const path = join(library.root, "books", detail.book.id, "images.json");
    await writeFile(path, "SYNTHETIC_INVALID_MANIFEST");
    const { illustrations, warnings } = await collectManuscriptImages(detail, library);
    expect(illustrations.size).toBe(0);
    expect(warnings.join(" ")).toContain("image list could not be read");
    expect(await readFile(path, "utf8")).toBe("SYNTHETIC_INVALID_MANIFEST");
  });

  test("Markdown discloses the attached image omission without reading image bytes", async () => {
    const { library, detail, image } = await fixture();
    const result = await collectManuscriptImages(detail, {
      listImages: (id) => library.listImages(id), readImage: async () => { throw new Error("must not read"); }
    }, "markdown");
    expect(result.illustrations.size).toBe(0);
    expect(result.warnings).toEqual([`Skipped ${image.fileName} (First): this Markdown export is text only and does not include illustrations.`]);
  });

  test("WebP and null reads warn; unattached assets are intentionally unused", async () => {
    const { library, detail } = await fixture();
    const { manifest } = await library.listImages(detail.book.id);
    const first = manifest.images[0];
    if (!first) throw new Error("Synthetic image missing");
    const result = await collectManuscriptImages(detail, {
      listImages: async () => ({ warning: null, manifest: { ...manifest, images: [
        { ...first, id: "img_webp0001", fileName: "synthetic.webp", mimeType: "image/webp" },
        first,
        { ...first, id: "img_unused01", fileName: "unattached.png", chapterId: null }
      ] } }),
      readImage: async () => null
    });
    expect(result.illustrations.size).toBe(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("synthetic.webp");
    expect(result.warnings[1]).toContain("no longer in the book's image list");
    expect(result.warnings.join(" ")).not.toContain("unattached.png");
  });
});
