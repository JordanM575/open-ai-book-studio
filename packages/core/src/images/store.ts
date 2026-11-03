import { LibraryError } from "../library/errors";
import { libraryPathToArchivePath, toLibraryPath } from "../library/path";
import type { LibraryEnvironment } from "../library/port";
import { imageFilePath, imagesPath, imageManifestPath, trashPath } from "../library/paths";
import { noteMovedPrefix, noteRemovedFiles, noteWrittenFiles } from "../sync/journal";
import {
  IMAGE_SCHEMA_VERSION,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PROMPT,
  imageExtension,
  imageManifestSchema,
  inspectImage,
  type ImageKind,
  type ImageManifest,
  type ImageRecord,
  type ImageSource
} from "./schema";

export interface ImageList {
  manifest: ImageManifest;
  warning: string | null;
}

export interface AddImageInput {
  bytes: Uint8Array;
  kind: ImageKind;
  prompt: string;
  provider: string;
  model: string;
  size?: string;
  source?: ImageSource;
  cutoutOf?: string | null;
  costUsd?: number | null;
  revisedPrompt?: string | null;
  confidence?: number | null;
  characterId?: string | null;
}

export interface StoredImage {
  record: ImageRecord;
  bytes: Uint8Array;
}

interface ManifestState {
  manifest: ImageManifest;
  hash: string | null;
  warning: string | null;
}

/**
 * The author-owned image store. The manifest is source, the files are source, and the library port
 * is the only writer. A failed image write never produces a manifest record; a failed manifest write
 * removes the new file when it can and otherwise leaves an orphan that the warning points at.
 */
export class ImageStore {
  private readonly writes = new Map<string, Promise<unknown>>();
  private notedDeviceId: string | null = null;

  constructor(private readonly env: LibraryEnvironment) {}

  /**
   * Fold this store's writes into the sync baseline so the next drift scan reads them as local.
   * Best-effort: the device id resolves lazily and a note failure never fails the write.
   */
  private async noteFiles(input: { written: string[]; removed: string[] }): Promise<void> {
    try {
      this.notedDeviceId ??= (await this.env.storage.deviceInfo()).id;
      const now = this.env.runtime.now();
      await noteWrittenFiles({ storage: this.env.storage, deviceId: this.notedDeviceId, paths: input.written, now });
      await noteRemovedFiles({ storage: this.env.storage, deviceId: this.notedDeviceId, paths: input.removed, now });
    } catch {
      // Detection degrades to a reviewable report.
    }
  }

  async list(bookId: string): Promise<ImageList> {
    const state = await this.readManifest(bookId);
    return { manifest: state.manifest, warning: state.warning };
  }

  async read(bookId: string, imageId: string): Promise<StoredImage | null> {
    const state = await this.readManifest(bookId);
    const record = state.manifest.images.find((image) => image.id === imageId);
    if (!record) return null;
    const snapshot = await this.env.storage.readFile(imageFilePath(bookId, record.fileName));
    if (!snapshot) {
      throw new LibraryError("not-found", `The image file ${record.fileName} is missing from this book.`);
    }
    if (snapshot.bytes.byteLength !== record.bytes || snapshot.sha256 !== record.sha256) {
      throw new LibraryError("format", `The image file ${record.fileName} changed outside the studio.`);
    }
    return { record, bytes: snapshot.bytes };
  }

