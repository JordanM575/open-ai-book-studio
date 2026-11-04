import { asSchema } from "ai";
import type { ToolCallResult, ToolDescriptor } from "@ai-book-studio/core/agent/tools";
import {
  isZodParameters,
  validatePluginArgs
} from "@ai-book-studio/core/agent/plugins";
import { CheckpointStore, recordChange, type CheckpointEntry } from "./checkpoints";
import { chapterToolCatalog, createChapterTools, toolTier } from "./tools";
import { loadPlugins, pluginTools } from "./plugins";
import { pluginLibrary } from "./tool-set";
import type { Library } from "../library/store";

/** The AI SDK's tool object, reduced to the parts the bridge needs. */
interface ToolLike {
  description?: string;
  inputSchema: unknown;
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
}

export interface ToolRunRequest {
  bookId: string;
  name: string;
  args: unknown;
  /**
   * Destructive tools replace or remove work in a way the author cannot read back from a diff.
   * The caller must ask for them by name; the token alone is not enough.
   */
  allowDestructive?: boolean;
}

export class ToolError extends Error {
  constructor(
    readonly code: "unknown-tool" | "invalid-arguments" | "destructive-not-allowed" | "failed",
    message: string
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * The studio's writing tools, reachable from outside the app.
 *
 * The bridge does not re-implement a tool: it binds the very same definitions the built-in agent
 * uses to the open library, checks the caller's arguments with the tool's own schema, and records
 * an undo checkpoint so the author can revert a change made by another agent.
 */
export class ToolBridge {
  constructor(
    private readonly getLibrary: () => Library | null,
    /** The library-level plugin folder, if the author pointed at one. */
    private readonly pluginFolder: () => string | null = () => null
  ) {}

  /** Every tool the studio can run, with its schema and safety tier. */
  async catalog(): Promise<ToolDescriptor[]> {
    const builtIn = chapterToolCatalog();
    const plugins = await this.pluginCatalog();
    return [...builtIn, ...plugins];
  }

  /**
   * The tools the studio will actually run for a book.
   *
   * A tool the author withdrew for that book is left out, so the app and the toolkit see the same
   * list the agent gets (FR-004).
   */
  async catalogFor(bookId: string): Promise<ToolDescriptor[]> {
    const library = this.getLibrary();
    if (!library) return [];
    const { book } = await library.readBook(bookId);
    const disabled = new Set(book.settings?.agent?.disabledTools ?? []);
    const all = await this.catalog();
    return all.filter((tool) => !disabled.has(tool.name));
  }

  /** The tools the loaded plugins provide, in the same shape as the built-in ones. */
  private async pluginCatalog(): Promise<ToolDescriptor[]> {
    const loaded = await loadPlugins(this.pluginFolder());
    return pluginTools(loaded.plugins).map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      inputSchema: isZodParameters(plugin.parameters)
        ? (asSchema(plugin.parameters as never).jsonSchema as Record<string, unknown>)
        : (plugin.parameters as unknown as Record<string, unknown>),
      tier: "write" as const
    }));
  }

  /** Run one tool against one book and return its result unchanged. */
  async run(request: ToolRunRequest): Promise<ToolCallResult> {
    const library = this.getLibrary();
    if (!library) {
      throw new ToolError("failed", "No library is open in the studio. Open a folder first.");
    }
    const { book } = await library.readBook(request.bookId);
    const disabled = new Set(book.settings?.agent?.disabledTools ?? []);
    if (disabled.has(request.name)) {
      throw new ToolError(
        "unknown-tool",
        `${request.name} is turned off for this book. The author withdrew it.`
      );
    }
    if (toolTier(request.name) === "destructive" && !request.allowDestructive) {
      throw new ToolError(
        "destructive-not-allowed",
        `${request.name} can remove or replace work. The caller must allow destructive tools explicitly.`
      );
    }

    const changes: CheckpointEntry[] = [];
    const tools = createChapterTools(library, request.bookId, (change) => {
      recordChange(changes, change);
    });
    const bound = tools[request.name as keyof typeof tools] as unknown as ToolLike | undefined;

    // A plugin tool, when the author has pointed the app at a folder.
    if (!bound?.execute) {
      const plugin = await this.runPluginTool(library, request);
      if (plugin) return plugin;
      throw new ToolError("unknown-tool", `Unknown tool: ${request.name}`);
    }

    const schema = asSchema(bound.inputSchema as never);
    const validate = schema.validate;
    if (!validate) {
      throw new ToolError("failed", `${request.name} has no argument schema.`);
    }
    const parsed = await validate(request.args ?? {});
    if (!parsed.success) {
      throw new ToolError(
        "invalid-arguments",
        `Those arguments do not fit ${request.name}: ${describe(parsed.error)}`
      );
    }

    const result = (await bound.execute(parsed.value, {
      toolCallId: `tool_${request.name}`,
      messages: []
    })) as ToolCallResult;

    if (changes.length > 0) await this.recordCheckpoint(library, request, changes);
    return result;
  }

  /**
   * Run a plugin tool, when the folder provides one with this name.
   *
   * The handler gets the library and the book id and nothing else, so it cannot reach a provider
   * key or the app's internals (FR-008).
   */
  private async runPluginTool(
    library: Library,
    request: ToolRunRequest
  ): Promise<ToolCallResult | null> {
    const loaded = await loadPlugins(this.pluginFolder());
    const plugin = pluginTools(loaded.plugins).find((entry) => entry.name === request.name);
    if (!plugin) return null;
    const checked = validatePluginArgs(plugin.parameters, request.args ?? {});
    if (!checked.ok) {
      throw new ToolError(
        "invalid-arguments",
        `Those arguments do not fit ${request.name}: ${checked.reason}`
      );
    }
    const result = await plugin.handler(checked.value as never, {
      bookId: request.bookId,
      library: pluginLibrary(library)
    });
    return { ok: true, message: "Done.", result } as ToolCallResult;
  }

  /** A restore point for a change another agent made, in the same format the studio's Undo reads. */
  private async recordCheckpoint(
    library: Library,
    request: ToolRunRequest,
    changes: CheckpointEntry[]
  ): Promise<void> {
    const store = new CheckpointStore(library);
    // `recordChange` already folded the changes into entries and dropped what the tools only compare.
    await store.save({
      turnId: `tool_${request.name}_${Date.now()}`,
      bookId: request.bookId,
      at: new Date().toISOString(),
      prompt: `Changed with ${request.name}.`,
      entries: changes
    });
  }
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
    return issues
      .map((issue) => `${issue.path?.join(".") || "arguments"}: ${issue.message ?? "invalid"}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
