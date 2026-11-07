import type { AgentMode } from "@ai-book-studio/core/agent/messages";
import { READ_TOOL_NAMES, toolTier } from "./tools";

export const DISCUSS_NEXT_STEP = "Discuss cannot change your book. Send a new turn in Edit mode to request changes.";

/** Closed built-in allowlist: neither unknown tools nor plugins can declare themselves safe. */
export function modeAllowsTool(mode: AgentMode, name: string): boolean {
  return mode === "edit" || (mode === "discuss" &&
    (READ_TOOL_NAMES as readonly string[]).includes(name) && toolTier(name) === "read");
}
