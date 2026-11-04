import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { IPC } from "@ai-book-studio/core/ipc";
import { MemoryVault } from "@ai-book-studio/core/providers/credentials";
import { OPENROUTER_KEYS_PAGE_URL } from "@ai-book-studio/core/providers/links";
import type { StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderService } from "../src/main/providers";
import { mockElectron } from "./support/mock-electron";

/**
 * The main-process side of 011 FR-013's revocation link and FR-007's model check. Component tests
 * mock the preload bridge, so this file drives the real handlers: `registerIpc` with Electron's shell
 * recorded rather than opened, and a provider service whose fetch never leaves the process.
 */

const opened: string[] = [];
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

mockElectron(tmpdir(), {
  handle: (channel, handler) => {
    handlers.set(channel, handler);
  },
  openExternal: (url) => {
    opened.push(url);
  }
});

const { registerIpc } = await import("../src/main/ipc");

const META: StoredCredential = {
  id: "conn_metaipc00001",
  provider: "meta",
  label: "Meta",
  kind: "api-key",
  createdAt: "2026-11-03T00:00:00.000Z",
  secret: "meta-test-secret-0002",
  metadata: { baseUrl: "https://meta.example.test/v1" }
};

afterEach(() => {
  opened.length = 0;
});

async function setup(answer: () => Response = () => new Response("unexpected", { status: 500 })) {
  const vault = new MemoryVault();
  await vault.set(META);
  const requests: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    requests.push(input instanceof Request ? input.url : String(input));
    return answer();
  }) as typeof fetch;
  const providers = new ProviderService(vault, async () => {}, fetchImpl);
  const stub = undefined as never;
  registerIpc(stub, () => null, providers, stub, stub, stub, stub, stub, stub, stub);
  return { vault, requests };
}

async function invoke(channel: string, payload: unknown): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}.`);
  return (await handler({}, payload)) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

describe("opening a page in the author's browser", () => {
  test("opens exactly OpenRouter's keys page", async () => {
    await setup();
    expect(await invoke(IPC.app.openLink, OPENROUTER_KEYS_PAGE_URL)).toEqual({ ok: true, data: null });
    expect(opened).toEqual(["https://openrouter.ai/settings/keys"]);
  });

  test("refuses every other address and opens nothing", async () => {
    await setup();
    for (const payload of [
      `${OPENROUTER_KEYS_PAGE_URL}?x=1`,
      `${OPENROUTER_KEYS_PAGE_URL}/`,
      ` ${OPENROUTER_KEYS_PAGE_URL}`,
      OPENROUTER_KEYS_PAGE_URL.replace("https:", "http:"),
      "https://openrouter.ai/settings",
      "https://openrouter.ai.example.test/settings/keys",
      "javascript:alert(1)",
      "file:///etc/passwd",
      42,
      null
    ]) {
      const result = await invoke(IPC.app.openLink, payload);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("invalid");
    }
    expect(opened).toEqual([]);
  });
});

describe("checking a model id through the bridge", () => {
  test("malformed input is refused before any request", async () => {
    const { requests } = await setup();
    for (const payload of [
      { connectionId: "not-a-connection", modelId: "muse-spark-1.3" },
      { connectionId: META.id, modelId: "" },
      { connectionId: META.id, modelId: "m".repeat(201) },
      { connectionId: META.id },
      "muse-spark-1.3"
    ]) {
      const result = await invoke(IPC.providers.addModel, payload);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("invalid");
    }
    expect(requests).toEqual([]);
  });

  test("a model that answers comes back marked as entered by hand", async () => {
    const { vault, requests } = await setup(() =>
      Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "length" }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
      })
    );
    const result = await invoke(IPC.providers.addModel, { connectionId: META.id, modelId: "muse-spark-1.3" });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id: "muse-spark-1.3", name: "Muse Spark 1.3", manual: true });
    expect(requests).toEqual(["https://meta.example.test/v1/chat/completions"]);
    expect((await vault.get(META.id))?.metadata?.manualModels).toBe(JSON.stringify(["muse-spark-1.3"]));
  });

  test("a refusal keeps its provider code and says why, without the key", async () => {
    await setup(() => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 }));
    const result = await invoke(IPC.providers.addModel, { connectionId: META.id, modelId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not-found");
    expect(result.error?.message).toContain("does not offer a model with that id");
    expect(JSON.stringify(result)).not.toContain(META.secret);
  });
});
