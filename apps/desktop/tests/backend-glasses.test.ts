import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BookDetail, BookSummary, Chapter } from "@ai-book-studio/core/schema";
import { bookSchema } from "@ai-book-studio/core/schema";
import type { ToolDescriptor } from "@ai-book-studio/core/agent/tools";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import { LocalBackend, type BackendLibrary, type BackendSource, type BackendToolRunner } from "../src/main/backend";

const ROOT = "/tmp/ai-book-studio-glasses-test";
const BOOK_ID = "book_test0001";
const CHAPTER_ID = "ch_test00001";

const book: BookSummary = {
  id: BOOK_ID,
  title: "The Salt Road",
  description: "",
  stage: "drafting",
  chapterCount: 1,
  wordCount: 2,
  updatedAt: "2026-10-26T12:00:00.000Z"
};

const chapter: Chapter = {
  id: CHAPTER_ID,
  title: "One",
  order: 1,
  arc: "beginning",
  purpose: "",
  synopsis: "",
  notes: "",
  isPrologue: false,
  color: null,
  version: 1,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  content: "Hello world.\n",
  path: "0001-one.md",
  wordCount: 2,
  hash: "a".repeat(64)
};

const detail: BookDetail = {
  book: bookSchema.parse({
    id: BOOK_ID,
    title: "The Salt Road",
    description: "",
    stage: "drafting",
    createdAt: "2026-10-26T12:00:00.000Z",
    updatedAt: "2026-10-26T12:00:00.000Z"
  }),
  chapters: [chapter],
  chapterReadIssues: []
};

const library: BackendLibrary = {
  listBooks: async () => [book],
  readBook: async () => detail,
  readChapter: async () => chapter,
  createChapter: async () => chapter,
  saveChapter: async () => ({ status: "saved", chapter }),
  search: async () => [],
  listConflicts: async () => []
};

const source: BackendSource = {
  current: () => ({ root: ROOT, deviceId: "dev_test0001", deviceName: "Test Mac" }),
  requireLibrary: () => library
};

const allTools: ToolDescriptor[] = [
  {
    name: "read_story_bible",
    description: "Read the full Story Bible.",
    inputSchema: { type: "object", properties: {} },
    tier: "read"
  },
  {
    name: "append_to_chapter",
    description: "Add a passage to the end of a chapter.",
    inputSchema: { type: "object", properties: {} },
    tier: "write"
  }
];

/** The bridge leaves out the tools the author withdrew for the book. */
const tools: BackendToolRunner = {
  catalog: async () => allTools,
  catalogFor: async () => allTools.filter((tool) => tool.name !== "append_to_chapter"),
  run: async () => ({ ok: true, message: "Done." })
};

const PAGE = "<!doctype html><title>glasses</title><p>the page</p>";
const MANIFEST = JSON.stringify({ name: "Open Book Studio" });

let directory = "";
let backend: LocalBackend;
let url = "";
let token = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-glasses-"));
  backend = new LocalBackend(source, {
    locatorPath: join(directory, "backend.json"),
    token: "test-token",
    port: 0,
    tools,
    glassesPage: PAGE,
    glassesManifest: MANIFEST
  });
  const started = await backend.start();
  url = started.url;
  token = started.token;
});

afterAll(async () => {
  await backend.stop();
  await rm(directory, { recursive: true, force: true });
});

async function call(path: string, init: RequestInit = {}, auth: string | null = `Bearer ${token}`) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
}

