#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { BackendClient, BackendError, type BackendOverrides } from "./backend-client";
import { McpServer, serveMcp, type ToolkitClient } from "./mcp";

interface Io {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
}

interface Parsed {
  command: string | null;
  positionals: string[];
  flags: Map<string, string | true>;
}

const USAGE = `bookwriter — AI Book Studio agent toolkit

Usage: bookwriter [options] <command> [arguments]

Commands:
  info                              Show the open library
  books                             List books
  read <bookId> [chapterId]         Read a book or a chapter
  search <bookId> <query>           Search a book
  conflicts <bookId>                List conflict copies
  create-chapter <bookId>           Create a chapter (requires --allow-writes)
  save <bookId> <chapterId>         Checked save (requires --allow-writes)
  mcp                               Start the MCP server on stdio

Options:
  --url <url>                       Backend URL (default: locator file)
  --token <token>                   Backend token (default: locator file)
  --locator <path>                  Backend locator file
  --allow-writes                    Enable create-chapter, save and write MCP tools
  --json                            Print the backend payload
  --content-file <path>             Chapter content for create/save
  --stdin                           Read chapter content from stdin
  --title <title>                   Chapter title for create-chapter
  --base-version <n>                Version returned by read (save)
  --base-hash <hash>                Hash returned by read (save)
  --help                            Show this help

Environment: BOOKWRITER_URL, BOOKWRITER_TOKEN, STUDIO_BACKEND_FILE
`;

/**
 * The CLI is intentionally dependency-free. It talks to the studio backend so the desktop app
 * remains the only process that opens the library and the only process that holds a provider key.
 */
