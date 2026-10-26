import { asSchema } from "ai";
import type { ToolCallResult, ToolDescriptor } from "@ai-book-studio/core/agent/tools";
import { CheckpointStore } from "./checkpoints";
import { chapterToolCatalog, createChapterTools, toolTier, type ChapterChange } from "./tools";
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
  constructor(private readonly getLibrary: () => Library | null) {}

  /** Every tool the studio can run, with its schema and safety tier. */
  catalog(): ToolDescriptor[] {
    return chapterToolCatalog();
  }

  /** Run one tool against one book and return its result unchanged. */
  async run(request: ToolRunRequest): Promise<ToolCallResult> {
    const library = this.getLibrary();
    if (!library) {
      throw new ToolError("failed", "No library is open in the studio. Open a folder first.");
    }
    if (toolTier(request.name) === "destructive" && !request.allowDestructive) {
      throw new ToolError(
        "destructive-not-allowed",
        `${request.name} can remove or replace work. The caller must allow destructive tools explicitly.`
      );
    }

    const changes: ChapterChange[] = [];
    const tools = createChapterTools(library, request.bookId, (change) => {
      if (!changes.some((entry) => entry.chapterId === change.chapterId)) changes.push(change);
    });
    const bound = tools[request.name as keyof typeof tools] as unknown as ToolLike | undefined;
    if (!bound?.execute) {
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

  /** A restore point for a change another agent made, in the same format the studio's Undo reads. */
  private async recordCheckpoint(
    library: Library,
    request: ToolRunRequest,
    changes: ChapterChange[]
  ): Promise<void> {
    const store = new CheckpointStore(() => library.root);
    await store.save({
      turnId: `tool_${request.name}_${Date.now()}`,
      bookId: request.bookId,
      at: new Date().toISOString(),
      prompt: `Changed with ${request.name}.`,
      entries: changes.map((change) => ({
        chapterId: change.chapterId,
        title: change.title,
        before: change.before,
        ...(change.created ? { created: true } : {}),
        ...(change.deleted ? { deleted: true } : {}),
        ...(change.order !== undefined ? { order: change.order } : {})
      }))
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
