/**
 * The contract for the studio's writing tools.
 *
 * The built-in agent, the loopback backend and the MCP server all speak these names, descriptions
 * and tiers. The catalog itself is produced by the desktop app, which owns the tool definitions and
 * the library; this module only carries the shape that crosses a process boundary.
 */

export const TOOL_TIERS = ["read", "write", "destructive"] as const;

/**
 * `read` only looks at the book. `write` changes it. `destructive` changes it in a way the author
 * cannot recover from a diff alone, so the built-in agent asks for approval before it runs and the
 * toolkit keeps it off unless the caller opts in.
 */
export type ToolTier = (typeof TOOL_TIERS)[number];

/** One tool as the backend and the MCP server describe it. */
export interface ToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
  tier: ToolTier;
}

/** The result of one tool call, exactly as the tool produced it. */
export interface ToolCallResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}
