#!/usr/bin/env bun
/**
 * Check which provider credentials are configured and whether they work.
 *
 * Prints status only. It never prints a key, a key length, an authorization header or a
 * response body that could contain account information.
 *
 * Usage:
 *   bun scripts/check-keys.mjs
 *   bun scripts/check-keys.mjs --strict   # exit non-zero if a configured key fails
 */

const strict = process.argv.includes("--strict");
const timeout = 15_000;

const providers = [
  {
    id: "openrouter",
    label: "OpenRouter",
    env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/key",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    id: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  {
    id: "gemini",
    label: "Gemini",
    env: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
];

async function check(provider, key) {
  const started = Date.now();
  try {
    const response = await fetch(provider.url, {
      headers: provider.headers(key),
      signal: AbortSignal.timeout(timeout),
    });
    const elapsed = Date.now() - started;
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status} in ${elapsed} ms` };
    }
    let models = 0;
    try {
      const body = await response.json();
      const list = body?.data ?? body?.models ?? body?.data?.models;
      if (Array.isArray(list)) models = list.length;
    } catch {
      // A successful check does not require a JSON body.
    }
    return { ok: true, detail: `ok in ${elapsed} ms${models ? `, ${models} models visible` : ""}` };
  } catch (error) {
    const name = error?.name === "TimeoutError" ? "timed out" : "network error";
    return { ok: false, detail: `${name} after ${Date.now() - started} ms` };
  }
}

async function checkMeta(key, base) {
  if (!base) {
    return { configured: false, ok: false, detail: "META_API_BASE_URL is not set" };
  }
  const url = `${base.replace(/\/+$/, "")}/models`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok
      ? { configured: true, ok: true, detail: `ok in ${Date.now() - started} ms` }
      : { configured: true, ok: false, detail: `HTTP ${response.status} in ${Date.now() - started} ms` };
  } catch (error) {
    const name = error?.name === "TimeoutError" ? "timed out" : "network error";
    return { configured: true, ok: false, detail: `${name} after ${Date.now() - started} ms` };
  }
}

const results = [];

for (const provider of providers) {
  const key = process.env[provider.env]?.trim();
  if (!key) {
    results.push({ label: provider.label, configured: false, ok: false, detail: "not configured" });
    continue;
  }
  const result = await check(provider, key);
  results.push({ label: provider.label, configured: true, ...result });
}

const metaKey = process.env.META_API_KEY?.trim();
results.push({
  label: "Meta",
  ...(metaKey
    ? { configured: true, ...(await checkMeta(metaKey, process.env.META_API_BASE_URL?.trim())) }
    : { configured: false, ok: false, detail: "not configured" }),
});

results.push({
  label: "ChatGPT plan",
  configured: false,
  ok: true,
  detail: "sign in inside the desktop app; cannot be checked headlessly",
});

let failures = 0;
for (const result of results) {
  const status = !result.configured ? "skipped" : result.ok ? "ok" : "FAIL";
  if (result.configured && !result.ok) failures += 1;
  console.log(`${result.label.padEnd(14)} ${status.padEnd(8)} ${result.detail}`);
}

console.log(
  `\n${results.filter((r) => r.configured).length} configured, ${failures} failing. ` +
    "Keys are read from the environment and were not printed.",
);

if (strict && failures > 0) process.exit(1);