  async add(bookId: string, input: AddImageInput): Promise<ImageRecord> {
    return this.serialize(bookId, async () => {
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new LibraryError("invalid", "The image must be between 1 byte and 20 MB.");
      }
      if (input.prompt.length > MAX_IMAGE_PROMPT) {
        throw new LibraryError("invalid", `The prompt must be at most ${MAX_IMAGE_PROMPT.toLocaleString()} characters.`);
      }
      const inspection = inspectImage(input.bytes);
      if (!inspection) {
        throw new LibraryError("format", "That file is not a complete PNG, WebP or JPEG image.");
      }

      const state = await this.readManifest(bookId);
      if (state.warning) {
        throw new LibraryError(
          "format",
          "The image manifest is unreadable. Repair or remove images.json before adding an image."
        );
      }
      const id = this.env.runtime.newId("img");
      const fileName = `${id}.${imageExtension(inspection.format)}`;
      await this.env.storage.ensureDirectory(imagesPath(bookId));
      const written = await this.env.storage.commitFile(
        imageFilePath(bookId, fileName),
        input.bytes,
        { kind: "absent" }
      );
      if (written.status !== "written") {
        throw new LibraryError("io", "The image file could not be written. Nothing was added.");
      }
      await this.noteFiles({
        written: [libraryPathToArchivePath(imageFilePath(bookId, fileName))],
        removed: []
      });

      const record: ImageRecord = {
        id,
        kind: input.kind,
        chapterId: null,
        characterId: input.characterId ?? null,
        fileName,
        mimeType: inspection.mimeType,
        width: inspection.width,
        height: inspection.height,
        bytes: input.bytes.byteLength,
        sha256: written.snapshot.sha256,
        prompt: input.prompt,
        provider: input.provider,
        model: input.model,
        size: input.size ?? "",
        source: input.source ?? "generated",
        createdAt: this.env.runtime.now(),
        cutoutOf: input.cutoutOf ?? null,
        costUsd: input.costUsd ?? null,
        revisedPrompt: input.revisedPrompt ?? null,
        confidence: input.confidence ?? null
      };
      const next: ImageManifest = {
        ...state.manifest,
        images: [...state.manifest.images, record]
      };
      try {
        await this.commitManifest(bookId, next, state.hash);
      } catch (error) {
        await this.env.storage.removeFile(imageFilePath(bookId, fileName)).catch(() => {});
        throw error;
      }
      return record;
    });
  }

  /** Attach one image to a chapter and detach any earlier image on that chapter. */
  async attach(bookId: string, imageId: string, chapterId: string): Promise<ImageRecord> {
    return this.serialize(bookId, async () => {
      const state = await this.readManifest(bookId);
      const target = state.manifest.images.find((image) => image.id === imageId);
      if (!target) throw new LibraryError("not-found", "That image is not in this book.");
      const images = state.manifest.images.map((image) => {
        if (image.id === imageId) return { ...image, chapterId };
        if (image.chapterId === chapterId) return { ...image, chapterId: null };
        return image;
      });
      await this.commitManifest(bookId, { ...state.manifest, images }, state.hash);
      return images.find((image) => image.id === imageId)!;
    });
  }

  /** Attach a character image or cutout to a cast member. */
  async attachCharacter(bookId: string, imageId: string, characterId: string): Promise<ImageRecord> {
    return this.serialize(bookId, async () => {
      const state = await this.readManifest(bookId);
      const target = state.manifest.images.find((image) => image.id === imageId);
      if (!target) throw new LibraryError("not-found", "That image is not in this book.");
      if (target.kind !== "character") {
        throw new LibraryError("invalid", "Only a character image can be attached to a cast member.");
      }
      const images = state.manifest.images.map((image) =>
        image.id === imageId ? { ...image, characterId } : image
      );
      await this.commitManifest(bookId, { ...state.manifest, images }, state.hash);
      return images.find((image) => image.id === imageId)!;
    });
  }

  /** Move an image file to the library trash and remove its record. */
  async remove(bookId: string, imageId: string): Promise<void> {
    await this.serialize(bookId, async () => {
      const state = await this.readManifest(bookId);
      const target = state.manifest.images.find((image) => image.id === imageId);
      if (!target) throw new LibraryError("not-found", "That image is not in this book.");
      const destination = `${this.env.runtime.now().replace(/[:.]/g, "-")}-${target.fileName}`;
      const folder = trashPath(bookId);
      const trashImages = toLibraryPath([...folder, "images"]);
      await this.env.storage.ensureDirectory(trashImages);
      const from = imageFilePath(bookId, target.fileName);
      const to = toLibraryPath([...trashImages, destination]);
      await this.env.storage.moveFile(from, to);
      try {
        this.notedDeviceId ??= (await this.env.storage.deviceInfo()).id;
        await noteMovedPrefix({
          storage: this.env.storage,
          deviceId: this.notedDeviceId,
          from: libraryPathToArchivePath(from),
          to: libraryPathToArchivePath(to),
          now: this.env.runtime.now()
        });
      } catch {
        // Detection degrades to a reviewable report.
      }
      try {
        await this.commitManifest(
          bookId,
          { ...state.manifest, images: state.manifest.images.filter((image) => image.id !== imageId) },
          state.hash
        );
      } catch (error) {
        await this.env.storage.moveFile(to, from).catch(() => {});
        throw error;
      }
    });
  }

  private async readManifest(bookId: string): Promise<ManifestState> {
    const snapshot = await this.env.storage.readFile(imageManifestPath(bookId));
    if (!snapshot) {
      return {
        manifest: { schemaVersion: IMAGE_SCHEMA_VERSION, images: [] },
        hash: null,
        warning: null
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(snapshot.bytes));
    } catch {
      return {
        manifest: { schemaVersion: IMAGE_SCHEMA_VERSION, images: [] },
        hash: snapshot.sha256,
        warning: "images.json is not valid JSON. The image files are still on disk."
      };
    }
    const version = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === "number" && version > IMAGE_SCHEMA_VERSION) {
      throw new LibraryError("newer-schema", "This book's image manifest was written by a newer version of AI Book Studio.");
    }
    const result = imageManifestSchema.safeParse(parsed);
    if (!result.success) {
      return {
        manifest: { schemaVersion: IMAGE_SCHEMA_VERSION, images: [] },
        hash: snapshot.sha256,
        warning: "images.json has an unexpected shape. The image files are still on disk."
      };
    }
    return { manifest: result.data, hash: snapshot.sha256, warning: null };
  }

  private async commitManifest(bookId: string, manifest: ImageManifest, previousHash: string | null): Promise<void> {
    const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const result = await this.env.storage.commitFile(
      imageManifestPath(bookId),
      bytes,
      previousHash ? { kind: "sha256", value: previousHash } : { kind: "absent" }
    );
    if (result.status !== "written") {
      throw new LibraryError("io", "The image manifest changed while it was being saved. Try again.");
    }
    await this.noteFiles({
      written: [libraryPathToArchivePath(imageManifestPath(bookId))],
      removed: []
    });
  }

  private serialize<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(bookId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.writes.set(bookId, next);
    void next.finally(() => {
      if (this.writes.get(bookId) === next) this.writes.delete(bookId);
    }).catch(() => {});
    return next;
  }
}
