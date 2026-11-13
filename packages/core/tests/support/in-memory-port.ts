import { createHash } from "node:crypto";
import { LibraryPortError } from "../../src/library/errors";
import { toLibraryFilePath, toLibraryPath, validateLibraryPath } from "../../src/library/path";
import { effectiveReadLimit, readTooLarge } from "../../src/library/read-limits";
import type {
  CommitFileResult,
  FileExpectation,
  LibraryDeviceInfo,
  LibraryEntry,
  LibraryFileSnapshot,
  LibraryInspectedEntry,
  LibraryPath,
  LibraryPort,
  LibraryRuntime
} from "../../src/library/port";

function key(path: LibraryPath): string {
  return validateLibraryPath(path).join("/");
}

function fileKey(path: LibraryPath): string {
  return toLibraryFilePath(path).join("/");
}

function cloneSnapshot(snapshot: LibraryFileSnapshot): LibraryFileSnapshot {
  return { ...snapshot, bytes: new Uint8Array(snapshot.bytes) };
}

/** Test-only deterministic port. It is not imported by production application code. */
export class InMemoryLibraryPort implements LibraryPort, LibraryRuntime {
  private readonly files = new Map<string, LibraryFileSnapshot>();
  private readonly directories = new Set<string>([""]);
  private readonly watchers = new Set<{ prefix: string; callback: (path: LibraryPath) => void }>();
  private nextId = 1;

  constructor(
    private readonly device: LibraryDeviceInfo = {
      id: "device_test000001",
      name: "Test device",
      createdAt: "2026-10-24T00:00:00.000Z"
    },
    private readonly clock: () => string = () => "2026-10-24T00:00:00.000Z"
  ) {}

