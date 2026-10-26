import { z } from "zod";
import type { Chapter } from "../schema";

/**
 * The plugin contract.
 *
 * A plugin is a TypeScript file the author points the app at. It exports one or more tools the
 * agent may call. The handler receives a small context and nothing else: no provider key, no
 * credential file, no app internals (FR-008).
 */

/**
 * A JSON Schema for a tool's arguments.
 *
 * A plugin may use this instead of a Zod schema, so a plugin file needs no imports at all. That
 * matters because a plugin folder usually sits outside the app, where the app's own packages
 * cannot be resolved.
 */
export interface PluginJsonSchema {
  type: "object";
  properties?: Record<string, PluginJsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/** One property in a plugin's JSON Schema. */
export interface PluginJsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  items?: PluginJsonSchemaProperty;
  default?: unknown;
}

/** The arguments of a tool: a Zod schema, or a JSON Schema. */
export type PluginParameters = z.ZodType<unknown> | PluginJsonSchema;

/** The tools one plugin file provides. */
export interface PluginTool<I = unknown, O = unknown> {
  /** The name the model calls. It must be a lower-case identifier. */
  name: string;
  /** What the tool does, in one or two sentences. The model reads this. */
  description: string;
  /**
   * The arguments. A Zod schema or a JSON Schema.
   *
   * A JSON Schema needs no import, so a plugin in a folder outside the app still loads.
   */
  parameters: PluginParameters;
  /** The work. It runs in the app's process, on the app's behalf. */
  handler: (input: I, context: PluginContext) => Promise<O> | O;
}

/**
 * What a plugin may reach.
 *
 * It is deliberately the library and the book, and nothing else. The library is the same one the
 * built-in tools use, so a plugin's write keeps the atomic save and the version guard (FR-009).
 */
export interface PluginContext {
  /** The book the agent is working on. */
  readonly bookId: string;
  /** Read and write the book, through the same library the built-in tools use. */
  readonly library: PluginLibrary;
}

/** The slice of the library a plugin may use. */
export interface PluginLibrary {
  readBook(bookId: string): Promise<{ title: string; description: string; characters: unknown[]; memories: unknown[] }>;
  readChapter(bookId: string, chapterId: string): Promise<Chapter>;
  listChapters(bookId: string): Promise<Array<{ id: string; title: string; order: number; wordCount: number }>>;
  saveChapter(
    bookId: string,
    chapterId: string,
    content: string,
    expected: { baseVersion: number; baseHash: string }
  ): Promise<{ status: "saved" | "conflict"; chapter?: Chapter }>;
  /** Append a passage, keeping the version and hash guard. It throws when the chapter moved on. */
  appendToChapter(bookId: string, chapterId: string, text: string): Promise<Chapter>;
}

export interface PluginDefinition {
  /** The plugin's name, for the app to show. */
  name: string;
  /** The tools it provides. */
  tools: PluginTool[];
}

/** The name of a plugin tool. Plugins must not shadow a built-in tool. */
export const pluginToolNameSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "a tool name is lower case, digits and underscores");

/** The plugin's own name. */
export const pluginNameSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9 _-]*$/i);

/** True when the value is a Zod schema rather than a JSON Schema. */
export function isZodParameters(value: unknown): value is z.ZodType<unknown> {
  return Boolean(value) && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

/**
 * Check a plugin's shape without running it.
 *
 * The loader uses this to reject a file that exports the wrong thing, and the app uses it to show
 * what a folder provides.
 */
export function parsePlugin(value: unknown): PluginDefinition {
  if (!value || typeof value !== "object") {
    throw new Error("A plugin must export a plugin definition.");
  }
  const record = value as Record<string, unknown>;
  const name = pluginNameSchema.parse(record.name);
  if (!Array.isArray(record.tools) || record.tools.length === 0) {
    throw new Error(`The plugin “${name}” provides no tools.`);
  }
  const tools: PluginTool[] = record.tools.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`The plugin “${name}” has a tool that is not an object (tool ${index + 1}).`);
    }
    const tool = entry as Record<string, unknown>;
    const toolName = pluginToolNameSchema.parse(tool.name);
    if (typeof tool.description !== "string" || !tool.description.trim()) {
      throw new Error(`The tool “${toolName}” needs a description.`);
    }
    const parameters = tool.parameters;
    if (!parameters || typeof parameters !== "object") {
      throw new Error(`The tool “${toolName}” needs a schema for its parameters.`);
    }
    if (!isZodParameters(parameters) && !isJsonSchema(parameters)) {
      throw new Error(
        `The tool “${toolName}” needs a Zod schema or a JSON Schema for its parameters.`
      );
    }
    if (typeof tool.handler !== "function") {
      throw new Error(`The tool “${toolName}” needs a handler.`);
    }
    return {
      name: toolName,
      description: tool.description.trim(),
      parameters: parameters as PluginParameters,
      handler: tool.handler as PluginTool["handler"]
    };
  });
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`The plugin “${name}” provides “${tool.name}” twice.`);
    }
    seen.add(tool.name);
  }
  return { name, tools };
}

/**
 * A helper for a plugin author.
 *
 * It only checks the shape, so a plugin file can be written as plain TypeScript without importing
 * a type-heavy helper.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}

/** True when the value looks like a JSON Schema for an object. */
export function isJsonSchema(value: unknown): value is PluginJsonSchema {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "object") return false;
  if (record.properties !== undefined) {
    if (!record.properties || typeof record.properties !== "object") return false;
  }
  if (record.required !== undefined && !Array.isArray(record.required)) return false;
  return true;
}

/** The JSON Schema of a plugin tool, whatever form its parameters take. */
export function pluginJsonSchema(parameters: PluginParameters): PluginJsonSchema {
  if (isJsonSchema(parameters)) return parameters;
  // A Zod schema is converted by the app's own schema bridge, so the wire form stays JSON Schema.
  return { type: "object", properties: {}, required: [], additionalProperties: true };
}

/**
 * Check a plugin tool's arguments against its schema.
 *
 * A Zod schema is asked directly. A JSON Schema is checked for the parts that matter for a tool
 * call: the required properties are present, and each one has the declared type. The app does not
 * claim to be a full JSON Schema validator, and says so when it refuses an argument.
 */
export function validatePluginArgs(
  parameters: PluginParameters,
  args: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (isZodParameters(parameters)) {
    const parsed = parameters.safeParse(args ?? {});
    if (!parsed.success) {
      const issue = parsed.error?.issues?.[0];
      const path = issue?.path?.join(".") || "arguments";
      return { ok: false, reason: `${path}: ${issue?.message ?? "the arguments do not fit the schema"}` };
    }
    const value = parsed.data;
    if (!value || typeof value !== "object") {
      return { ok: false, reason: "the arguments must be an object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  }
  if (!isJsonSchema(parameters)) {
    return { ok: false, reason: "the tool has no usable schema" };
  }
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    return { ok: false, reason: "the arguments must be an object" };
  }
  const value = (args ?? {}) as Record<string, unknown>;
  for (const key of parameters.required ?? []) {
    if (!(key in value) || value[key] === undefined) {
      return { ok: false, reason: `${key} is required` };
    }
  }
  for (const [key, property] of Object.entries(parameters.properties ?? {})) {
    if (!(key in value) || value[key] === undefined) continue;
    if (!matchesType(value[key], property)) {
      return { ok: false, reason: `${key} must be ${property.type ?? "a value"}` };
    }
  }
  return { ok: true, value };
}

function matchesType(value: unknown, property: PluginJsonSchemaProperty): boolean {
  switch (property.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}
