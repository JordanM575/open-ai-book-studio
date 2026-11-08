export function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export interface FakeFile {
  bytes: Uint8Array;
  lastModified: number;
}

export type FakeStage = "getFileHandle" | "createWritable" | "write" | "close";

export interface FakeHooks {
  /** Throw at one stage, to model a browser or folder failure. */
  fail?: (stage: FakeStage, name: string) => Error | undefined;
  /** Run after the swap file has been written but before close commits it. */
  afterWrite?: (name: string, directory: FakeDirectory) => void;
  /** Run after close commits, to model a writer racing the read-back. */
  afterClose?: (name: string, directory: FakeDirectory) => void;
  /** Instrument reads or simulate an inaccurate size when testing bounded slices. */
  onRead?: (name: string, method: "full" | "slice", size: number) => void;
  reportedSize?: (name: string, actualSize: number) => number;
}

export class FakeFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    private readonly directory: FakeDirectory
  ) {}

  async getFile(): Promise<File> {
    const file = this.directory.files.get(this.name);
    if (!file) throw domError("NotFoundError");
    return {
      name: this.name,
      size: this.directory.hooks.reportedSize?.(this.name, file.bytes.length) ?? file.bytes.length,
      lastModified: file.lastModified,
      type: "application/octet-stream",
      arrayBuffer: async () => {
        this.directory.hooks.onRead?.(this.name, "full", file.bytes.length);
        return file.bytes.slice().buffer;
      },
      slice: (start?: number, end?: number) => {
        const bytes = file.bytes.slice(start, end);
        this.directory.hooks.onRead?.(this.name, "slice", bytes.length);
        return new Blob([bytes as BlobPart]);
      },
      text: async () => new TextDecoder().decode(file.bytes)
    } as unknown as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const failure = this.directory.hooks.fail?.("createWritable", this.name);
    if (failure) throw failure;

    let pending: Uint8Array | null = null;
    const directory = this.directory;
    const name = this.name;

    return {
      async write(data: Uint8Array) {
        const error = directory.hooks.fail?.("write", name);
        if (error) throw error;
        pending = new Uint8Array(data);
        directory.hooks.afterWrite?.(name, directory);
      },
      async close() {
        const error = directory.hooks.fail?.("close", name);
        if (error) throw error;
        directory.files.set(name, { bytes: pending ?? new Uint8Array(), lastModified: Date.now() });
        pending = null;
        directory.hooks.afterClose?.(name, directory);
      },
      async abort() {
        pending = null;
      }
    } as unknown as FileSystemWritableFileStream;
  }
}

export class FakeDirectory {
  readonly kind = "directory";
  readonly files = new Map<string, FakeFile>();
  readonly directories = new Map<string, FakeDirectory>();
  hooks: FakeHooks = {};

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectory> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options.create) throw domError("NotFoundError");
    const directory = new FakeDirectory(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    const failure = this.hooks.fail?.("getFileHandle", name);
    if (failure) throw failure;
    if (!this.files.has(name)) {
      if (!options.create) throw domError("NotFoundError");
      this.files.set(name, { bytes: new Uint8Array(), lastModified: Date.now() });
    }
    return new FakeFileHandle(name, this);
  }

  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name)) return;
    if (this.directories.delete(name)) return;
    throw domError("NotFoundError");
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectory]> {
    for (const name of this.files.keys()) yield [name, new FakeFileHandle(name, this)];
    for (const [name, directory] of this.directories) yield [name, directory];
  }
}
