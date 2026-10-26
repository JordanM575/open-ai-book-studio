import { describe, expect, test } from "bun:test";
import type { ToolDescriptor } from "../src/agent/tools";
import {
  connectorManifest,
  connectorTools,
  webMcpAnnotations,
  webMcpTools
} from "../src/agent/surfaces";

const catalog: ToolDescriptor[] = [
  {
    name: "read_story_bible",
    description: "Read the full Story Bible.",
    inputSchema: { type: "object", properties: {} },
    tier: "read"
  },
  {
    name: "append_to_chapter",
    description: "Add a passage to the end of a chapter.",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "string" }, text: { type: "string" } },
      required: ["chapterId", "text"]
    },
    tier: "write"
  },
  {
    name: "overwrite_chapter",
    description: "Replace a chapter's entire text in one call.",
    inputSchema: { type: "object", properties: { chapterId: { type: "string" } } },
    tier: "destructive"
  }
];

describe("the WebMCP surface", () => {
  test("carries the studio's names, descriptions and schemas", () => {
    const tools = webMcpTools(catalog);
    expect(tools.map((tool) => tool.name)).toEqual([
      "read_story_bible",
      "append_to_chapter",
      "overwrite_chapter"
    ]);
    expect(tools[0]?.description).toBe("Read the full Story Bible.");
    expect(JSON.parse(tools[1]?.inputSchema ?? "{}")).toMatchObject({
      type: "object",
      required: ["chapterId", "text"]
    });
  });

  test("marks a read tool read-only and a destructive one consequential", () => {
    const tools = webMcpTools(catalog);
    expect(tools[0]?.annotations.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations.consequentialHint).toBe(false);
    expect(tools[1]?.annotations.readOnlyHint).toBe(false);
    expect(tools[1]?.annotations.consequentialHint).toBe(false);
    expect(tools[2]?.annotations.readOnlyHint).toBe(false);
    expect(tools[2]?.annotations.consequentialHint).toBe(true);
  });

  test("uses names WebMCP will accept", () => {
    for (const tool of webMcpTools(catalog)) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    }
  });

  test("leaves out a name WebMCP would reject rather than mangle it", () => {
    const tools = webMcpTools([...catalog, { ...catalog[0]!, name: "not a valid name" }]);
    expect(tools.map((tool) => tool.name)).not.toContain("not a valid name");
  });
});

describe("the connector surface", () => {
  test("classifies every tool as read or write", () => {
    const tools = connectorTools(catalog);
    expect(tools[0]?.classification).toBe("read");
    expect(tools[1]?.classification).toBe("write");
    expect(tools[2]?.classification).toBe("write");
  });

  test("marks the destructive tools sensitive and the rest not", () => {
    const tools = connectorTools(catalog);
    expect(tools[0]?.sensitive).toBe(false);
    expect(tools[1]?.sensitive).toBe(false);
    expect(tools[2]?.sensitive).toBe(true);
  });

  test("says what each tier does to the book", () => {
    const tools = connectorTools(catalog);
    expect(tools[0]?.sideEffects).toMatch(/not changed/i);
    expect(tools[1]?.sideEffects).toMatch(/undo checkpoint/i);
    expect(tools[2]?.sideEffects).toMatch(/approval/i);
  });

  test("carries the schemas a reviewer needs", () => {
    const tools = connectorTools(catalog);
    expect(tools[1]?.inputSchema).toMatchObject({ type: "object" });
    expect(tools[0]?.errors).toMatch(/withdrawn/i);
  });

  test("names the scopes and the account link a reviewer asks for", () => {
    const manifest = connectorManifest(catalog);
    expect(manifest.name).toBe("AI Book Studio");
    expect(manifest.tools).toHaveLength(3);
    expect(manifest.accountLinking).toMatch(/links their own studio/i);
    expect(manifest.scopes.join(" ")).toMatch(/undo checkpoint/i);
  });
});

describe("the annotations", () => {
  test("follow the tier and nothing else", () => {
    expect(webMcpAnnotations("read")).toEqual({
      readOnlyHint: true,
      untrustedContentHint: false,
      consequentialHint: false
    });
    expect(webMcpAnnotations("write").readOnlyHint).toBe(false);
    expect(webMcpAnnotations("destructive").consequentialHint).toBe(true);
  });
});
