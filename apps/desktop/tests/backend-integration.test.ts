import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import { Library } from "../src/main/library/store";
import { LocalBackend } from "../src/main/backend";
import { ToolBridge } from "../src/main/agent/tool-bridge";
import { BackendClient } from "../../toolkit/src/backend-client";
import { McpServer, serveMcp } from "../../toolkit/src/mcp";

let directory = "";
let library: Library;
let backend: LocalBackend;
let client: BackendClient;
let bookId = "";
let chapterId = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-toolkit-e2e-"));
  library = await Library.open(directory);
  const book = await library.createBook({ title: "Toolkit Book", description: "End-to-end" });
  const chapter = await library.createChapter(book.id, { title: "One", content: "First text.\n" });
  bookId = book.id;
  chapterId = chapter.id;

  const tools = new ToolBridge(() => library);
  backend = new LocalBackend(
    {
      current: () => ({ root: library.root, deviceId: library.deviceId, deviceName: library.deviceName }),
      requireLibrary: () => library
    },
    { locatorPath: join(directory, "backend.json"), token: "integration-token", port: 0, tools }
  );
  const started = await backend.start();
  client = new BackendClient({ url: started.url, token: started.token });
});

afterAll(async () => {
  await backend.stop();
  await rm(directory, { recursive: true, force: true });
});

describe("toolkit against a real library", () => {
  test("lists the book and reads the chapter", async () => {
    const books = await client.books();
    expect(books.map((book) => book.id)).toContain(bookId);
    const chapter = await client.chapter(bookId, chapterId);
    expect(chapter.content).toBe("First text.\n");
  });

  test("saves with the real version and hash, then reports a stale write as a conflict", async () => {
    const chapter = await client.chapter(bookId, chapterId);
    const saved = await client.saveChapter(bookId, chapterId, {
      content: "Revised text.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(saved.status).toBe("saved");
    expect((await client.chapter(bookId, chapterId)).content).toBe("Revised text.\n");

    const stale = await client.saveChapter(bookId, chapterId, {
      content: "Stale text.\n",
      baseVersion: chapter.version,
      baseHash: chapter.hash
    });
    expect(stale.status).toBe("conflict");
    if (stale.status === "conflict") expect(stale.conflict.reason).toBe("newer-version");
  });

  test("searches the real library through the backend", async () => {
    const hits = await client.search(bookId, "Revised");
    expect(hits.some((hit) => hit.chapterId === chapterId)).toBe(true);
  });

  test("serves the studio's own tool catalog", async () => {
    const tools = await client.tools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("read_story_bible");
    expect(names).toContain("append_to_chapter");
    expect(tools.find((tool) => tool.name === "read_story_bible")?.tier).toBe("read");
    expect(tools.find((tool) => tool.name === "append_to_chapter")?.tier).toBe("write");
    expect(tools.find((tool) => tool.name === "overwrite_chapter")?.tier).toBe("destructive");
  });

  test("runs a studio tool against the real library and changes the file on disk", async () => {
    const result = (await client.callTool(bookId, "append_to_chapter", {
      chapterId,
      text: "The lighthouse answered."
    })) as { ok: boolean; message: string };
    expect(result.ok).toBe(true);

    const chapter = await client.chapter(bookId, chapterId);
    expect(chapter.content).toContain("The lighthouse answered.");
    expect(chapter.version).toBeGreaterThan(1);
  });

  test("refuses a destructive tool without the explicit opt-in", async () => {
    await expect(
      client.callTool(bookId, "overwrite_chapter", { chapterId, content: "Gone.\n" })
    ).rejects.toThrow(/destructive/i);
    const chapter = await client.chapter(bookId, chapterId);
    expect(chapter.content).not.toBe("Gone.\n");
  });

  test("runs a destructive tool when the caller opts in", async () => {
    const result = (await client.callTool(
      bookId,
      "overwrite_chapter",
      { chapterId, content: "Replaced.\n" },
      { allowDestructive: true }
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect((await client.chapter(bookId, chapterId)).content).toBe("Replaced.\n");
  });

  test("rejects arguments that do not fit the tool's schema", async () => {
    await expect(
      client.callTool(bookId, "append_to_chapter", { chapterId })
    ).rejects.toThrow(/arguments/i);
  });

  test("a third-party MCP client can drive the book end to end", async () => {
    const lines: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      }
    });
    const server = new McpServer(client, { allowWrites: true });
    await serveMcp(
      server,
      Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "append_to_chapter",
            arguments: { bookId, chapterId, text: "A line from another agent." }
          }
        }) + "\n"
      ]),
      output
    );

    const listed = JSON.parse(lines[1]!) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toContain("append_to_chapter");

    const called = JSON.parse(lines[2]!) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(called.result.content[0]!.text).ok).toBe(true);

    const chapter = await client.chapter(bookId, chapterId);
    expect(chapter.content).toContain("A line from another agent.");
  });
});
