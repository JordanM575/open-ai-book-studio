import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBridge, localAddresses, type BridgeStudio } from "../src/main/bridge";

const BOOK_ID = "book_test0001";

const ambient = {
  book: { id: BOOK_ID, title: "The Salt Road", stage: "drafting" },
  chapter: { id: "ch_test00001", title: "One", order: 1, wordCount: 2 },
  progress: { chapters: 1, words: 2, lastOrder: 1 },
  lastChange: null,
  lastSaid: null,
  working: false,
  actions: [],
  say: "You're in Chapter One of The Salt Road."
};

const asked: string[] = [];
const ran: string[] = [];

const studio: BridgeStudio = {
  ambient: async (bookId) => ({ ...ambient, book: { ...ambient.book, id: bookId } }),
  turn: async (input) => {
    asked.push(input.prompt);
    return { turnId: "turn_test0001", threadId: "thread_test0001", text: "I tightened it.", changed: 1 };
  },
  tool: async (input) => {
    ran.push(input.name);
    return { ok: true, message: "Done." };
  },
  undo: async () => ({ restored: 1, skipped: 0 }),
  stop: async () => ({ stopped: 1 })
};

let bridge: LocalBridge | null = null;
let url = "";
let token = "";

beforeAll(async () => {
  const address = localAddresses()[0];
  if (!address) return;
  bridge = new LocalBridge({ address, port: 0, token: "bridge-token", studio });
  const started = await bridge.start();
  url = started.url;
  token = started.token;
});

afterAll(async () => {
  await bridge?.stop();
});

function call(path: string, init: RequestInit = {}, auth: string | null = `Bearer ${token}`) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
}

describe("the bridge to the phone", () => {
  test("refuses to listen on every interface", async () => {
    const wide = new LocalBridge({ address: "0.0.0.0", port: 0, token: "t", studio });
    await expect(wide.start()).rejects.toThrow(/one named local address/i);
  });

  test("needs the token", async () => {
    expect((await call("/v1/ambient?book=book_test0001", {}, null)).status).toBe(401);
    expect((await call("/v1/ambient?book=book_test0001", {}, "Bearer wrong")).status).toBe(401);
  });

  test("refuses a browser origin", async () => {
    const response = await call("/v1/ambient?book=book_test0001", {
      headers: { origin: "https://evil.example" }
    });
    expect(response.status).toBe(403);
  });

  test("says where the author is", async () => {
    const response = await call(`/v1/ambient?book=${BOOK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ambient: { say: string } };
    expect(body.ambient.say).toContain("The Salt Road");
  });

  test("runs a turn and returns the answer", async () => {
    const response = await call("/v1/turn", {
      method: "POST",
      body: JSON.stringify({ bookId: BOOK_ID, prompt: "Carry on." })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { text: string } };
    expect(body.result.text).toBe("I tightened it.");
    expect(asked).toContain("Carry on.");
  });

  test("runs a tool, which is how a tap on the lenses becomes an action", async () => {
    const response = await call("/v1/tool", {
      method: "POST",
      body: JSON.stringify({ bookId: BOOK_ID, name: "read_chapter", args: { chapterId: "ch_test00001" } })
    });
    expect(response.status).toBe(200);
    expect(ran).toContain("read_chapter");
  });

  test("undoes the agent's last turn, because the status offers it", async () => {
    const response = await call("/v1/undo", {
      method: "POST",
      body: JSON.stringify({ bookId: BOOK_ID })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { restored: number } };
    expect(body.result.restored).toBe(1);
  });

  test("stops the agent, because the status says when it is working", async () => {
    const response = await call("/v1/stop", {
      method: "POST",
      body: JSON.stringify({ bookId: BOOK_ID })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { stopped: number } };
    expect(body.result.stopped).toBe(1);
  });

  test("serves nothing else", async () => {
    // The whole library is not on this listener. Only the three things the phone needs.
    expect((await call("/v1/books")).status).toBe(404);
    expect((await call("/v1/library")).status).toBe(404);
    expect((await call("/v1/chapters")).status).toBe(404);
  });

  test("refuses a malformed body", async () => {
    const response = await call("/v1/turn", { method: "POST", body: "{not json" });
    expect(response.status).toBe(400);
  });
});