describe("the glasses page", () => {
  test("is served by the studio, so it is the same origin as the API", async () => {
    const response = await call("/glasses", {}, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("the page");
  });

  test("carries no prose and no token of its own", async () => {
    const body = await (await call("/glasses", {}, null)).text();
    expect(body).not.toContain(token);
    expect(body).not.toContain("The Salt Road");
  });

  test("serves the web app manifest", async () => {
    const response = await call("/glasses/manifest.json", {}, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/manifest\+json/);
    expect(await response.json()).toEqual({ name: "Open Book Studio" });
  });

  test("is not there when the studio was built without it", async () => {
    const plain = new LocalBackend(source, {
      locatorPath: join(directory, "plain.json"),
      token: "plain-token",
      port: 0
    });
    const started = await plain.start();
    try {
      const response = await fetch(`${started.url}/glasses`);
      expect(response.status).toBe(404);
    } finally {
      await plain.stop();
    }
  });

  test("publishes its address with the token in the fragment, never in the path", () => {
    expect(backend.glassesUrl).toBe(`${url}/glasses#token=${token}`);
    expect(backend.glassesUrl).not.toContain(`/${token}`);
  });
});

describe("browser origins", () => {
  test("still refuses a foreign origin", async () => {
    const response = await call("/v1/books", { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("allows the studio's own page, which is the same origin as the API", async () => {
    const response = await call("/v1/books", { headers: { origin: url } });
    expect(response.status).toBe(200);
  });

  test("refuses the preflight for a foreign origin", async () => {
    const response = await call("/v1/books", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("answers the preflight for an origin on the list", async () => {
    const listed = new LocalBackend(source, {
      locatorPath: join(directory, "listed.json"),
      token: "listed-token",
      port: 0,
      allowedOrigins: ["https://studio.example"]
    });
    const started = await listed.start();
    try {
      const allowed = await fetch(`${started.url}/v1/books`, {
        method: "OPTIONS",
        headers: { origin: "https://studio.example" }
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://studio.example");
      expect(allowed.headers.get("access-control-allow-headers")).toContain("authorization");

      const refused = await fetch(`${started.url}/v1/books`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" }
      });
      expect(refused.status).toBe(403);
    } finally {
      await listed.stop();
    }
  });

  test("the list is empty by default, so every foreign origin is refused", async () => {
    const response = await call("/v1/books", { headers: { origin: "https://studio.example" } });
    expect(response.status).toBe(403);
  });
});

describe("the per-book tool list", () => {
  test("leaves out a tool the author withdrew for the book", async () => {
    const response = await call(`/v1/books/${BOOK_ID}/tools`);
    const body = (await response.json()) as { tools: ToolDescriptor[] };
    expect(body.tools.map((tool) => tool.name)).toEqual(["read_story_bible"]);
  });

  test("the whole catalog is still available without a book", async () => {
    const response = await call("/v1/tools");
    const body = (await response.json()) as { tools: ToolDescriptor[] };
    expect(body.tools.map((tool) => tool.name)).toEqual(["read_story_bible", "append_to_chapter"]);
  });
});

describe("the ambient agent on the control plane", () => {
  const ambient = {
    book: { id: BOOK_ID, title: "The Salt Road", stage: "drafting" },
    chapter: { id: CHAPTER_ID, title: "One", order: 1, wordCount: 2 },
    progress: { chapters: 1, words: 2, lastOrder: 1 },
    lastChange: null,
    lastSaid: null,
    working: false,
    actions: [],
    say: "You're in Chapter One of The Salt Road."
  };

  const asked: string[] = [];
  /** The arguments of every undo the control plane passed on, as given. */
  const undone: unknown[][] = [];
  const STALE =
    "The book changed since that turn, so nothing was undone. The newest change is “Make the lamp smoke.” in “The Lamp”.";
  let agentUrl = "";
  let agentToken = "";

  beforeAll(async () => {
    const withAgent = new LocalBackend(source, {
      locatorPath: join(directory, "agent.json"),
      token: "agent-token",
      port: 0,
      ambient: { status: async () => ambient },
      agent: {
        run: async (input) => {
          asked.push(input.prompt);
          return {
            turnId: "turn_test0001",
            threadId: "thread_test0001",
            text: "I tightened the opening.",
            changed: 1
          };
        },
        undo: async (...args: [bookId: string, turnId?: string]) => {
          undone.push(args);
          // The runtime's refusal when the named turn no longer owns the newest checkpoint.
          if (args[1] === "turn_stale0001") throw new ProviderError("not-found", STALE);
          return { restored: 1, skipped: 0 };
        },
        stop: async () => ({ stopped: 1 })
      }
    });
    const started = await withAgent.start();
    agentUrl = started.url;
    agentToken = started.token;
    // The backend is stopped in the suite's own afterAll, through the main one.
    agentBackend = withAgent;
  });

  let agentBackend: LocalBackend | null = null;

  afterAll(async () => {
    await agentBackend?.stop();
  });

  test("tells a caller where the author is", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/ambient`, {
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ambient: typeof ambient };
    expect(body.ambient.say).toContain("The Salt Road");
  });

  test("runs a turn and returns the answer", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/turn`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Carry on with the next scene." })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { text: string; changed: number } };
    expect(body.result.text).toBe("I tightened the opening.");
    expect(asked).toEqual(["Carry on with the next scene."]);
  });

  test("undoes the agent's last turn", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/undo`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { restored: number } };
    expect(body.result.restored).toBe(1);
    // The CLI and MCP name no turn: they undo the newest on purpose.
    expect(undone.at(-1)).toEqual([BOOK_ID]);
  });

  test("undoes the newest turn when the request has no body at all", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/undo`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}` }
    });
    expect(response.status).toBe(200);
    expect(undone.at(-1)).toEqual([BOOK_ID]);
  });

  test("undoes a named turn only while it is the newest, and refuses a stale one as a conflict", async () => {
    const undo = (body: unknown) =>
      fetch(`${agentUrl}/v1/books/${BOOK_ID}/undo`, {
        method: "POST",
        headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      });

    const named = await undo({ turnId: "turn_test0001" });
    expect(named.status).toBe(200);
    expect(undone.at(-1)).toEqual([BOOK_ID, "turn_test0001"]);

    const stale = await undo({ turnId: "turn_stale0001" });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { message: string } }).error.message).toBe(STALE);

    const calls = undone.length;
    for (const turnId of ["", "t".repeat(81), 7]) {
      expect((await undo({ turnId })).status).toBe(400);
    }
    expect(undone).toHaveLength(calls);
  });

  test("stops the agent when it is working", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { stopped: number } };
    expect(body.result.stopped).toBe(1);
  });

  test("refuses a turn with nothing to say", async () => {
    const response = await fetch(`${agentUrl}/v1/books/${BOOK_ID}/turn`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" })
    });
    expect(response.status).toBe(400);
  });

  test("is not there when the studio was built without it", async () => {
    const response = await call(`/v1/books/${BOOK_ID}/ambient`);
    expect(response.status).toBe(404);
  });
});
