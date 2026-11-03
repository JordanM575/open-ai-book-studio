# Connector application note

Prepared material for a Meta AI connector application for AI Book Studio. The manifest is
ready; the application itself waits on a public endpoint and account linking, which do not
exist (D-155, D-157). Nothing here is submitted anywhere.

## The manifest

`bookwriter tools --format connector` prints the connector manifest from the live studio, so
the manifest always describes the tools the studio is actually running. The mapping lives in
`packages/core/src/agent/surfaces.ts` and is covered by `agent-surfaces.test.ts`.

The manifest head is fixed in code:

- Name: AI Book Studio.
- Description: read and write the author's book — chapters, Story Bible and the agent's
  writing tools — with an undo checkpoint for every change.
- Authentication: OAuth 2.0 account linking. The connector never holds a provider key and
  never sees the author's other books.
- Account linking: the author links their own studio. A connector is offered a read-only
  scope where the service supports it.
- Scopes: `read` (the book, its chapters, the Story Bible and the word counts), `write`
  (append to, replace in and restructure one chapter, leaving an undo checkpoint),
  `destructive` (remove or replace work, only with the author's explicit approval each
  time).

Every tool carries its name, description, JSON Schema, a Read/Write classification, a
sensitive mark, a side-effects sentence and an errors sentence. The current catalog is 22
writing tools: 6 read, 9 write and 7 destructive. The 7 sensitive tools are
`remove_memory`, `overwrite_chapter`, `delete_chapter`, `delete_lines_in_chapter`,
`move_chapter`, `split_chapter` and `merge_chapters`. A read tool reports "None. The book
is not changed." A write tool reports its undo checkpoint. A destructive tool reports that
the studio asks for approval before it runs. Every tool reports the same refusal behavior:
it refuses arguments that do not fit the schema, and refuses a tool the author has
withdrawn for the book.

A withdrawn tool never reaches the manifest: the backend refuses it with "turned off for
this book", so the manifest a reviewer sees already excludes what the author switched off.

## The account-linking story

The manifest states OAuth 2.0 account linking against the author's own studio, with a
read-only scope offered where Meta's side supports one. That story is written but not
wired: there is no public endpoint to link to, by decision, and no OAuth server in the
studio. The loopback backend authenticates with a per-run Bearer [REDACTED] that never leaves the
machine. A real application needs, in order: a public studio endpoint serving only the
sample library, an OAuth link the author's studio can complete, and Meta's review. Until
then the note stays a preparation, not a submission.

## The scopes, in review terms

- Read covers the six read-tier tools. It changes nothing and needs no opt-in beyond the
  connection itself.
- Write covers chapter edits, structure, the Story Bible and memories. Every write leaves
  an undo checkpoint the author can restore from the app.
- Destructive is a subset of Write, marked sensitive per tool. The studio asks the author
  for approval before each destructive run, and the toolkit keeps destructive tools off
  unless started with `--allow-destructive`.

## Side effects and error behavior

Side effects are per tier, stated on every tool: none for reads, an undo checkpoint for
writes, approval-gated removal or replacement for destructive tools. Errors are refusals,
not partial writes: a bad schema, a withdrawn tool, or a missing destructive opt-in
refuses the call and changes nothing. The MCP server mirrors the same catalog over stdio,
so a reviewer can exercise the identical refusal surface without Meta's infrastructure.

## Test story

There are no standing test credentials, and none are needed. A reviewer reproduces the
whole surface locally with the committed sample library:

1. Open the desktop app on the sample library and leave it running; it writes a
   per-run token to `~/.ai-book-studio/backend.json` (mode `0600`).
2. `bookwriter tools` lists the live catalog; `--format webmcp` and
   `--format connector` print the two Meta shapes.
3. `bookwriter mcp` speaks the same catalog over stdio; `bookwriter call` exercises a
   write with `--allow-writes`.
4. `bun run glasses:check` drives the 600×600 page against the real studio
   (21 checks), and the 024 end-to-end test runs a real backend plus a real MCP
   client through a read-append-read round trip verified on disk.

No manuscript, provider key, or credential leaves the machine in any of these steps.
