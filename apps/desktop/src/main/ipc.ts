import { app, dialog, ipcMain, nativeImage, shell } from "electron";
import type { BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import {
  IPC,
  type BridgeControl,
  type BridgeStatus,
  type Result,
  type SpokenReply,
  type StudioError,
  type VoiceSpeakers
} from "@ai-book-studio/core/ipc";
import { idSchema } from "@ai-book-studio/core/schema";
import { PROVIDER_LIST } from "@ai-book-studio/core/providers/registry";
import { EXTERNAL_LINKS } from "@ai-book-studio/core/providers/links";
import { IMAGE_SIZES } from "@ai-book-studio/core/providers/images";
import { imageIdSchema } from "@ai-book-studio/core/images/schema";
import { ProviderError, connectionIdSchema, providerIdSchema } from "@ai-book-studio/core/providers/types";
import { redact } from "@ai-book-studio/core/providers/redact";
import { LibraryPortError } from "@ai-book-studio/core/library/errors";
import {
  importManuscriptInputSchema,
  type ImportSourcePick
} from "@ai-book-studio/core/manuscript-import";
import { pickImportSource, readImportSource, type ImportFilePicker } from "./import";
import { buildMetadata } from "@ai-book-studio/core/build";
import { createLicenseReader } from "./licenses";
import { LibraryError } from "./library/store";
import { safeJoin } from "./library/paths";
import {
  collectDocxImages,
  exportBookImages,
  exportManuscriptDocx,
  exportManuscriptEpub,
  exportManuscriptMarkdown,
  exportManuscriptPdf,
  type ExportDeps
} from "./export";
import { renderPdfInHiddenWindow } from "./pdf";
import { importLegacyBackup } from "./legacy-import";
import { importLibraryArchiveToFolder, writeLibraryArchive } from "./library/archive";
import { ArchiveError } from "@ai-book-studio/core/archive/errors";
import { UsageStore } from "./usage";
import { MetricsStore } from "./metrics";
import { DEFAULT_SYNC_CHECK_INTERVAL_MINUTES } from "./settings";
import { SyncService } from "./sync";
import type { SyncSettings } from "@ai-book-studio/core/ipc";
import { summarizeCache } from "@ai-book-studio/core/agent/metrics";
import {
  monthlySpend,
  monthlyWarning,
  turnCostWarning,
  type UsageRecord
} from "@ai-book-studio/core/providers/usage";
import type { AgentStatus, PluginStatus, SpendingStatus } from "@ai-book-studio/core/agent/metrics";
import { agentGuidanceTextSchema, agentModeSchema } from "@ai-book-studio/core/agent/messages";
import { ANSWER_LENGTHS } from "@ai-book-studio/core/agent/settings";
import { loadPlugins, pluginTools, validatePluginFolder } from "./agent/plugins";
import { readBookSkills } from "./agent/skills";
import { AmbientService } from "./agent/ambient";
import { localAddresses } from "./bridge";
import type { ToolBridge } from "./agent/tool-bridge";
import type { LocalBackend } from "./backend";
import type { SettingsStore } from "./settings";
import type { Studio } from "./studio";
import type { ProviderService } from "./providers";
import type { AgentRuntime } from "./agent/runtime";
import type { VoiceService } from "./voice";
import type { SpeechService } from "./speech";
import { ttsCapability } from "@ai-book-studio/core/providers/tts";
import type { ImageService } from "./images";
import type { SegmentationService } from "./segmentation";

const folderInput = z.string().min(1).max(4096);
const contentInput = z.string().max(20_000_000);
const versionInput = z.number().int().min(0);
const hashInput = z.string().regex(/^[a-f0-9]{64}$/);
const connectionId = connectionIdSchema;

const speakInput = z.object({
  connectionId: connectionIdSchema.optional(),
  text: z.string().min(1).max(200_000),
  voice: z.string().min(1).max(40).optional(),
  speed: z.number().min(0.25).max(4).optional()
});

const saveInput = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  content: contentInput,
  baseVersion: versionInput,
  baseHash: hashInput
});

