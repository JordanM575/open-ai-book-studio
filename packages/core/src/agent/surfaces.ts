import type { ToolDescriptor, ToolTier } from "./tools";

/**
 * The studio's tools in other people's shapes.
 *
 * The built-in agent, the loopback backend and the MCP server all speak the studio's own catalog.
 * Meta's surfaces speak two more shapes, and the catalog is already close enough to both that the
 * mapping is a rename rather than a translation:
 *
 * - **WebMCP** lets a page register its actions as tools that an assistant can call, through
 *   `document.modelContext`. A tool is a name, a title, a description, a JSON Schema, an
 *   annotations block and an `execute`. The studio's `read` tier is `readOnlyHint`, and the
 *   `destructive` tier is `consequentialHint`.
 * - **Meta AI Connectors** turn a REST API or an MCP server into tools the Meta AI assistant can
 *   call. Meta asks every tool to be classified Read or Write, and a write that removes or
 *   replaces work to be marked sensitive.
 *
 * Nothing here talks to Meta. These are the descriptions, so a caller can hand them over.
 */

/** The annotations block a WebMCP tool carries. */
export interface WebMcpAnnotations {
  /** The tool only looks at the book. */
  readOnlyHint: boolean;
  /** The tool's output is data, not instructions. */
  untrustedContentHint: boolean;
  /** The tool removes or replaces work, so the caller should confirm it. */
  consequentialHint: boolean;
}

/** One tool as WebMCP describes it. */
export interface WebMcpTool {
  /** 1–128 characters of ASCII letters, digits, `_`, `-` and `.`. */
  name: string;
  title: string | null;
  description: string;
  /** The JSON Schema, stringified, as WebMCP's imperative registration takes it. */
  inputSchema: string;
  annotations: WebMcpAnnotations;
}

/** The WebMCP tool name rules. A name outside them would be rejected at registration. */
const WEB_MCP_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * The studio's catalog as WebMCP tools.
 *
 * The names already satisfy the WebMCP charset, because the studio's tool names are lower-case
 * identifiers. A name that would not is left out rather than mangled: a mangled name is a
 * different tool, and the caller would call the wrong one.
 */
export function webMcpTools(catalog: ToolDescriptor[]): WebMcpTool[] {
  return catalog
    .filter((tool) => WEB_MCP_NAME.test(tool.name))
    .map((tool) => ({
      name: tool.name,
      title: null,
      description: tool.description,
      inputSchema: JSON.stringify(tool.inputSchema),
      annotations: webMcpAnnotations(tool.tier)
    }));
}

/** The annotations a studio tier implies. */
export function webMcpAnnotations(tier: ToolTier): WebMcpAnnotations {
  return {
    readOnlyHint: tier === "read",
    // Every studio tool returns book content, which the caller must treat as data.
    untrustedContentHint: false,
    consequentialHint: tier === "destructive"
  };
}

/** How a studio tier reads to a connector reviewer. */
export type ConnectorClassification = "read" | "write";

/** One tool as a Meta AI connector describes it. */
export interface ConnectorTool {
  name: string;
  description: string;
  /** The JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>;
  /** Meta asks every tool to be classified Read or Write. */
  classification: ConnectorClassification;
  /** A write that removes or replaces work. Meta calls these sensitive writes. */
  sensitive: boolean;
  /** What the tool does to the book, in a sentence. */
  sideEffects: string;
  /** How the tool reports a refusal. */
  errors: string;
}

/** The studio's catalog as Meta AI connector tools. */
export function connectorTools(catalog: ToolDescriptor[]): ConnectorTool[] {
  return catalog.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    classification: tool.tier === "read" ? "read" : "write",
    sensitive: tool.tier === "destructive",
    sideEffects: sideEffectsFor(tool.tier),
    errors:
      "Refuses arguments that do not fit the schema, and refuses a tool the author has withdrawn for this book."
  }));
}

/** What a tier does to the book, said plainly for a reviewer. */
function sideEffectsFor(tier: ToolTier): string {
  if (tier === "read") return "None. The book is not changed.";
  if (tier === "write") return "Changes the book, and leaves an undo checkpoint the author can restore.";
  return "Removes or replaces work the author cannot recover from a diff. The studio asks for approval before it runs.";
}

/**
 * A connector's own manifest: the tools plus the notes Meta's review asks for.
 *
 * It is a description, not a registration. A connector still needs a public endpoint, an OAuth
 * link and Meta's review, and none of that is decided here.
 */
export interface ConnectorManifest {
  name: string;
  description: string;
  /** The tools, each classified. */
  tools: ConnectorTool[];
  /** How the connector authenticates. */
  authentication: string;
  /** The account link Meta asks for. */
  accountLinking: string;
  /** The scopes the connector asks for, in the studio's own words. */
  scopes: string[];
}

export function connectorManifest(catalog: ToolDescriptor[]): ConnectorManifest {
  return {
    name: "AI Book Studio",
    description:
      "Read and write the author's book in AI Book Studio: the chapters, the Story Bible and the agent's own writing tools, with an undo checkpoint for every change.",
    tools: connectorTools(catalog),
    authentication:
      "OAuth 2.0 account linking. The connector never holds a provider key and never sees the author's other books.",
    accountLinking:
      "The author links their own studio. A connector is offered a read-only scope where the service supports it.",
    scopes: [
      "read: the book, its chapters, the Story Bible and the word counts",
      "write: append to, replace in and restructure one chapter, leaving an undo checkpoint",
      "destructive: remove or replace work, only with the author's explicit approval each time"
    ]
  };
}
