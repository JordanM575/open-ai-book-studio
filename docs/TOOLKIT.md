# Agent toolkit: CLI and MCP

`bookwriter` is the standalone toolkit for an AI Book Studio library. It is a thin client of the
desktop app's loopback backend, so another agent can read and write the same files without a second
library, a hosted account or a copy of the author's prose.

The desktop app remains the only process that opens the library and the only process that holds a
model key. The toolkit never calls a provider.

## The studio's own tools

The backend serves the writing tools the built-in agent uses — the same names, the same
descriptions and the same JSON Schemas. A third-party agent therefore gets the built-in agent's
verbs rather than a thinner dialect of its own:

| Verb | What it does |
| --- | --- |
| `table_of_contents` | The chapters with their ids, order and word counts |
| `read_story_bible` | The book description, outline, story arc, cast and memories |
| `read_chapter` | One chapter's full text |
| `chapter_stats` | Word and character counts |
| `find_in_chapter` / `find_in_chapters` | Find a phrase in a chapter or the whole book |
| `replace_in_chapter` | Replace one exact passage |
| `insert_at_line` | Insert text at a line |
| `append_to_chapter` | Add a passage at the end |
| `overwrite_chapter` | Replace a chapter's whole text (destructive) |
| `delete_lines_in_chapter` | Delete a line range (destructive) |
| `create_chapter` / `split_chapter` / `merge_chapters` / `delete_chapter` / `move_chapter` | Chapter structure (split, merge, delete and move are destructive) |
| `set_chapter_meta` | Change a chapter's title, synopsis or purpose |
| `update_book_details` | Change the title, description, genres or outline |
| `update_character` / `add_memory` / `update_memory` | The cast and the memories (`remove_memory` is destructive) |

`bookwriter tools` prints the live catalog with the tier of each tool.

### The catalog in other people's shapes

The catalog is also what other agents and surfaces speak, so the toolkit can print it in the two
shapes Meta named:

```bash
bookwriter tools --format webmcp     # the tool list a web page registers with document.modelContext
bookwriter tools --format connector  # the Meta AI connector manifest, every tool classified
```

The WebMCP form is what a page on Meta's Ray-Ban Display glasses registers so the wearer can ask
for it by voice; the connector form is the tool list a Meta AI connector exposes, with every tool
classified Read or Write and the destructive ones marked sensitive. Neither talks to Meta: they are
descriptions, so a caller can hand them over. See
[`specs/026-glasses`](../specs/026-glasses/spec.md).

### Safety tiers

Every tool has one of three tiers:

| Tier | Meaning |
| --- | --- |
| `read` | Only looks at the book. Always available. |
| `write` | Changes the book. Needs `--allow-writes`. |
| `destructive` | Removes or replaces work in a way a diff cannot recover. Needs `--allow-destructive`, which implies `--allow-writes`. |

The tier is the same list the built-in agent uses for its approval prompts, so the two agents agree
on what counts as destructive. The backend refuses a destructive tool unless the request carries an
explicit opt-in, so a leaked token is not enough on its own.

### Undo

Every change a tool makes leaves an undo checkpoint in the book, in the same format the studio's own
Undo uses. The author can revert a change made by another agent from the app.

### Tools the author has withdrawn

The author can turn a tool off for a book, in **More → Agent**. A withdrawn tool is not offered to
the model, and it is not reachable from the CLI, the backend or the MCP server: the toolkit refuses
it with `turned off for this book. The author withdrew it.` The setting lives in the book, so it
travels with the book and applies to every agent that works on it.

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
bookwriter tools
```

`--json` returns the backend payload for scripting. `read` without a chapter prints the book and its
chapter ids; `read` with a chapter prints the Markdown to stdout and the version/hash to stderr.

`bookwriter call` runs one studio tool against one book:

```bash
bookwriter call book_abc12345 append_to_chapter \
  --args '{"chapterId":"ch_abc12345","text":"The lamp turned."}' \
  --allow-writes
```

Write tools need `--allow-writes` and destructive tools need `--allow-destructive`.

## The ambient agent

The studio knows where the author is in the book, what the agent last changed and what it would
do next, whether or not anyone has opened the chat panel. Two commands reach it:

```bash
bookwriter where book_abc12345
bookwriter ask book_abc12345 "carry on with the next scene"
bookwriter undo book_abc12345
```

`where` prints the line the agent would say — the book, the chapter, the progress, the last
change, and the offer to read the prose — followed by the actions that are available and how to
ask for them. `ask` runs a turn through the same runtime the app uses and prints the answer.

The same two things are available over the backend, for anything that is not a command line:

| Route | What it does |
| --- | --- |
| `GET /v1/books/:bookId/ambient` | The ambient status: where the author is, what changed, what can be said or done. |
| `POST /v1/books/:bookId/turn` | Run a turn and wait for the answer. The body is `{ "prompt": "…" }`. |
| `POST /v1/books/:bookId/undo` | Undo the agent's last turn. The status offers this action, so the route that serves the status must also honour it. |

A turn that needs the author's approval for a destructive tool is refused with a sentence saying
so, because only the app can ask them.

The glasses' phone app uses exactly these two routes: it polls the status over the local network,
renders it on the lenses, and sends the author's taps back through the studio's own tools.

The file-level writes stay available for scripts that want a whole-file replace:

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

Add `--allow-writes` to expose the write tools, and `--allow-destructive` for the destructive ones:

```json
{
  "mcpServers": {
    "ai-book-studio": {
      "command": "/absolute/path/to/bookwriter",
      "args": ["mcp", "--allow-writes", "--allow-destructive"]
    }
  }
}
```

The MCP tool list is the studio's catalog. Each mirrored tool takes the `bookId` it works on, so one
server can reach any book in the library:

```json
{
  "method": "tools/call",
  "params": {
    "name": "append_to_chapter",
    "arguments": { "bookId": "book_abc12345", "chapterId": "ch_abc12345", "text": "The lamp turned." }
  }
}
```

Library-level tools stay alongside them:

| Tool | What it returns |
| --- | --- |
| `library_info` | The open library, device id and device name |
| `list_books` | Book summaries |
| `list_conflicts` | Preserved conflict copies |

Everything is JSON text content, so any MCP client can read it. Diagnostics go to stderr; stdout is
protocol only.

## What it is not

- No remote access, tunnel, hosted MCP endpoint, account or multi-user permission.
- No model inference. The toolkit operates on the library; the studio's agent stays in the app.
- No second sync or save path. Every write goes through the open `Studio` and its `Library`.
- No service installation. Closing the app closes the backend.
