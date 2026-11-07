import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryService } from "@ai-book-studio/core/library/service";
import { createPlanningApi, planningHandler, planningValue } from "@ai-book-studio/core/library/planning-api";
import { createFileSystemEnvironment } from "../src/main/library/fs-port";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "w08-planning-storage-"));
  roots.push(root);
  const env = createFileSystemEnvironment(root);
  const library = await LibraryService.open(env);
  const book = await library.createBook({ title: "Synthetic filesystem planning" });
  const chapter = await library.createChapter(book.id, { title: "Synthetic", content: "one two" });
  const api = createPlanningApi(planningHandler(() => library));
  return { root, env, library, book, chapter, api };
}

describe("planning on the actual filesystem adapter", () => {
  test.each(["omitted", "symlink", "placeholder"] as const)("%s source cannot confirm a partial total", async (fault) => {
    const { root, env, library, book, chapter } = await fixture();
    if (fault === "omitted") {
      const list = env.storage.listDirectory.bind(env.storage);
      env.storage.listDirectory = async (path) => (await list(path)).filter((entry) => entry.name !== chapter.path);
    } else if (fault === "symlink") {
      await symlink(chapter.path, join(root, "books", book.id, "chapters", "0002-link.md"));
    } else {
      await writeFile(join(root, "books", book.id, "chapters", ".0002-pending.md.icloud"), "");
    }
    expect((await library.goals.progress(book.id)).status).toBe("unavailable");
  });

  test("zero-write no-op includes the filesystem journal; postpublication failure preserves phase and bytes", async () => {
    const { env, library, book, api } = await fixture();
    const base = await planningValue(api.readGoal(book.id));
    const commit = env.storage.commitFile.bind(env.storage);
    let commits = 0;
    env.storage.commitFile = (path, bytes, expected) => { commits++; return commit(path, bytes, expected); };
    expect((await planningValue(api.saveGoal({ bookId: book.id, source: base.source, baselineJson: base.baselineJson, draft: { kind: "set-goal", targetWords: null } }))).status).toBe("unchanged");
    expect(commits).toBe(0);
    let activeAttempts = 0;
    env.storage.commitFile = async (path, bytes, expected) => {
      const result = await commit(path, bytes, expected);
      if (path.at(-1) === "goals.json") { activeAttempts++; throw new Error("Synthetic lost response after publication"); }
      return result;
    };
    const result = await api.saveGoal({ bookId: book.id, source: base.source, baselineJson: base.baselineJson, draft: { kind: "set-goal", targetWords: 100 } });
    expect(result).toMatchObject({ ok: false, error: { outcome: "uncertain", phase: "active" } });
    expect(activeAttempts).toBe(1);
    expect((await library.goals.read(book.id)).data?.targetWords).toBe(100);
  });
});
