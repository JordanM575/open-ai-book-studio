# Plan: agent tool parity

**Spec:** [spec.md](spec.md) · **Tasks:** [tasks.md](tasks.md)

## Files

```
apps/desktop/src/main/agent/tools.ts        the catalog: names, descriptions, schemas, tiers
apps/desktop/src/main/agent/tool-bridge.ts   bound tools: schema validation, checkpoints, undo
apps/desktop/src/main/backend.ts             GET /v1/tools, POST /v1/books/:id/tools/:tool
apps/desktop/src/main/index.ts               start the backend in an isolated test run
apps/toolkit/src/backend-client.ts           tools() and callTool()
apps/toolkit/src/mcp.ts                      mirror the studio tools over MCP
apps/toolkit/src/cli.ts                      bookwriter tools, bookwriter call
```

## One source of truth

`agent/tools.ts` keeps the tool definitions and adds two exported sets:

- `READ_TOOL_NAMES` — tools that only read.
- `DESTRUCTIVE_TOOL_NAMES` — the tools the built-in agent already gates behind author approval.

`chapterToolCatalog()` returns the descriptors by asking the tool definitions themselves for their
description and schema, so a new tool appears in the catalog the day it is added to the agent. The
runtime's approval map is built from `DESTRUCTIVE_TOOL_NAMES`, so the app and the MCP server cannot
drift apart.

## The bridge

`agent/tool-bridge.ts` binds the tools to one book:

- arguments are validated with the tool's own schema before `execute` runs;
- the result is returned unchanged, so the studio and the toolkit speak the same dialect;
- every change is recorded as a checkpoint entry, and the checkpoint is written to the book's
  `.studio/checkpoints` folder. The app's Undo reads the newest checkpoint for a book, so a
  third-party write can be reverted from the same button.

## The backend

The backend takes a `ToolRunner` instead of reaching for the library, so it stays testable:

```ts
interface ToolRunner {
  catalog(): ToolDescriptor[];
  run(bookId: string, name: string, args: unknown, allowDestructive: boolean): Promise<unknown>;
}
```

Routes:

| Route | Purpose |
| --- | --- |
| `GET /v1/tools` | The catalog: name, description, JSON Schema, tier |
| `POST /v1/books/:bookId/tools/:tool` | Run one tool; body `{ args, allowDestructive? }` |

A destructive tool is refused with `403 destructive-not-allowed` unless the request opts in.

## The toolkit

`bookwriter mcp` lists the studio's tools next to the library-level ones. Each mirrored tool takes a
`bookId` argument, which the MCP layer adds to the studio's schema. The tiers map to the flags:

| Tier | Flag |
| --- | --- |
| read | always |
| write | `--allow-writes` |
| destructive | `--allow-destructive` |

`bookwriter tools` prints the catalog and `bookwriter call <bookId> <tool> --args '<json>'` runs one
tool, so a script or a test can drive the same surface without an MCP client.

## Verification

- `bun run typecheck`, `bun test`, `bun run build`, `bun run build:web`, `bun run toolkit:build`.
- `apps/toolkit/tests/e2e-mcp.test.ts` starts a real backend over a real library, spawns the real
  `bookwriter mcp` process, and completes a read → append → read round trip verified on disk.
- `apps/desktop/tests/tool-bridge.test.ts` covers the catalog, the tiers, the schema validation and
  the checkpoint a third-party write leaves behind.
