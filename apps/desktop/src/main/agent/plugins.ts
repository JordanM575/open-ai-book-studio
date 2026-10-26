import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePlugin, type PluginDefinition, type PluginTool } from "@ai-book-studio/core/agent/plugins";

/** One file that could not be loaded, and why. */
export interface PluginLoadFailure {
  /** The file's name, not its full path. */
  file: string;
  /** What went wrong, in one sentence. */
  reason: string;
}

export interface LoadedPlugins {
  /** The plugins that loaded, in file order. */
  plugins: PluginDefinition[];
  /** The files that did not load. */
  failures: PluginLoadFailure[];
  /** The folder that was read, or `null` when none is set. */
  folder: string | null;
}

/** The tool files the loader looks for. */
const PLUGIN_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

/**
 * Load a folder of TypeScript tools.
 *
 * The folder holds plain TypeScript files, each exporting a plugin. Electron's main process is
 * Node 24, which strips the types itself, so a plugin needs no build step (D-149).
 *
 * A file that fails to load is reported and skipped: one broken plugin must not stop the agent
 * from using the built-in tools (FR-010).
 */
export async function loadPlugins(folder: string | null): Promise<LoadedPlugins> {
  if (!folder) {
    return { plugins: [], failures: [], folder: null };
  }
  const root = resolve(folder);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    return {
      plugins: [],
      failures: [{ file: root, reason: `The plugin folder could not be read: ${describe(error)}` }],
      folder: root
    };
  }

  const plugins: PluginDefinition[] = [];
  const failures: PluginLoadFailure[] = [];
  const files = entries
    .filter((name) => PLUGIN_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .sort();

  for (const file of files) {
    const path = join(root, file);
    try {
      const module = (await import(pathToFileURL(path).href)) as { default?: unknown; plugin?: unknown };
      const candidate = module.default ?? module.plugin;
      plugins.push(parsePlugin(candidate));
    } catch (error) {
      failures.push({ file, reason: describe(error) });
    }
  }
  return { plugins, failures, folder: root };
}

/** Every tool the loaded plugins provide, in a stable order. */
export function pluginTools(plugins: PluginDefinition[]): PluginTool[] {
  return plugins.flatMap((plugin) => plugin.tools);
}

/**
 * Check a plugin folder without running it.
 *
 * The app uses this when the author points at a folder, so a path that does not exist is reported
 * before a turn is ever attempted.
 */
export function validatePluginFolder(folder: string): string | null {
  if (!folder.trim()) return "The plugin folder is empty.";
  if (!isAbsolute(folder)) {
    return "The plugin folder must be an absolute path.";
  }
  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
