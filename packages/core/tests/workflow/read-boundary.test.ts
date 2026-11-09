import { describe, expect, test } from "bun:test";
import { encodeWorkflowRecord, WORKFLOW_LIMITS, type WorkflowRecord } from "../../src/authoring/wire";
import { LibraryPortError } from "../../src/library/errors";
import type { LibraryPath } from "../../src/library/port";
import { readSyncJournal } from "../../src/sync/journal";
import { artifactBodyPath, artifactMetaPath, taskPath, workflowConflictsPath } from "../../src/workflow/paths";
import { artifactMetadata, makeBook, runId, taskRecord } from "./record-fixtures";

const encoder = new TextEncoder();
const key = (path: LibraryPath) => path.join("/");
const wire = (value: unknown) => encodeWorkflowRecord(value as WorkflowRecord);

describe("workflow bounded read races", () => {
  for (const operation of ["read", "save"] as const) {
    test(`a task replacement after stat is refused before returning bytes on ${operation}`, async () => {
      const { port, library, book } = await makeBook();
      const task = taskRecord(book.id);
      const initial = await library.workflowRecords.saveTask(book.id, runId, task);
      const path = taskPath(book.id, runId, task.id);
      const originalStat = port.stat.bind(port);
      const originalRead = port.readFile.bind(port);
      const originalCommit = port.commitFile.bind(port);
      const replacement = new Uint8Array(WORKFLOW_LIMITS.recordBytes + 1).fill(88);
      let swapped = false;
      let boundedReads = 0;
      let returnedBytes = 0;
      let activeCommits = 0;
      port.stat = async (p) => {
        const before = await originalStat(p);
        if (!swapped && key(p) === key(path) && before) {
          expect(before.size).toBe(initial.record.bytes.byteLength);
          swapped = true;
          expect((await originalCommit(path, replacement, { kind: "sha256", value: initial.record.hash })).status).toBe("written");
        }
        return before;
      };
      port.readFile = async (p, options) => {
        if (key(p) === key(path)) {
          expect(options?.maxBytes).toBe(WORKFLOW_LIMITS.recordBytes);
          boundedReads++;
        }
        const snapshot = await originalRead(p, options);
        if (key(p) === key(path)) returnedBytes += snapshot?.bytes.byteLength ?? 0;
        return snapshot;
      };
      port.commitFile = async (p, bytes, expected) => {
        if (key(p) === key(path)) activeCommits++;
        return originalCommit(p, bytes, expected);
      };
      const update = { ...task, revision: 2, base: { kind: "sha256", value: initial.record.hash, revision: 1 } };
      await expect(operation === "read"
        ? library.workflowRecords.readTask(book.id, runId, task.id)
        : library.workflowRecords.saveTask(book.id, runId, update)).rejects.toMatchObject({ code: "too-large" });
      expect(swapped).toBe(true);
      expect(boundedReads).toBe(1);
      expect(returnedBytes).toBe(0);
      expect(activeCommits).toBe(0);
      expect((await originalRead(path))?.bytes).toEqual(replacement);
      expect(await port.listDirectory(workflowConflictsPath(book.id, runId))).toHaveLength(0);
    });
  }

  for (const extension of ["md", "json"] as const) {
    for (const operation of ["read", "create"] as const) {
      test(`a ${extension} artifact replacement after stat is bounded on ${operation}`, async () => {
        const { port, library, book } = await makeBook();
        const body = encoder.encode("Synthetic artifact body.");
        const metadata = artifactMetadata(book.id, body, {
          mediaType: extension === "md" ? "text/markdown" : "application/json"
        });
        await library.workflowRecords.createArtifact(book.id, runId, metadata, body);
        const path = artifactBodyPath(book.id, runId, metadata.id, extension);
        const metaPath = artifactMetaPath(book.id, runId, metadata.id);
        const originalRead = port.readFile.bind(port);
        const originalStat = port.stat.bind(port);
        const originalCommit = port.commitFile.bind(port);
        const before = await originalRead(path);
        const metaBefore = await originalRead(metaPath);
        if (!before || !metaBefore) throw new Error("Missing synthetic artifact");
        const replacement = new Uint8Array(WORKFLOW_LIMITS.artifactBytes + 1).fill(89);
        let swapped = false;
        let boundedReads = 0;
        let returnedBytes = 0;
        let workflowCommits = 0;
        port.stat = async (p) => {
          const observed = await originalStat(p);
          if (!swapped && key(p) === key(path) && observed) {
            expect(observed.size).toBe(body.byteLength);
            swapped = true;
            expect((await originalCommit(path, replacement, { kind: "sha256", value: before.sha256 })).status).toBe("written");
          }
          return observed;
        };
        port.readFile = async (p, options) => {
          if (key(p) === key(path)) {
            expect(options?.maxBytes).toBe(WORKFLOW_LIMITS.artifactBytes);
            boundedReads++;
          }
          const snapshot = await originalRead(p, options);
          if (key(p) === key(path)) returnedBytes += snapshot?.bytes.byteLength ?? 0;
          return snapshot;
        };
        port.commitFile = async (p, bytes, expected) => {
          if (p.includes("workflows")) workflowCommits++;
          return originalCommit(p, bytes, expected);
        };
        await expect(operation === "read"
          ? library.workflowRecords.readArtifact(book.id, runId, metadata.id)
          : library.workflowRecords.createArtifact(book.id, runId, metadata, body)).rejects.toMatchObject({ code: "too-large" });
        expect(swapped).toBe(true);
        expect(boundedReads).toBe(1);
        expect(returnedBytes).toBe(0);
        expect(workflowCommits).toBe(0);
        expect((await originalRead(path))?.bytes).toEqual(replacement);
        expect(await originalRead(metaPath)).toEqual(metaBefore);
        expect(await port.listDirectory(workflowConflictsPath(book.id, runId))).toHaveLength(0);
      });
    }

    test(`a ${extension} body growing before the final pair read remains uncertain without replay`, async () => {
      const { port, library, book } = await makeBook();
      const body = encoder.encode("Synthetic artifact body.");
      const metadata = artifactMetadata(book.id, body, {
        mediaType: extension === "md" ? "text/markdown" : "application/json"
      });
      const bodyPath = artifactBodyPath(book.id, runId, metadata.id, extension);
      const metaPath = artifactMetaPath(book.id, runId, metadata.id);
      const replacement = new Uint8Array(WORKFLOW_LIMITS.artifactBytes + 1).fill(89);
      const originalStat = port.stat.bind(port);
      const originalRead = port.readFile.bind(port);
      const originalCommit = port.commitFile.bind(port);
      let metadataPublished = false;
      let swapped = false;
      let bodyCommits = 0;
      let metaCommits = 0;
      let boundedFailure = false;
      port.commitFile = async (path, bytes, expected) => {
        const result = await originalCommit(path, bytes, expected);
        if (key(path) === key(bodyPath)) bodyCommits++;
        if (key(path) === key(metaPath)) {
          metaCommits++;
          metadataPublished = result.status === "written";
        }
        return result;
      };
      port.stat = async (path) => {
        const observed = await originalStat(path);
        if (metadataPublished && !swapped && key(path) === key(bodyPath) && observed) {
          expect(observed.size).toBe(body.byteLength);
          const current = await originalRead(bodyPath);
          if (!current) throw new Error("Missing synthetic artifact body");
          swapped = true;
          expect((await originalCommit(bodyPath, replacement, { kind: "sha256", value: current.sha256 })).status).toBe("written");
        }
        return observed;
      };
      port.readFile = async (path, options) => {
        if (swapped && key(path) === key(bodyPath)) {
          expect(options?.maxBytes).toBe(WORKFLOW_LIMITS.artifactBytes);
          try {
            return await originalRead(path, options);
          } catch (error) {
            boundedFailure = error instanceof LibraryPortError && error.code === "too-large";
            throw error;
          }
        }
        return originalRead(path, options);
      };
      await expect(library.workflowRecords.createArtifact(book.id, runId, metadata, body))
        .rejects.toMatchObject({ code: "uncertain" });
      expect(swapped).toBe(true);
      expect(boundedFailure).toBe(true);
      expect(bodyCommits).toBe(1);
      expect(metaCommits).toBe(1);
      expect((await originalRead(bodyPath))?.bytes).toEqual(replacement);
      expect(await originalRead(metaPath)).not.toBeNull();
      expect(await port.listDirectory(workflowConflictsPath(book.id, runId))).toHaveLength(0);
    });
  }
});