  async readFile(path: LibraryPath, options?: { maxBytes: number }): Promise<LibraryFileSnapshot | null> {
    const snapshot = this.files.get(fileKey(path));
    // With no requested limit this test port also models an unrelated external writer/reader.
    // Several preserved probes use that access to install and inspect malformed oversized files.
    const limit = options ? effectiveReadLimit(path, options) : undefined;
    if (snapshot && limit !== undefined && snapshot.bytes.byteLength > limit) throw readTooLarge();
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async listDirectory(path: LibraryPath): Promise<LibraryEntry[]> {
    const parent = key(path);
    const prefix = parent.length === 0 ? "" : `${parent}/`;
    const entries = new Map<string, LibraryEntry["kind"]>();

    for (const directory of this.directories) {
      if (directory === parent || !directory.startsWith(prefix)) continue;
      const remainder = directory.slice(prefix.length);
      if (remainder.length === 0) continue;
      const slash = remainder.indexOf("/");
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      if (entries.get(name) !== "directory") entries.set(name, "directory");
    }

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      if (remainder.length === 0) continue;
      const slash = remainder.indexOf("/");
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      const kind = slash === -1 ? "file" : "directory";
      if (entries.get(name) !== "directory") entries.set(name, kind);
    }

    return [...entries].map(([name, kind]) => ({ name, kind })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Same file and directory names as `listDirectory`. This port has no unsupported names.
   * A missing folder is empty, matching the desktop adapter's missing-folder result.
   */
  async inspectDirectory(path: LibraryPath): Promise<LibraryInspectedEntry[]> {
    return this.listDirectory(path);
  }

  async stat(path: LibraryPath): Promise<{ size: number; createdAt: string | null; modifiedAt: string | null } | null> {
    const snapshot = this.files.get(fileKey(path));
    return snapshot
      ? { size: snapshot.bytes.byteLength, createdAt: snapshot.createdAt, modifiedAt: snapshot.modifiedAt }
      : null;
  }

  async ensureDirectory(path: LibraryPath): Promise<void> {
    const target = key(path);
    const segments = target.length === 0 ? [] : target.split("/");
    let current: string[] = [];
    this.directories.add("");
    for (const segment of segments) {
      current = [...current, segment];
      this.directories.add(current.join("/"));
    }
  }

  async commitFile(path: LibraryPath, bytes: Uint8Array, expected: FileExpectation): Promise<CommitFileResult> {
    const target = fileKey(path);
    const current = this.files.get(target) ?? null;
    const limit = effectiveReadLimit(path);
    if (current && limit !== undefined && current.bytes.byteLength > limit) throw readTooLarge();
    const matches =
      expected.kind === "any"
        ? true
        : expected.kind === "absent"
          ? current === null
          : current?.sha256 === expected.value;

    if (!matches) return { status: "changed", current: current ? cloneSnapshot(current) : null };

    const copy = new Uint8Array(bytes);
    const now = this.now();
    const snapshot: LibraryFileSnapshot = {
      bytes: copy,
      sha256: await this.sha256(copy),
      createdAt: current?.createdAt ?? now,
      modifiedAt: now
    };
    this.files.set(target, snapshot);
    this.notify(target);
    return { status: "written", snapshot: cloneSnapshot(snapshot) };
  }

  async createImmutableFile(path: LibraryPath, bytes: Uint8Array): Promise<CommitFileResult> {
    const target = fileKey(path);
    // Compute the digest before the check-and-set, which then runs without an await between
    // the absence check and the insertion: that is this port's exclusive creation.
    const digest = createHash("sha256").update(bytes).digest("hex");
    const current = this.files.get(target) ?? null;
    if (current) return { status: "changed", current: cloneSnapshot(current) };
    const copy = new Uint8Array(bytes);
    const now = this.now();
    const snapshot: LibraryFileSnapshot = { bytes: copy, sha256: digest, createdAt: now, modifiedAt: now };
    this.files.set(target, snapshot);
    this.notify(target);
    return { status: "written", snapshot: cloneSnapshot(snapshot) };
  }

  async moveFile(from: LibraryPath, to: LibraryPath): Promise<void> {
    const source = fileKey(from);
    const destination = fileKey(to);
    const snapshot = this.files.get(source);
    if (!snapshot) throw new LibraryPortError("not-found", "The library file was not found.");
    if (this.files.has(destination)) throw new LibraryPortError("already-exists", "The destination already exists.");
    await this.ensureDirectory(toLibraryPath(destination.split("/").slice(0, -1)));
    this.files.set(destination, snapshot);
    this.files.delete(source);
    this.notify(source);
    this.notify(destination);
  }

  async moveDirectory(from: LibraryPath, to: LibraryPath): Promise<void> {
    const sourcePrefix = key(from);
    const destinationPrefix = key(to);
    const entries = [...this.files.entries()].filter(
      ([path]) => path === sourcePrefix || path.startsWith(`${sourcePrefix}/`)
    );
    if (entries.length === 0) throw new LibraryPortError("not-found", "The library folder was not found.");
    if ([...this.files.keys()].some((path) => path === destinationPrefix || path.startsWith(`${destinationPrefix}/`))) {
      throw new LibraryPortError("already-exists", "The destination already exists.");
    }
    await this.ensureDirectory(toLibraryPath(destinationPrefix.split("/").filter(Boolean)));
    for (const [path, snapshot] of entries) {
      this.files.set(`${destinationPrefix}${path.slice(sourcePrefix.length)}`, snapshot);
      this.files.delete(path);
    }
    for (const directory of [...this.directories]) {
      if (directory !== sourcePrefix && !directory.startsWith(`${sourcePrefix}/`)) continue;
      this.directories.add(`${destinationPrefix}${directory.slice(sourcePrefix.length)}`);
      this.directories.delete(directory);
    }
  }

  async removeDirectory(path: LibraryPath): Promise<void> {
    const prefix = key(path);
    const entries = [...this.files.keys()].filter(
      (file) => file === prefix || file.startsWith(`${prefix}/`)
    );
    if (entries.length === 0 && !this.directories.has(prefix)) {
      throw new LibraryPortError("not-found", "The library folder was not found.");
    }
    for (const file of entries) {
      this.files.delete(file);
      this.notify(file);
    }
    for (const directory of [...this.directories]) {
      if (directory === prefix || directory.startsWith(`${prefix}/`)) this.directories.delete(directory);
    }
  }

  async removeFile(path: LibraryPath): Promise<void> {
    const target = fileKey(path);
    if (!this.files.delete(target)) throw new LibraryPortError("not-found", "The library file was not found.");
    this.notify(target);
  }

  watch(path: LibraryPath, onChange: (changedPath: LibraryPath) => void): () => void {
    const watched = { prefix: key(path), callback: onChange };
    this.watchers.add(watched);
    return () => this.watchers.delete(watched);
  }

  async deviceInfo(): Promise<LibraryDeviceInfo> {
    return { ...this.device };
  }

  now(): string {
    return this.clock();
  }

  newId(prefix: string): string {
    return `${prefix}_${String(this.nextId++).padStart(8, "0")}`;
  }

  async sha256(bytes: Uint8Array): Promise<string> {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private notify(changed: string): void {
    const segments = changed ? changed.split("/") : [];
    for (const watcher of this.watchers) {
      if (watcher.prefix === "" || changed === watcher.prefix || changed.startsWith(`${watcher.prefix}/`)) {
        watcher.callback(toLibraryPath(segments));
      }
    }
  }
}
