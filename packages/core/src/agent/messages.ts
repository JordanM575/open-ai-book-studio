import { z } from "zod";
import { COST_BASES } from "../providers/usage";
import { providerIdSchema } from "../providers/types";
import { contextBreakdownSchema } from "./context";

/**
 * The studio's own message format. It is deliberately not an AI SDK type: the runtime converts to
 * and from `ModelMessage` at the provider edge, while storage, IPC and the interface use these
 * parts. A provider or SDK upgrade therefore cannot change what the author sees or what is saved.
 */

const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());
const messageId = /^msg_[A-Za-z0-9-]{6,}$/;
const threadId = /^thread_[A-Za-z0-9-]{6,}$/;
const bookId = /^book_[A-Za-z0-9-]{6,}$/;

export const agentMessageIdSchema = z.string().regex(messageId, "invalid message id").max(200);
export const agentThreadIdSchema = z.string().regex(threadId, "invalid thread id").max(200);
export const agentBookIdSchema = z.string().regex(bookId, "invalid book id").max(200);

export const agentTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(200_000)
});

export const agentReasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string().min(1).max(200_000),
  /** Providers that redact or omit reasoning still get a part, so the UI can say so. */
  redacted: z.boolean().optional()
});

export const agentToolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  input: z.unknown()
});

export const agentToolResultPartSchema = z.object({
  type: z.literal("tool-result"),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  output: z.unknown(),
  isError: z.boolean().optional()
});

export const agentSourcePartSchema = z.object({
  type: z.literal("source"),
  url: z.string().url().max(2_000),
  title: z.string().max(300).optional()
});

export const agentFilePartSchema = z.object({
  type: z.literal("file"),
  mediaType: z.string().min(1).max(200),
  name: z.string().max(300).optional(),
  /** Base64 data, kept as a string so the format survives JSON and structured clone. */
  data: z.string().min(1).max(20_000_000)
});

export const AGENT_APPROVAL_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export type AgentApprovalStatus = (typeof AGENT_APPROVAL_STATUSES)[number];

/**
 * A destructive tool call waiting for the author. It is stored with the turn so a reload can show
 * the same card; the runtime updates the status when the author answers or the turn stops.
 */
export const agentApprovalPartSchema = z.object({
  type: z.literal("approval"),
  approvalId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  input: z.unknown(),
  status: z.enum(AGENT_APPROVAL_STATUSES),
  requestedAt: isoDate,
  resolvedAt: isoDate.optional()
});

export const agentErrorPartSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(2_000)
});

export const agentPartSchema = z.discriminatedUnion("type", [
  agentTextPartSchema,
  agentReasoningPartSchema,
  agentToolCallPartSchema,
  agentToolResultPartSchema,
  agentSourcePartSchema,
  agentFilePartSchema,
  agentApprovalPartSchema,
  agentErrorPartSchema
]);

export const agentModelSchema = z.object({
  provider: providerIdSchema,
  modelId: z.string().min(1).max(200),
  connectionLabel: z.string().max(200)
});

export const agentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().nullable(),
  costBasis: z.enum(COST_BASES),
  /** The selected model's context window when the catalogue reported one. */
  contextLength: z.number().int().positive().nullable().optional()
});

export const agentMessageSchema = z.object({
  id: agentMessageIdSchema,
  role: z.enum(["user", "assistant"]),
  parts: z.array(agentPartSchema).min(1).max(1_000),
  model: agentModelSchema.optional(),
  usage: agentUsageSchema.optional(),
  /** Where the request's estimated context went, stored with the turn. */
  context: contextBreakdownSchema.optional(),
  /** The run that produced this message, when there was one. Used to find its checkpoint. */
  turnId: z.string().min(1).max(80).optional(),
  createdAt: isoDate
});

export const agentThreadSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    id: agentThreadIdSchema,
    bookId: agentBookIdSchema,
    title: z.string().max(200).default("New conversation"),
    createdAt: isoDate,
    updatedAt: isoDate,
    messages: z.array(agentMessageSchema).max(2_000).default([]),
    /** Turn ids whose checkpoints belong to this conversation, newest last. */
    checkpointTurns: z.array(z.string().min(1).max(200)).max(200).default([])
  })
  .superRefine((thread, context) => {
    const seen = new Set<string>();
    for (const [index, message] of thread.messages.entries()) {
      if (seen.has(message.id)) {
        context.addIssue({
          code: "custom",
          message: "Message ids must be unique inside a conversation.",
          path: ["messages", index, "id"]
        });
      }
      seen.add(message.id);
    }
  });

export type AgentTextPart = z.infer<typeof agentTextPartSchema>;
export type AgentReasoningPart = z.infer<typeof agentReasoningPartSchema>;
export type AgentToolCallPart = z.infer<typeof agentToolCallPartSchema>;
export type AgentToolResultPart = z.infer<typeof agentToolResultPartSchema>;
export type AgentSourcePart = z.infer<typeof agentSourcePartSchema>;
export type AgentFilePart = z.infer<typeof agentFilePartSchema>;
export type AgentApprovalPart = z.infer<typeof agentApprovalPartSchema>;
export type AgentErrorPart = z.infer<typeof agentErrorPartSchema>;
export type AgentPart = z.infer<typeof agentPartSchema>;
export type AgentModel = z.infer<typeof agentModelSchema>;
export type AgentUsage = z.infer<typeof agentUsageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentThread = z.infer<typeof agentThreadSchema>;

/** The visible prose of one message, without reasoning or tool payloads. */
export function messageText(message: AgentMessage): string {
  return message.parts
    .filter((part): part is AgentTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** The last visible text in a conversation, used for a list preview. */
export function lastMessageText(thread: AgentThread): string {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(thread.messages[index]!);
    if (text) return text;
  }
  return "";
}

export function parseAgentThread(value: unknown): AgentThread {
  return agentThreadSchema.parse(value);
}

export function parseAgentMessage(value: unknown): AgentMessage {
  return agentMessageSchema.parse(value);
}

export function serializeAgentThread(thread: AgentThread): string {
  return `${JSON.stringify(agentThreadSchema.parse(thread), null, 2)}\n`;
}