describe("verified workflow journal attribution", () => {
  for (const kind of ["task", "artifact"] as const) {
    for (const history of ["new", "existing"] as const) {
      test(`${kind}, ${history} journal path: an external post-readback replacement stays reviewable`, async () => {
        const { port, library, book } = await makeBook();
        const body = encoder.encode("Synthetic candidate body.");
        const task = taskRecord(book.id);
        const metadata = artifactMetadata(book.id, body);
        const path = kind === "task" ? taskPath(book.id, runId, task.id) : artifactMetaPath(book.id, runId, metadata.id);
        const target = key(path);
        let intended: unknown = kind === "task" ? task : metadata;
        if (history === "existing") {
          if (kind === "task") {
            const first = await library.workflowRecords.saveTask(book.id, runId, task);
            intended = { ...task, revision: 2, base: { kind: "sha256", value: first.record.hash, revision: 1 } };
          } else {
            await library.workflowRecords.createArtifact(book.id, runId, metadata, body);
            // A previously observed pair can disappear outside the studio before a new absent-only creation.
            await port.removeFile(path);
            await port.removeFile(artifactBodyPath(book.id, runId, metadata.id, "md"));
          }
        }
        const previous = (await readSyncJournal(port, library.deviceId))?.files[target];
        expect(Boolean(previous)).toBe(history === "existing");
        const external = wire({ ...(intended as object), externalAttribution: "outside replacement" });
        const later = wire({ ...(intended as object), externalAttribution: "later outside replacement" });
        const originalCommit = port.commitFile.bind(port);
        let intendedHash = "";
        let externalHash = "";
        let commits = 0;
        port.commitFile = async (p, bytes, expected) => {
          const result = await originalCommit(p, bytes, expected);
          if (key(p) === target && result.status === "written") {
            commits++;
            intendedHash = result.snapshot.sha256;
            const replacement = await originalCommit(path, external, { kind: "sha256", value: intendedHash });
            if (replacement.status !== "written") throw new Error("Synthetic replacement failed");
            externalHash = replacement.snapshot.sha256;
          }
          return result;
        };
        const operation = kind === "task"
          ? library.workflowRecords.saveTask(book.id, runId, intended)
          : library.workflowRecords.createArtifact(book.id, runId, intended, body);
        if (kind === "task") expect((await operation).status).toBe("saved");
        else await expect(operation).rejects.toMatchObject({ code: "uncertain" });
        expect(commits).toBe(1);
        expect(intendedHash).not.toBe(externalHash);
        expect((await port.readFile(path))?.bytes).toEqual(external);
        const record = (await readSyncJournal(port, library.deviceId))?.files[target];
        expect(record?.sha256).toBe(intendedHash);
        expect(record?.writtenSha256).toBe(intendedHash);
        expect((await library.checkDrift()).entries.find((entry) => entry.path === target)?.kind).toBe("remote-changed");
        expect((await originalCommit(path, later, { kind: "sha256", value: externalHash })).status).toBe("written");
        expect((await library.checkDrift()).entries.find((entry) => entry.path === target)?.kind).toBe("remote-changed");
        expect(commits).toBe(1);
      });
    }
  }

  for (const history of ["new", "existing"] as const) {
    test(`${history} task removed after verified readback stays reviewable`, async () => {
      const { port, library, book } = await makeBook();
      const task = taskRecord(book.id);
      const path = taskPath(book.id, runId, task.id);
      let intended: unknown = task;
      if (history === "existing") {
        const initial = await library.workflowRecords.saveTask(book.id, runId, task);
        intended = { ...task, revision: 2, base: { kind: "sha256", value: initial.record.hash, revision: 1 } };
      }
      const originalCommit = port.commitFile.bind(port);
      let intendedHash = "";
      let commits = 0;
      port.commitFile = async (candidate, bytes, expected) => {
        const result = await originalCommit(candidate, bytes, expected);
        if (key(candidate) === key(path) && result.status === "written") {
          commits++;
          intendedHash = result.snapshot.sha256;
          await port.removeFile(path);
        }
        return result;
      };
      expect((await library.workflowRecords.saveTask(book.id, runId, intended)).status).toBe("saved");
      expect(commits).toBe(1);
      const record = (await readSyncJournal(port, library.deviceId))?.files[key(path)];
      expect(record?.sha256).toBe(intendedHash);
      expect(record?.writtenSha256).toBe(intendedHash);
      expect((await library.checkDrift()).entries.find((entry) => entry.path === key(path))?.kind).toBe("remote-deleted");
    });
  }

  for (const kind of ["task", "artifact"] as const) {
    for (const fault of ["mismatch", "failure"] as const) {
      test(`${kind}: ${fault} after publication never attributes an unverified readback`, async () => {
        const { port, library, book } = await makeBook();
        const body = encoder.encode("Synthetic candidate body.");
        const intended = kind === "task" ? taskRecord(book.id) : artifactMetadata(book.id, body);
        const path = kind === "task" ? taskPath(book.id, runId, intended.id) : artifactMetaPath(book.id, runId, intended.id);
        const target = key(path);
        const external = wire({ ...intended, externalAttribution: "unverified replacement" });
        const originalCommit = port.commitFile.bind(port);
        let commits = 0;
        port.commitFile = async (p, bytes, expected) => {
          const result = await originalCommit(p, bytes, expected);
          if (key(p) !== target || result.status !== "written") return result;
          commits++;
          const replacement = await originalCommit(path, external, { kind: "sha256", value: result.snapshot.sha256 });
          if (replacement.status !== "written") throw new Error("Synthetic replacement failed");
          if (fault === "failure") throw new LibraryPortError("too-large", "Synthetic readback failure");
          return replacement;
        };
        const operation = kind === "task"
          ? library.workflowRecords.saveTask(book.id, runId, intended)
          : library.workflowRecords.createArtifact(book.id, runId, intended, body);
        await expect(operation).rejects.toMatchObject({ code: "uncertain" });
        expect(commits).toBe(1);
        expect((await port.readFile(path))?.bytes).toEqual(external);
        expect((await readSyncJournal(port, library.deviceId))?.files[target]).toBeUndefined();
        expect((await library.checkDrift()).entries.find((entry) => entry.path === target)?.kind).toBe("new-remote");
      });
    }
  }

  test("oversized post-readback replacement is bounded in the note and drift scan", async () => {
    const { port, library, book } = await makeBook();
    const task = taskRecord(book.id);
    const path = taskPath(book.id, runId, task.id);
    const target = key(path);
    const oversized = new Uint8Array(WORKFLOW_LIMITS.recordBytes + 1).fill(90);
    const originalCommit = port.commitFile.bind(port);
    const originalRead = port.readFile.bind(port);
    let intendedHash = "";
    let targetReads = 0;
    port.commitFile = async (p, bytes, expected) => {
      const result = await originalCommit(p, bytes, expected);
      if (key(p) === target && result.status === "written") {
        intendedHash = result.snapshot.sha256;
        expect((await originalCommit(path, oversized, { kind: "sha256", value: intendedHash })).status).toBe("written");
      }
      return result;
    };
    port.readFile = async (p, options) => {
      if (key(p) === target) {
        targetReads++;
        expect(options?.maxBytes).toBe(WORKFLOW_LIMITS.recordBytes);
      }
      return originalRead(p, options);
    };
    expect((await library.workflowRecords.saveTask(book.id, runId, task)).status).toBe("saved");
    expect(targetReads).toBe(1); // The journal's later observation, not the verified commit snapshot.
    expect((await readSyncJournal(port, library.deviceId))?.files[target]?.sha256).toBe(intendedHash);
    expect((await library.checkDrift()).entries.find((entry) => entry.path === target)?.kind).toBe("unreadable");
    expect(targetReads).toBe(2);
    expect((await originalRead(path))?.bytes).toEqual(oversized);
  });
});
