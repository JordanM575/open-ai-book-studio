import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentMessageSchema } from "@ai-book-studio/core/agent/messages";
import { AmbientService } from "../src/main/agent/ambient";
import { Library } from "../src/main/library/store";

/*
 * The ambient panel and the glasses repeat the last thing the agent said, so the author can pick
 * up where they left off. It comes from the book's own conversation file, and only words count:
 * a reply that was only tool calls, or only whitespace, is passed over.
 */

const NOW = "2026-11-03T12:00:00.000Z";
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "studio-ambient-said-"));
  cleanups.push(root);
  const library = await Library.open(root);
  const book = await library.createBook({ title: "The Salt Road" });
  await library.createChapter(book.id, { title: "The Light", content: "The storm came in low.\n" });
  return { library, bookId: book.id };
}

function message(id: string, role: "user" | "assistant", parts: unknown[]) {
  return agentMessageSchema.parse({ id, role, turnId: `turn_${id}`, parts, createdAt: NOW });
}

describe("what the agent last said", () => {
  test("is the newest reply with words in it, joined from its text parts", async () => {
    const { library, bookId } = await fixture();
    await library.threads.create(bookId, "The opening", [
      message("msg_said0001", "user", [{ type: "text", text: "Read the first chapter." }]),
      message("msg_said0002", "assistant", [
        { type: "text", text: "I read The Light. " },
        { type: "text", text: " The storm arrives in the first line." }
      ]),
      message("msg_said0003", "user", [{ type: "text", text: "Tighten it." }]),
      message("msg_said0004", "assistant", [
        { type: "tool-call", id: "call_said01", name: "read_chapter", input: { chapterId: "ch_said000001" } },
        { type: "text", text: "   " }
      ])
    ]);
    const status = await new AmbientService(() => library).status(bookId);
    expect(status.lastSaid).toBe("I read The Light. The storm arrives in the first line.");
  });

  test("is nothing when the agent has not replied yet", async () => {
    const { library, bookId } = await fixture();
    await library.threads.create(bookId, "Unanswered", [
      message("msg_said0005", "user", [{ type: "text", text: "Read the first chapter." }])
    ]);
    const status = await new AmbientService(() => library).status(bookId);
    expect(status.lastSaid).toBeNull();
  });

  test("needs an open library", async () => {
    await expect(new AmbientService(() => null).status("book_said000001")).rejects.toThrow("No library is open.");
  });
});
