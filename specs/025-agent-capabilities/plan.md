# Plan: agent capabilities

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
packages/core/src/agent/settings.ts        the per-book agent settings
packages/core/src/agent/plugins.ts        the plugin contract and its argument checking
packages/core/src/agent/metrics.ts        the tool metric shapes and their summary
apps/desktop/src/main/agent/skills.ts     reading and bounding a book's SKILLS.md
apps/desktop/src/main/agent/plugins.ts    loading a folder of TypeScript tools
apps/desktop/src/main/agent/tool-set.ts   the agent's tool set, filtered and extended
apps/desktop/src/main/agent/cache.ts      marking the cacheable prefix of a request
apps/desktop/src/main/metrics.ts          the per-book tool metrics log
apps/desktop/src/main/agent/runtime.ts    honouring the settings, skills, plugins and cache prefix
apps/desktop/src/main/backend.ts          refusing a disabled tool
apps/desktop/src/main/ipc.ts             the agent status the app shows
```

## The settings

`BookMeta.settings` already exists for the manuscript. Add `settings.agent`:

```ts
{
  /** Built-in tool names the author has withdrawn from this book. */
  disabledTools: string[],
  /** The skills file is read from the book folder when present. */
  skillsEnabled: boolean,
}
```

The plugin folder is a library-level setting, because it points at code on the author's disk
(D-150). It lives beside the library root in the app's own settings, not in a book, so copying a
book to another machine never carries a path to someone's home directory.

## The plugin contract

A plugin file exports tools. The contract is deliberately small (D-148):

```ts
export default {
  name: "word-count",
  tools: [
    {
      name: "count_words",
      description: "Count the words in a chapter.",
      parameters: {
        type: "object",
        properties: { chapterId: { type: "string" } },
        required: ["chapterId"]
      },
      handler: async ({ chapterId }, ctx) => {
        const chapter = await ctx.library.readChapter(ctx.bookId, chapterId);
        return { words: chapter.wordCount };
      }
    }
  ]
};
```

The arguments are a JSON Schema, so the file needs no import at all: a plugin folder usually sits
outside the app, where the app's own packages cannot be resolved (D-152, FR-014). A Zod schema is
accepted too, for a plugin folder that has its own `node_modules`.

The handler receives a context with the library and the book id, and nothing else. It cannot reach
a provider key, the credential file or the app's internals (FR-008). It writes through the same
`Library`, so the atomic write and the version guard still apply (FR-009).

The contract lives in `packages/core` so the loader and the contract cannot drift, and so an
author who wants the typed helper can import `definePlugin` from
`@ai-book-studio/core/agent/plugins`.

## Loading the plugins

The loader runs in the main process, which is Node 24 in Electron: TypeScript is stripped
natively, so a `.ts` plugin file loads with `import()` and no build step. A file that fails to
import is reported and skipped (FR-010).

The folder is read on demand, not watched. The author reloads the app, or asks for a reload, after
adding a file. That keeps the loader simple and honest about when a change takes effect.

## The cache prefix

The system instructions and the tool definitions are the stable prefix of every request in a
conversation. Where the provider supports an explicit cache marker, it is applied to the system
message and to the last tool definition (FR-001, D-147, D-153). Where it does not, the request is
unchanged.

The hit rate comes from the provider's own usage report, which the app already reads
(`inputTokenDetails.cacheReadTokens`). A provider that reports nothing is shown as "not reported",
never as zero.

## The metrics

The runtime already sees every tool call and its outcome. It records them per book in a
`.studio/metrics` log beside the usage log, and the app summarizes them (FR-003).

The log is derived data: losing it loses the metrics, never prose. It follows the usage log's
pattern exactly, so the two are read the same way.

## The skills file

`SKILLS.md` sits in the book folder. When present and enabled, its text becomes a named section in
the system prompt, in the *trusted* part, because it is the author's own file in their own library
(FR-005, FR-006). The book folder is read through the library, so the file travels with the book
and is visible in the file browser.

The section is bounded in size, like every other prompt section, so a large file cannot crowd out
the book.

## The disabled tools

The filter is applied where the tool set is built, so a disabled tool is never sent to the model.
The same filter is applied by the backend and the MCP server, so a third-party agent cannot reach a
tool the author withdrew (FR-004, FR-013).

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, `bun run build:web`, `bun run toolkit:build`.
- A test loads a real plugin folder from a temporary directory and calls the tool.
- A test proves a disabled tool is absent from the tool set and refused by the backend.
- A test proves `SKILLS.md` reaches the system prompt.
- The UI audit covers the new panels.