export async function runCli(
  argv: string[],
  io: Io = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin },
  connect: (overrides: BackendOverrides) => Promise<ToolkitClient> = (overrides) =>
    BackendClient.connect(overrides)
): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (parsed.flags.has("version")) {
    io.stdout.write("0.1.0\n");
    return 0;
  }
  if (parsed.flags.has("help") || !parsed.command) {
    io.stdout.write(USAGE);
    return 0;
  }

  const overrides: BackendOverrides = {
    ...(typeof parsed.flags.get("url") === "string" ? { url: parsed.flags.get("url") as string } : {}),
    ...(typeof parsed.flags.get("token") === "string" ? { token: parsed.flags.get("token") as string } : {}),
    ...(typeof parsed.flags.get("locator") === "string" ? { locatorPath: parsed.flags.get("locator") as string } : {})
  };
  const json = parsed.flags.has("json");
  const writes = parsed.flags.has("allow-writes");

  try {
    const client = await connect(overrides);
    switch (parsed.command) {
      case "info": {
        const library = await client.library();
        if (json) return print(io, library);
        if (!library) {
          io.stderr.write("No library is open in the studio.\n");
          return 1;
        }
        io.stdout.write(`${library.deviceName} · ${library.root}\n`);
        io.stdout.write(`Device ${library.deviceId}\n`);
        return 0;
      }
      case "books": {
        const books = await client.books();
        if (json) return print(io, books);
        if (books.length === 0) {
          io.stdout.write("No books in this library.\n");
          return 0;
        }
        io.stdout.write("ID                 CHAPTERS  WORDS     TITLE\n");
        for (const book of books) {
          io.stdout.write(
            `${book.id.padEnd(18)} ${String(book.chapterCount).padStart(8)}  ${String(book.wordCount).padStart(8)}  ${book.title}\n`
          );
        }
        return 0;
      }
      case "read": {
        const bookId = required(parsed.positionals[0], "read needs a bookId.");
        const chapterId = parsed.positionals[1];
        if (chapterId) {
          const chapter = await client.chapter(bookId, chapterId);
          if (json) return print(io, chapter);
          io.stderr.write(
            `${chapter.title} · version ${chapter.version} · hash ${chapter.hash} · ${chapter.wordCount} words\n`
          );
          io.stdout.write(chapter.content.endsWith("\n") ? chapter.content : `${chapter.content}\n`);
          return 0;
        }
        const book = await client.book(bookId);
        if (json) return print(io, book);
        io.stdout.write(`# ${book.book.title}\n`);
        if (book.book.description) io.stdout.write(`${book.book.description}\n`);
        io.stdout.write("\nChapters:\n");
        for (const chapter of book.chapters) {
          io.stdout.write(`  ${chapter.id}  ${chapter.title} (${chapter.wordCount} words)\n`);
        }
        return 0;
      }
      case "search": {
        const bookId = required(parsed.positionals[0], "search needs a bookId.");
        const query = required(parsed.positionals.slice(1).join(" "), "search needs a query.");
        const hits = await client.search(bookId, query);
        if (json) return print(io, hits);
        if (hits.length === 0) {
          io.stdout.write("No matches.\n");
          return 0;
        }
        for (const hit of hits) {
          io.stdout.write(`${hit.chapterTitle}:${hit.line}  ${hit.text}\n`);
        }
        return 0;
      }
      case "conflicts": {
        const bookId = required(parsed.positionals[0], "conflicts needs a bookId.");
        const conflicts = await client.conflicts(bookId);
        if (json) return print(io, conflicts);
        if (conflicts.length === 0) {
          io.stdout.write("No conflict copies.\n");
          return 0;
        }
        for (const conflict of conflicts) {
          io.stdout.write(`${conflict.chapterTitle} · ${conflict.reason} · ${conflict.savedAs ?? "(no copy)"}\n`);
        }
        return 0;
      }
      case "create-chapter": {
        if (!writes) throw new Error("create-chapter requires --allow-writes.");
        const bookId = required(parsed.positionals[0], "create-chapter needs a bookId.");
        const title = optional(parsed.flags.get("title"));
        const content = await contentFor(parsed, io);
        const chapter = await client.createChapter(bookId, {
          ...(title ? { title } : {}),
          ...(content !== undefined ? { content } : {})
        });
        if (json) return print(io, chapter);
        io.stdout.write(`Created ${chapter.id} · version ${chapter.version} · hash ${chapter.hash}\n`);
        return 0;
      }
      case "save": {
        if (!writes) throw new Error("save requires --allow-writes.");
        const bookId = required(parsed.positionals[0], "save needs a bookId.");
        const chapterId = required(parsed.positionals[1], "save needs a chapterId.");
        const content = await contentFor(parsed, io);
        if (content === undefined) throw new Error("save needs --content-file <path> or --stdin.");
        const baseVersion = numberFlag(parsed, "base-version");
        const baseHash = stringFlag(parsed, "base-hash");
        if (baseVersion === undefined || !baseHash) {
          throw new Error("save needs --base-version and --base-hash from the read. Re-read rather than guessing.");
        }
        const result = await client.saveChapter(bookId, chapterId, {
          content,
          baseVersion,
          baseHash
        });
        if (json) return print(io, result);
        if (result.status === "conflict") {
          io.stderr.write(
            `Not saved: ${result.conflict.reason}${result.conflict.savedAs ? ` · your text is in ${result.conflict.savedAs}` : ""}\n`
          );
          return 2;
        }
        io.stdout.write(`Saved ${result.chapter.id} · version ${result.chapter.version} · hash ${result.chapter.hash}\n`);
        return 0;
      }
      case "mcp": {
        const server = new McpServer(client, { allowWrites: writes });
        io.stderr.write(
          `AI Book Studio MCP server on stdio${writes ? " (writes enabled)" : " (read-only)"}.\n`
        );
        await serveMcp(server, io.stdin, io.stdout);
        return 0;
      }
      default:
        io.stderr.write(`Unknown command: ${parsed.command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof BackendError) {
      io.stderr.write(`${error.message}\n`);
      if (error.status === 401 || error.status === 403) {
        io.stderr.write("Quit and reopen AI Book Studio so the toolkit receives a fresh token.\n");
      }
      return 1;
    }
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parse(argv: string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  const boolean = new Set([
    "allow-writes",
    "json",
    "stdin",
    "help",
    "version"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equal = argument.indexOf("=");
    const key = equal >= 0 ? argument.slice(2, equal) : argument.slice(2);
    if (boolean.has(key)) {
      flags.set(key, true);
      continue;
    }
    const value = equal >= 0 ? argument.slice(equal + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value.`);
    flags.set(key, value);
  }
  return { command: positionals.shift() ?? null, positionals, flags };
}

function print(io: Io, value: unknown): number {
  io.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`);
  return 0;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function optional(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringFlag(parsed: Parsed, key: string): string | undefined {
  return optional(parsed.flags.get(key));
}

function numberFlag(parsed: Parsed, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw new Error(`--${key} must be a non-negative integer.`);
  return numeric;
}

async function contentFor(parsed: Parsed, io: Io): Promise<string | undefined> {
  const file = stringFlag(parsed, "content-file");
  const stdin = parsed.flags.has("stdin");
  if (file && stdin) throw new Error("Use either --content-file or --stdin, not both.");
  if (file) return readFile(file, "utf8");
  if (!stdin) return undefined;
  let content = "";
  for await (const chunk of io.stdin) content += Buffer.from(chunk as Buffer).toString("utf8");
  return content;
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