const metaPatch = z.object({
  title: z.string().max(400).optional(),
  synopsis: z.string().max(20_000).optional(),
  purpose: z.string().max(20_000).optional(),
  notes: z.string().max(20_000).optional(),
  arc: z.enum(["beginning", "middle", "end"]).optional(),
  order: z.number().int().positive().optional(),
  isPrologue: z.boolean().optional(),
  color: z.string().max(40).nullable().optional()
});

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function fail(error: unknown): Result<never> {
  if (error instanceof z.ZodError) {
    return { ok: false, error: { code: "invalid", message: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } };
  }
  if (error instanceof LibraryError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (error instanceof ArchiveError) {
    return { ok: false, error: { code: "io", message: error.message } };
  }
  if (error instanceof LibraryPortError) {
    const code: StudioError["code"] =
      error.code === "not-found" ? "not-found" : error.code === "invalid-path" ? "invalid" : "io";
    return { ok: false, error: { code, message: error.message } };
  }
  if (error instanceof ProviderError) {
    return { ok: false, error: { code: error.code, message: redact(error.message) } };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code: StudioError["code"] = /ENOENT/.test(message) ? "not-found" : /EACCES|EPERM/.test(message) ? "io" : "internal";
  console.error("[ipc]", redact(message));
  return { ok: false, error: { code, message: redact(message) } };
}

export function registerIpc(
  studio: Studio,
  getWindow: () => BrowserWindow | null,
  providers: ProviderService,
  agent: AgentRuntime,
  voice: VoiceService,
  images: ImageService,
  segmentation: SegmentationService,
  toolsBridge: ToolBridge,
  settings: SettingsStore,
  speech: SpeechService,
  getBackend: () => LocalBackend | null = () => null,
  bridge: BridgeControl = { status: null, start: async () => undefined, stop: async () => undefined },
  /** Whether the agent is working on a book right now, for the ambient status and Stop. */
  isWorking: (bookId: string) => boolean = () => false
): void {
  /** What the plugin folder currently provides, for the settings panel. */
  const pluginStatus = async (): Promise<PluginStatus> => {
    const loaded = await loadPlugins(settings.get().pluginFolder ?? null);
    return {
      folder: loaded.folder,
      loaded: loaded.plugins.map((plugin) => plugin.name),
      tools: pluginTools(loaded.plugins).map((tool) => tool.name),
      failures: loaded.failures
    };
  };

  /** The bridge to the phone: its address, its token and whether it is running. */
  const bridgeStatus = (): BridgeStatus => ({
    running: bridge.status !== null,
    url: bridge.status?.url ?? null,
    token: bridge.status?.token ?? null,
    address: bridge.status?.address ?? null,
    addresses: localAddresses()
  });

  const handle = <T>(channel: string, handler: (payload: unknown) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, payload: unknown): Promise<Result<T>> => {
      try {
        return ok(await handler(payload));
      } catch (error) {
        return fail(error);
      }
    });
  };

  /* ---------------------------------------------------------------------- app */

  handle(IPC.app.info, () => buildMetadata("desktop", { platform: process.platform, arch: process.arch }));

  /** Read-only: the list the build wrote beside the main bundle. It takes no input. */
  const readLicenses = createLicenseReader();
  handle(IPC.app.licenses, () => readLicenses());
  handle(IPC.app.openLink, async (payload) => {
    // A whole-string match against the allow-list: no prefix, query, host or scheme widens it.
    await shell.openExternal(z.enum(EXTERNAL_LINKS).parse(payload));
    return null;
  });

  /* ------------------------------------------------------------------ library */

  handle(IPC.library.current, () => studio.current());

  handle(IPC.library.choose, async () => {
    const window = getWindow();
    const options = {
      title: "Choose a library folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return null;
    return studio.openLibrary(folder);
  });

  handle(IPC.library.open, async (payload) => studio.openLibrary(folderInput.parse(payload)));

  handle(IPC.library.reveal, async () => {
    const library = studio.requireLibrary();
    shell.showItemInFolder(library.root);
    return null;
  });

  handle(IPC.library.importLegacy, async () => {
    const window = getWindow();
    const options = {
      title: "Import an old backup",
      buttonLabel: "Import backup",
      filters: [{ name: "Backup", extensions: ["json"] }],
      properties: ["openFile"] as Array<"openFile">
    };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const raw = await readFile(file, "utf8");
    return importLegacyBackup(studio.requireLibrary(), raw);
  });

  handle(IPC.library.exportArchive, async () => {
    const library = studio.requireLibrary();
    const forced = process.env.STUDIO_EXPORT_PATH;
    if (forced) {
      // A headless run cannot answer a save dialog; it names the folder instead.
      return writeLibraryArchive(library, join(forced, "library.zip"), app.getVersion());
    }
    const window = getWindow();
    const options = {
      title: "Export the whole library",
      buttonLabel: "Export archive",
      defaultPath: join(dirname(library.root), `${basename(library.root) || "library"}.zip`),
      filters: [{ name: "AI Book Studio library", extensions: ["zip"] }]
    };
    const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;
    return writeLibraryArchive(library, picked.filePath, app.getVersion());
  });

  handle(IPC.library.importArchive, async () => {
    const window = getWindow();
    const archiveOptions = {
      title: "Import a library archive",
      buttonLabel: "Choose archive",
      filters: [{ name: "AI Book Studio library", extensions: ["zip"] }],
      properties: ["openFile"] as Array<"openFile">
    };
    const pickedArchive = window
      ? await dialog.showOpenDialog(window, archiveOptions)
      : await dialog.showOpenDialog(archiveOptions);
    const archive = pickedArchive.filePaths[0];
    if (pickedArchive.canceled || !archive) return null;

    const destinationOptions = {
      title: "Choose an empty folder for the imported library",
      buttonLabel: "Import here",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const pickedFolder = window
      ? await dialog.showOpenDialog(window, destinationOptions)
      : await dialog.showOpenDialog(destinationOptions);
    const folder = pickedFolder.filePaths[0];
    if (pickedFolder.canceled || !folder) return null;

    const imported = await importLibraryArchiveToFolder(archive, folder);
    const info = await studio.openLibrary(imported.root);
    return { library: info, bookCount: imported.bookCount };
  });

  handle(IPC.library.locationHealth, async () => studio.requireLibrary().locationHealth());

  /* -------------------------------------------------------------------- books */

  handle(IPC.books.list, async () => studio.requireLibrary().listBooks());

  handle(IPC.books.create, async (payload) => {
    const input = z
      .object({ title: z.string().min(1).max(300), description: z.string().max(20_000).optional() })
      .parse(payload);
    return studio.requireLibrary().createBook(input);
  });

  handle(IPC.books.open, async (payload) => studio.requireLibrary().readBook(idSchema.parse(payload)));

  handle(IPC.books.importManuscript, async (payload) => {
    const input = importManuscriptInputSchema.parse(payload);
    return studio.requireLibrary().importManuscript(input);
  });

  handle(IPC.books.pickImportSource, async (): Promise<ImportSourcePick> => {
    const forced = process.env.STUDIO_IMPORT_PATH;
    if (forced) {
      // A headless run cannot answer a native dialog; it names the fixture instead.
      const read = await readImportSource(forced);
      if (read.status !== "ready") {
        return { status: "refused", reason: read.reason, message: read.message };
      }
      return { status: "ready", source: read.validation };
    }
    const window = getWindow();
    const picker: ImportFilePicker = {
      showOpenDialog: (options) =>
        window
          ? dialog.showOpenDialog(window, {
              ...options,
              title: "Choose a manuscript",
              buttonLabel: "Choose manuscript"
            })
          : dialog.showOpenDialog({
              ...options,
              title: "Choose a manuscript",
              buttonLabel: "Choose manuscript"
            })
    };
    const picked = await pickImportSource(picker);
    if (picked.status !== "selected") return picked;
    const read = await readImportSource(picked.absolutePath);
    if (read.status !== "ready") {
      return { status: "refused", reason: read.reason, message: read.message };
    }
    return { status: "ready", source: read.validation };
  });

  handle(IPC.books.delete, async (payload) => studio.requireLibrary().deleteBook(idSchema.parse(payload)));

  handle(IPC.books.search, async (payload) => {
    const input = z.object({ bookId: idSchema, query: z.string().trim().min(1).max(200) }).parse(payload);
    return studio.requireLibrary().search(input.bookId, input.query);
  });

  handle(IPC.books.update, async (payload) => {
    const input = z.object({ bookId: idSchema, patch: z.record(z.string(), z.unknown()) }).parse(payload);
    const allowed = ["title", "workingTitle", "description", "genres", "influences", "isErotica", "chapterRange", "outline", "storyArc", "characters", "memories", "stage", "settings", "frontMatter", "defaultProvider", "defaultConnectionId", "defaultModelId"];
    const patch = Object.fromEntries(Object.entries(input.patch).filter(([key]) => allowed.includes(key)));
    return studio.requireLibrary().updateBook(input.bookId, patch);
  });

  handle(IPC.books.exportDocx, async (payload) => {
    const bookId = idSchema.parse(payload);
    const library = studio.requireLibrary();
    const detail = await library.readBook(bookId);
    const illustrations = await collectDocxImages(detail, library);
    return exportManuscriptDocx(detail, illustrations, library.root, {
      /*
       * A headless run cannot answer a save dialog, so it names the folder instead. The hook
       * only exists for the checks: otherwise the export is never exercised end to end, and the
       * parts that go wrong are the ones nobody clicked.
       */
      pickDestination: async (suggestedName) => {
        const forced = process.env.STUDIO_EXPORT_PATH;
        if (forced) return join(forced, suggestedName);
        const options = {
          title: "Export manuscript",
          defaultPath: suggestedName,
          filters: [{ name: "Word document", extensions: ["docx"] }]
        };
        const window = getWindow();
        const choice = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options);
        if (choice.canceled || !choice.filePath) return null;
        return choice.filePath;
      },
      confirmReplace: async (path) => {
        const options = {
          type: "question" as const,
          buttons: ["Replace", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `“${basename(path)}” already exists. Replace it?`,
          detail: "The current file will be overwritten."
        };
        const window = getWindow();
        const answer = window
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options);
        return answer.response === 0;
      },
      statDestination: async (path) =>
        stat(path)
          .then((snapshot) => ({ mtimeMs: snapshot.mtimeMs, size: snapshot.size }))
          .catch(() => null)
    });
  });

  handle(IPC.books.exportMarkdown, async (payload) => {
    const bookId = idSchema.parse(payload);
    const library = studio.requireLibrary();
    const detail = await library.readBook(bookId);
    return exportManuscriptMarkdown(detail, library.root, {
      pickDestination: async (suggestedName) => {
        const forced = process.env.STUDIO_EXPORT_PATH;
        if (forced) return join(forced, suggestedName);
        const options = {
          title: "Export manuscript",
          defaultPath: suggestedName,
          filters: [{ name: "Markdown document", extensions: ["md", "markdown"] }]
        };
        const window = getWindow();
        const choice = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options);
        if (choice.canceled || !choice.filePath) return null;
        return choice.filePath;
      },
      confirmReplace: async (path) => {
        const options = {
          type: "question" as const,
          buttons: ["Replace", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `“${basename(path)}” already exists. Replace it?`,
          detail: "The current file will be overwritten."
        };
        const window = getWindow();
        const answer = window
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options);
        return answer.response === 0;
      },
      statDestination: async (path) =>
        stat(path)
          .then((snapshot) => ({ mtimeMs: snapshot.mtimeMs, size: snapshot.size }))
          .catch(() => null)
    });
  });

  /** The save dialog, replace prompt and file check behind the PDF and EPUB exports. */
  const manuscriptExportDeps = (filter: { name: string; extensions: string[] }): ExportDeps => ({
    // As with Word and Markdown, a headless run names the folder instead of answering a dialog.
    pickDestination: async (suggestedName) => {
      const forced = process.env.STUDIO_EXPORT_PATH;
      if (forced) return join(forced, suggestedName);
      const options = { title: "Export manuscript", defaultPath: suggestedName, filters: [filter] };
      const window = getWindow();
      const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return null;
      return choice.filePath;
    },
    confirmReplace: async (path) => {
      const options = {
        type: "question" as const,
        buttons: ["Replace", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `“${basename(path)}” already exists. Replace it?`,
        detail: "The current file will be overwritten."
      };
      const window = getWindow();
      const answer = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      return answer.response === 0;
    },
    statDestination: async (path) =>
      stat(path)
        .then((snapshot) => ({ mtimeMs: snapshot.mtimeMs, size: snapshot.size }))
        .catch(() => null)
  });

  handle(IPC.books.exportPdf, async (payload) => {
    const bookId = idSchema.parse(payload);
    const library = studio.requireLibrary();
    const detail = await library.readBook(bookId);
    const illustrations = await collectDocxImages(detail, library);
    return exportManuscriptPdf(detail, illustrations, library.root, {
      ...manuscriptExportDeps({ name: "PDF document", extensions: ["pdf"] }),
      renderPdf: renderPdfInHiddenWindow
    });
  });

  handle(IPC.books.exportEpub, async (payload) => {
    const bookId = idSchema.parse(payload);
    const library = studio.requireLibrary();
    const detail = await library.readBook(bookId);
    const illustrations = await collectDocxImages(detail, library);
    return exportManuscriptEpub(
      detail,
      illustrations,
      library.root,
      manuscriptExportDeps({ name: "EPUB e-book", extensions: ["epub"] })
    );
  });

  handle(IPC.books.exportImages, async (payload) => {
    const bookId = idSchema.parse(payload);
    const library = studio.requireLibrary();
    const detail = await library.readBook(bookId);
    return exportBookImages(detail, library, library.root, {
      // As with the manuscript exports, a headless run names the folder instead of answering a dialog.
      pickFolder: async (folderName) => {
        const forced = process.env.STUDIO_EXPORT_PATH;
        if (forced) return forced;
        const options = {
          title: "Export images",
          buttonLabel: "Export images",
          message: `The images go in a new folder named “${folderName}”.`,
          properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
        };
        const window = getWindow();
        const choice = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        const folder = choice.filePaths[0];
        if (choice.canceled || !folder) return null;
        return folder;
      },
      transcode: (bytes) => {
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));
        return image.isEmpty() ? null : image.toJPEG(90);
      }
    });
  });

  /* ----------------------------------------------------------------- chapters */

  handle(IPC.chapters.create, async (payload) => {
    const input = z.object({ bookId: idSchema, title: z.string().max(400).optional() }).parse(payload);
    return studio.requireLibrary().createChapter(input.bookId, { title: input.title });
  });

  handle(IPC.chapters.save, async (payload) => {
    const input = saveInput.parse(payload);
    return studio.requireLibrary().saveChapter(input.bookId, input.chapterId, input.content, {
      baseVersion: input.baseVersion,
      baseHash: input.baseHash
    });
  });

  handle(IPC.chapters.updateMeta, async (payload) => {
    const input = z
      .object({
        bookId: idSchema,
        chapterId: idSchema,
        patch: metaPatch,
        expected: z.object({ baseVersion: versionInput, baseHash: hashInput })
      })
      .parse(payload);
    return studio
      .requireLibrary()
      .updateChapterMeta(input.bookId, input.chapterId, input.patch, input.expected);
  });

  handle(IPC.chapters.reorder, async (payload) => {
    const input = z
      .object({ bookId: idSchema, chapterId: idSchema, direction: z.enum(["up", "down"]) })
      .parse(payload);
    return studio.requireLibrary().reorderChapter(input.bookId, input.chapterId, input.direction);
  });

  handle(IPC.chapters.move, async (payload) => {
    const input = z
      .object({ bookId: idSchema, chapterId: idSchema, targetIndex: z.number().int().min(0).max(10_000) })
      .parse(payload);
    return studio.requireLibrary().moveChapterTo(input.bookId, input.chapterId, input.targetIndex);
  });

  handle(IPC.chapters.delete, async (payload) => {
    const input = z.object({ bookId: idSchema, chapterId: idSchema }).parse(payload);
    await studio.requireLibrary().deleteChapter(input.bookId, input.chapterId);
    studio.drafts.clear(input.bookId, input.chapterId);
    return null;
  });

  /* ---------------------------------------------------------------- conflicts */

  handle(IPC.conflicts.list, async (payload) => studio.requireLibrary().listConflicts(idSchema.parse(payload)));

  handle(IPC.conflicts.reveal, async (payload) => {
    const input = z.object({ bookId: idSchema, savedAs: z.string().min(1).max(1024) }).parse(payload);
    const library = studio.requireLibrary();
    const target = safeJoin(library.root, input.savedAs);
    shell.showItemInFolder(target);
    return null;
  });

  /* ------------------------------------------------------------------- drafts */

  handle(IPC.drafts.set, async (payload) => {
    studio.drafts.set(saveInput.parse(payload));
    return null;
  });

  handle(IPC.drafts.clear, async (payload) => {
    const input = z.object({ bookId: idSchema, chapterId: idSchema }).parse(payload);
    studio.drafts.clear(input.bookId, input.chapterId);
    return null;
  });

  /* --------------------------------------------------------------------- sync */

  const sync = new SyncService(studio, settings);

  handle(IPC.sync.check, async () => sync.check());

  handle(IPC.sync.accept, async (payload) => {
    const paths = z.array(z.string().min(1).max(500)).max(500).parse(payload);
    return sync.accept(paths);
  });

  handle(IPC.sync.keepMine, async (payload) => {
    const input = z.object({ bookId: idSchema, chapterId: idSchema }).parse(payload);
    return sync.keepMine(input.bookId, input.chapterId);
  });

  handle(IPC.sync.discardDraft, async (payload) => {
    const input = z.object({ bookId: idSchema, chapterId: idSchema }).parse(payload);
    sync.discardDraft(input.bookId, input.chapterId);
    return null;
  });

  const syncSettings = (): SyncSettings => ({
    checkIntervalMinutes: settings.get().syncCheckIntervalMinutes ?? DEFAULT_SYNC_CHECK_INTERVAL_MINUTES,
    lastScanAt: settings.get().lastSyncScanAt ?? null
  });

  handle(IPC.sync.settings, async () => syncSettings());

  handle(IPC.sync.updateSettings, async (payload) => {
    const patch = z.object({ checkIntervalMinutes: z.number().min(1).max(1440).optional() }).parse(payload);
    if (patch.checkIntervalMinutes !== undefined) {
      await settings.update({ syncCheckIntervalMinutes: patch.checkIntervalMinutes });
    }
    return syncSettings();
  });

  /* --------------------------------------------------------------- providers */

  handle(IPC.providers.list, () => PROVIDER_LIST);

  handle(IPC.providers.models, async (payload) => providers.models(connectionId.parse(payload)));

  handle(IPC.providers.addModel, async (payload) => {
    const input = z.object({ connectionId, modelId: z.string().min(1).max(200) }).parse(payload);
    return providers.addModel(input.connectionId, input.modelId);
  });

  /* ------------------------------------------------------------- connections */

  handle(IPC.connections.list, async () => providers.list());

  handle(IPC.connections.available, async () => providers.available());

  handle(IPC.connections.status, async () => providers.status());

  handle(IPC.connections.check, async () => providers.check());

  handle(IPC.connections.addKey, async (payload) => {
    const input = z
      .object({
        provider: providerIdSchema,
        secret: z.string().min(8).max(4096),
        label: z.string().max(80).optional(),
        baseUrl: z.string().max(500).optional()
      })
      .parse(payload);
    return providers.addKey(input);
  });

  handle(IPC.connections.startOpenRouter, async () => providers.startOpenRouter());

  handle(IPC.connections.cancelOpenRouter, async () => {
    providers.cancelOpenRouter();
    return null;
  });

  handle(IPC.connections.remove, async (payload) => {
    await providers.remove(connectionId.parse(payload));
    return null;
  });

  handle(IPC.connections.test, async (payload) => providers.test(connectionId.parse(payload)));

  /* --------------------------------------------------------------------- usage */

  handle(IPC.usage.summary, async (payload) => {
    const bookId = idSchema.parse(payload);
    return new UsageStore(() => studio.library?.root ?? null).summary(bookId);
  });

  /* -------------------------------------------------------------------- agent */

  /**
   * The book's spending hooks evaluated against its usage log. Every warning is display-only:
   * nothing here blocks, refuses or retries a turn; enforcement waits on D-116.
   */
  const spendStatus = (
    agent: { perTurnCeilingUsd?: number | null; monthlyWarningUsd?: number | null },
    records: UsageRecord[]
  ): SpendingStatus => {
    const perTurnCeilingUsd = agent.perTurnCeilingUsd ?? null;
    const monthlyWarningUsd = agent.monthlyWarningUsd ?? null;
    const month = monthlySpend(records, new Date());
    const last = records.at(-1) ?? null;
    return {
      perTurnCeilingUsd,
      monthlyWarningUsd,
      monthToDateUsd: month.totalUsd,
      monthUnknownCostTurns: month.unknownCostTurns,
      lastTurnWarning: last ? turnCostWarning(last, perTurnCeilingUsd) : null,
      monthlyWarning: monthlyWarning(month, monthlyWarningUsd)
    };
  };

  /** Everything the app shows about a book's agent. */
  const agentStatus = async (bookId: string): Promise<AgentStatus> => {
    const library = studio.library;
    if (!library) throw new ProviderError("invalid-request", "No library is open in the studio.");
    const { book } = await library.readBook(bookId);
    const disabled = new Set(book.settings?.agent?.disabledTools ?? []);
    const catalog = await toolsBridge.catalog();
    const root = library.root;
    const usage = await new UsageStore(() => root).read(bookId);
    const cache = summarizeCache(
      usage.map((record) => ({
        cachedInputTokens: record.cachedInputTokens,
        inputTokens: record.inputTokens,
        // A provider that does not report a cache says so; that is "not reported", not "no cache"
        // (D-147).
        reported: record.cacheReported === true
      }))
    );
    const skills = await readBookSkills(root, bookId, true);
    const metrics = await new MetricsStore(() => root).summary(bookId);
    const counts = new Map(metrics.tools.map((tool) => [tool.name, tool]));
    return {
      tools: catalog.map((tool) => {
        const count = counts.get(tool.name);
        return {
          name: tool.name,
          description: tool.description,
          tier: tool.tier,
          enabled: !disabled.has(tool.name),
          calls: count?.calls ?? 0,
          successes: count?.successes ?? 0,
          failures: count?.failures ?? 0,
          successRate: count?.successRate ?? 0
        };
      }),
      toolTotals: metrics,
      tone: book.settings?.agent?.tone ?? "",
      answerLength: book.settings?.agent?.answerLength ?? "standard",
      spending: spendStatus(book.settings?.agent ?? {}, usage),
      skills: {
        present: skills !== null,
        enabled: book.settings?.agent?.skillsEnabled !== false,
        characters: skills?.text.length ?? 0
      },
      cache: { ...cache, mode: book.settings?.cache?.prefixMode ?? "auto" },
      plugins: await pluginStatus()
    };
  };

  handle(IPC.agent.status, async (payload) => agentStatus(idSchema.parse(payload)));

  handle(IPC.agent.setSettings, async (payload) => {
    const input = z
      .object({
        bookId: idSchema,
        patch: z.object({
          disabledTools: z.array(z.string().min(2).max(60)).max(64).optional(),
          skillsEnabled: z.boolean().optional(),
          tone: z.string().max(500).optional(),
          answerLength: z.enum(ANSWER_LENGTHS).optional(),
          perTurnCeilingUsd: z.number().positive().finite().nullable().optional(),
          monthlyWarningUsd: z.number().positive().finite().nullable().optional(),
          cachePrefixMode: z.enum(["off", "auto"]).optional()
        })
      })
      .parse(payload);
    const library = studio.requireLibrary();
    const { book } = await library.readBook(input.bookId);
    const agent = { ...book.settings.agent };
    const cache = { ...book.settings.cache };
    if (input.patch.disabledTools) agent.disabledTools = [...new Set(input.patch.disabledTools)];
    if (input.patch.skillsEnabled !== undefined) agent.skillsEnabled = input.patch.skillsEnabled;
    if (input.patch.tone !== undefined) agent.tone = input.patch.tone;
    if (input.patch.answerLength !== undefined) agent.answerLength = input.patch.answerLength;
    if (input.patch.perTurnCeilingUsd !== undefined) agent.perTurnCeilingUsd = input.patch.perTurnCeilingUsd;
    if (input.patch.monthlyWarningUsd !== undefined) agent.monthlyWarningUsd = input.patch.monthlyWarningUsd;
    if (input.patch.cachePrefixMode) cache.prefixMode = input.patch.cachePrefixMode;
    await library.updateBook(input.bookId, { settings: { ...book.settings, agent, cache } });
    return agentStatus(input.bookId);
  });

  handle(IPC.agent.glassesUrl, () => getBackend()?.glassesUrl ?? null);

  handle(IPC.agent.ambient, async (payload) => {
    const bookId = idSchema.parse(payload);
    return new AmbientService(() => studio.library, isWorking).status(bookId);
  });

  handle(IPC.agent.bridge, () => bridgeStatus());

  handle(IPC.agent.setBridge, async (payload) => {
    const enabled = z.boolean().parse(payload);
    if (enabled) {
      const addresses = localAddresses();
      const chosen = addresses[0];
      if (!chosen) {
        throw new ProviderError(
          "invalid-request",
          "This computer has no local network address, so there is nothing for a phone to reach."
        );
      }
      await bridge.start(chosen);
    } else {
      await bridge.stop();
    }
    return bridgeStatus();
  });

  handle(IPC.agent.choosePluginFolder, async () => {
    const window = getWindow();
    const options = {
      title: "Choose a plugin folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return null;
    return folder;
  });

  handle(IPC.agent.setPluginFolder, async (payload) => {
    const folder = payload === null ? null : z.string().min(1).max(4096).parse(payload);
    const problem = folder ? validatePluginFolder(folder) : null;
    if (problem) throw new ProviderError("invalid-request", problem);
    await settings.update({ pluginFolder: folder });
    return pluginStatus();
  });

  /* --------------------------------------------------------------------- voice */

  handle(IPC.voice.connections, () => voice.connections());

  const voiceInput = z.object({
    connectionId: connectionId.optional(),
    audio: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
    languageBias: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
    keywords: z.array(z.string().trim().min(1).max(80)).max(50).optional()
  });

  handle(IPC.voice.transcribe, async (payload) => {
    const input = voiceInput.parse(payload);
    return voice.transcribe({
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      audio: new Uint8Array(input.audio),
      ...(input.languageBias?.length ? { languageBias: input.languageBias } : {}),
      ...(input.keywords?.length ? { keywords: input.keywords } : {})
    });
  });

  handle(IPC.voice.speakers, async (): Promise<VoiceSpeakers> => {
    const available = await speech.connections();
    const first = available[0];
    if (!first) {
      return { available: false, connectionLabel: null, endpoint: null, model: null, voices: [] };
    }
    const credential = await providers.credential(first.id);
    const capability = ttsCapability(credential.provider, credential.metadata?.baseUrl);
    return {
      available: capability !== null,
      connectionLabel: first.label,
      endpoint: capability?.endpoint ?? null,
      model: capability?.model ?? null,
      voices: capability ? [...capability.voices] : []
    };
  });

  handle(IPC.voice.speak, async (payload) => {
    const input = speakInput.parse(payload);
    const result = await speech.speak({
      text: input.text,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.voice ? { voice: input.voice as never } : {}),
      ...(input.speed !== undefined ? { speed: input.speed } : {})
    });
    // The audio goes back as a data URL so the renderer can play it without a second request.
    const dataUrl = `data:${result.mimeType};base64,${Buffer.from(result.bytes).toString("base64")}`;
    return {
      dataUrl,
      mimeType: result.mimeType,
      characters: result.characters,
      chunks: result.chunks,
      connectionLabel: result.connectionLabel,
      model: result.model
    } satisfies SpokenReply;
  });

  /* -------------------------------------------------------------------- images */

  handle(IPC.images.list, async (payload) => {
    const bookId = idSchema.parse(payload);
    return studio.requireLibrary().listImages(bookId);
  });

  handle(IPC.images.read, async (payload) => {
    const input = z.object({ bookId: idSchema, imageId: imageIdSchema }).parse(payload);
    const stored = await studio.requireLibrary().readImage(input.bookId, input.imageId);
    if (!stored) return null;
    return {
      record: stored.record,
      dataUrl: `data:${stored.record.mimeType};base64,${Buffer.from(stored.bytes).toString("base64")}`
    };
  });

  const imageGenerateInput = z.object({
    bookId: idSchema,
    chapterId: idSchema.optional(),
    connectionId: connectionId.optional(),
    prompt: z.string().trim().min(1).max(4_000),
    size: z.enum(IMAGE_SIZES).optional()
  });

  handle(IPC.images.generate, async (payload) => {
    const input = imageGenerateInput.parse(payload);
    const generated = await images.generate({
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      prompt: input.prompt,
      ...(input.size ? { size: input.size } : {})
    });
    const library = studio.requireLibrary();
    const record = await library.addImage(input.bookId, {
      bytes: generated.bytes,
      kind: "chapter",
      prompt: input.prompt,
      provider: "meta",
      model: generated.model,
      size: generated.size,
      source: "generated",
      costUsd: generated.costUsd
    });
    return input.chapterId ? library.attachImage(input.bookId, record.id, input.chapterId) : record;
  });

  handle(IPC.images.attach, async (payload) => {
    const input = z
      .object({ bookId: idSchema, imageId: imageIdSchema, chapterId: idSchema })
      .parse(payload);
    return studio.requireLibrary().attachImage(input.bookId, input.imageId, input.chapterId);
  });

  handle(IPC.images.remove, async (payload) => {
    const input = z.object({ bookId: idSchema, imageId: imageIdSchema }).parse(payload);
    await studio.requireLibrary().removeImage(input.bookId, input.imageId);
    return null;
  });

  handle(IPC.images.saveCutout, async (payload) => {
    const input = z
      .object({
        bookId: idSchema,
        sourceImageId: imageIdSchema,
        bytes: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
        prompt: z.string().trim().min(1).max(200),
        confidence: z.number().min(0).max(1).nullable().optional(),
        characterId: z.string().regex(/^char_[A-Za-z0-9-]{6,}$/).nullable().optional()
      })
      .parse(payload);
    const library = studio.requireLibrary();
    const source = await library.readImage(input.bookId, input.sourceImageId);
    if (!source) throw new ProviderError("not-found", "The source image is missing from this book.");
    return library.addImage(input.bookId, {
      bytes: new Uint8Array(input.bytes),
      kind: "character",
      prompt: input.prompt,
      provider: "meta",
      model: "sam-3.1",
      size: "",
      source: "cutout",
      cutoutOf: input.sourceImageId,
      confidence: input.confidence ?? null,
      characterId: input.characterId ?? null
    });
  });

  handle(IPC.images.attachCharacter, async (payload) => {
    const input = z
      .object({
        bookId: idSchema,
        imageId: imageIdSchema,
        characterId: z.string().regex(/^char_[A-Za-z0-9-]{6,}$/)
      })
      .parse(payload);
    return studio.requireLibrary().attachCharacterImage(input.bookId, input.imageId, input.characterId);
  });

  handle(IPC.segmentation.segment, async (payload) => {
    const input = z
      .object({
        bookId: idSchema,
        imageId: imageIdSchema,
        connectionId: connectionId.optional(),
        prompt: z.string().trim().min(1).max(200)
      })
      .parse(payload);
    const stored = await studio.requireLibrary().readImage(input.bookId, input.imageId);
    if (!stored) throw new ProviderError("not-found", "The source image is missing from this book.");
    return segmentation.segment({
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      prompt: input.prompt,
      bytes: stored.bytes,
      mimeType: stored.record.mimeType
    });
  });

  /* --------------------------------------------------------------------- agent */

  const agentInput = z.object({
    bookId: idSchema,
    chapterId: idSchema.nullable().optional(),
    prompt: z.string().min(1).max(50_000),
    mode: agentModeSchema,
    guidance: agentGuidanceTextSchema.optional(),
    threadId: idSchema.nullable().optional(),
    background: z.boolean().optional(),
    model: z
      .object({
        connectionId: z.string().min(1).max(200),
        modelId: z.string().min(1).max(200)
      })
      .optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(100_000) }))
      .max(40)
      .optional()
  });

  handle(IPC.agent.start, async (payload) => agent.start(agentInput.parse(payload)));

  handle(IPC.agent.stop, async (payload) => agent.stop(z.string().min(1).max(80).parse(payload)));

  handle(IPC.agent.undoLast, async (payload) => agent.undoLast(idSchema.parse(payload)));

  handle(IPC.agent.approve, async (payload) => {
    const input = z
      .object({
        turnId: z.string().min(1).max(80),
        approvalId: z.string().min(1).max(200),
        approved: z.boolean()
      })
      .parse(payload);
    return agent.approve(input.turnId, input.approvalId, input.approved);
  });

  handle(IPC.agent.threads.list, async (payload) => studio.requireLibrary().threads.list(idSchema.parse(payload)));

  handle(IPC.agent.threads.read, async (payload) => {
    const input = z.object({ bookId: idSchema, threadId: idSchema }).parse(payload);
    return studio.requireLibrary().threads.read(input.bookId, input.threadId);
  });

  handle(IPC.agent.threads.rename, async (payload) => {
    const input = z
      .object({ bookId: idSchema, threadId: idSchema, title: z.string().trim().min(1).max(200) })
      .parse(payload);
    return studio.requireLibrary().threads.rename(input.bookId, input.threadId, input.title);
  });

  handle(IPC.agent.threads.remove, async (payload) => {
    const input = z.object({ bookId: idSchema, threadId: idSchema }).parse(payload);
    await studio.requireLibrary().threads.remove(input.bookId, input.threadId);
    return null;
  });

  handle(IPC.agent.threads.fork, async (payload) => {
    const input = z
      .object({ bookId: idSchema, threadId: idSchema, turnId: z.string().min(1).max(80) })
      .parse(payload);
    return studio.requireLibrary().threads.fork(input.bookId, input.threadId, input.turnId);
  });
}
