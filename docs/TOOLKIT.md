# Agent toolkit: CLI and MCP

`bookwriter` is the standalone toolkit for an AI Book Studio library. It is a thin client of the
desktop app's loopback backend, so another agent can read and write the same files without a second
library, a hosted account or a copy of the author's prose.

The desktop app remains the only process that opens the library and the only process that holds a
model key. The toolkit never calls a provider.

## Build and install

From the repository:

```bash
bun install
bun run toolkit:build
```

The compiled binary is `apps/toolkit/dist/bookwriter`. Put it on `PATH`, or link the workspace binary:

```bash
cd apps/toolkit
bun link
```

`bookwriter --help` lists every command.

## Start the backend

1. Open AI Book Studio and open a library.
2. Leave the app running. It writes `~/.ai-book-studio/backend.json` with a per-run token and removes
   it on quit.
3. Run the CLI or an MCP client. If the app is closed, the toolkit says so in one sentence.

The backend binds `127.0.0.1` on a random port. It rejects browser origins, non-loopback `Host`
headers and requests without the bearer token. The locator is mode `0600`; never commit or share it.
`STUDIO_BACKEND_FILE` moves it for tests or an isolated profile. `BOOKWRITER_URL` and
`BOOKWRITER_TOKEN` override discovery when a caller already has a token.

## CLI

```bash
bookwriter info
bookwriter books
bookwriter read book_abc12345
bookwriter read book_abc12345 ch_abc12345
bookwriter search book_abc12345 "salt road"
bookwriter conflicts book_abc12345
```

`--json` returns the backend payload for scripting. `read` without a chapter prints the book and its
chapter ids; `read` with a chapter prints the Markdown to stdout and the version/hash to stderr.

Writes are deliberate and compare-before-write:

```bash
bookwriter read book_abc12345 ch_abc12345 --json > chapter.json
# edit the content, keep version and hash
bookwriter save book_abc12345 ch_abc12345 --allow-writes \
  --content-file revised.md \
  --base-version 3 \
  --base-hash 0123… \
  --json
```

`save` exits `2` on a conflict and prints where the losing version was preserved. `create-chapter`
also requires `--allow-writes`:

```bash
bookwriter create-chapter book_abc12345 --allow-writes --title "Two" --content-file two.md
```

Content comes from `--content-file` or `--stdin`. Inline content is not accepted, so prose does not
land in shell history.

## MCP server

`bookwriter mcp` speaks MCP over stdio, one JSON-RPC message per line. It is read-only by default:

```json
{
  "mcpServers": {
    "ai-book-studio": {
      "command": "/absolute/path/to/bookwriter",
      "args": ["mcp"]
    }
  }
}
```

Add `--allow-writes` to expose `create_chapter` and `save_chapter`:

```json
{
  "mcpServers": {
    "ai-book-studio": {
      "command": "/absolute/path/to/bookwriter",
      "args": ["mcp", "--allow-writes"]
    }
  }
}
```

Read tools:

| Tool | What it returns |
| --- | --- |
| `library_info` | The open library, device id and device name |
| `list_books` | Book summaries |
| `read_book` | Book metadata, cast, outline and chapter list; chapter content is stripped |
| `read_chapter` | One chapter with Markdown, version and hash |
| `search_book` | Matching chapters, line numbers and text |
| `list_conflicts` | Preserved conflict copies |

Write tools, only with `--allow-writes`:

| Tool | What it does |
| --- | --- |
| `create_chapter` | Creates a chapter at the end of a book |
| `save_chapter` | Saves with `baseVersion` and `baseHash`; a stale write becomes the normal conflict copy |

Everything is JSON text content, so any MCP client can read it. Diagnostics go to stderr; stdout is
protocol only.

## What it is not

- No remote access, tunnel, hosted MCP endpoint, account or multi-user permission.
- No model inference. The toolkit operates on the library; the studio's agent stays in the app.
- No second sync or save path. Every write goes through the open `Studio` and its `Library`.
- No service installation. Closing the app closes the backend.
