import {
  ToolLoopAgent,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolSet
} from "ai";
import type { AgentEvent, AgentTurnInput, AgentTurnResult, AgentTurnStarted } from "@ai-book-studio/core/agent";
import {
  agentMessageSchema,
  messageText,
  type AgentApprovalPart,
  type AgentApprovalStatus,
  type AgentErrorPart,
  type AgentMessage,
  type AgentPart,
  type AgentThread,
  type AgentUsage
} from "@ai-book-studio/core/agent/messages";
import { compactHistory } from "@ai-book-studio/core/agent/history";
import { contextBreakdown, type ContextBreakdown } from "@ai-book-studio/core/agent/context";
import type { ThreadStore } from "@ai-book-studio/core/agent/threads";
import { findModel, unavailableReason } from "@ai-book-studio/core/providers/models";
import { isContributorModelId } from "@ai-book-studio/core/providers/compatibility";
import { reportedCost } from "@ai-book-studio/core/providers/openrouter";
import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import { redact } from "@ai-book-studio/core/providers/redact";
import type { ProviderId, StoredCredential } from "@ai-book-studio/core/providers/types";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import type { Studio } from "../studio";
import type { ProviderService } from "../providers";
import { UsageStore } from "../usage";
import { newId } from "../library/paths";
import { modelFor } from "./transport";
import { CheckpointStore } from "./checkpoints";
import { DESTRUCTIVE_TOOL_NAMES, type ChapterChange } from "./tools";
import { buildToolSet } from "./tool-set";
import { buildPrompt } from "./prompt";
import { readBookSkills } from "./skills";
import { cachePrefixFor } from "./cache";
import { loadPlugins, pluginTools, type LoadedPlugins } from "./plugins";
import type { PluginTool } from "@ai-book-studio/core/agent/plugins";
import { MetricsStore } from "../metrics";

interface PendingApproval {
  approvalId: string;
  resume: (approved: boolean) => void;
}

interface ActiveTurn {
  controller: AbortController;
  bookId: string;
  bookTitle: string;
  threadId: string;
  messageId: string;
  background: boolean;
  state: TurnState;
  pending?: PendingApproval | undefined;
}

export type AgentOutcomeKind = "done" | "error" | "stopped" | "approval";

/** What the main process needs for a notification. It carries no key and no full manuscript. */
export interface AgentOutcome {
  kind: AgentOutcomeKind;
  turnId: string;
  bookId: string;
  bookTitle: string;
  threadId: string;
  background: boolean;
  text: string;
  changed: number;
  message?: string;
  approvalName?: string;
}

interface TurnState {
  text: string;
  reasoning: string;
  toolParts: AgentPart[];
  approvals: AgentApprovalPart[];
  changes: ChapterChange[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Whether the provider reported its cache at all. A measured zero is not the same thing. */
  cacheReported: boolean;
  costUsd: number | null;
  contextLength: number | null;
  context: ContextBreakdown;
  steps: number;
  /** Stable for the whole turn so the paused and finished messages share one id. */
  createdAt: string;
  persisted: boolean;
  checkpointAttempted: boolean;
  checkpointSaved: boolean;
}

const MAX_STEPS = 20;

/** Replaceable at the edge so tests and future provider adapters do not need a network. */
export type AgentModelFactory = (credential: StoredCredential, modelId: string) => LanguageModel;

/**
 * Runs one author turn at a time per turn id, in the main process. The model and tools live here;
 * the renderer only receives text, tool names and a final usage line. Every turn is written to the
 * book's thread store, so a reload resumes the conversation instead of losing it.
 */
export class AgentRuntime {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly listeners = new Set<(event: AgentEvent) => void>();

  constructor(
    private readonly studio: Studio,
    private readonly providers: ProviderService,
    private readonly emit: (event: AgentEvent) => void,
    private readonly makeModel: AgentModelFactory = modelFor,
    private readonly onOutcome: (outcome: AgentOutcome) => void = () => {},
    /** The library-level plugin folder, if the author pointed at one. */
    private readonly pluginFolder: () => string | null = () => null,
    /** Where the per-book tool metrics are kept. */
    private readonly metrics: MetricsStore | null = null
  ) {}

  /** True while a turn the author explicitly marked as background is still alive. */
  hasActiveBackgroundTurns(): boolean {
    return [...this.active.values()].some((turn) => turn.background);
  }

  /**
   * Whether the agent is working on a book right now.
   *
   * The ambient status reports it, so the panel's Stop is offered only when there is something to
   * stop, and a phone can stop a turn it did not start.
   */
  isWorking(bookId: string): boolean {
    return [...this.active.values()].some((turn) => turn.bookId === bookId);
  }

  /** Stop every running turn for a book, and say how many were stopped. */
  async stopBook(bookId: string): Promise<number> {
    const turns = [...this.active.entries()]
      .filter(([, turn]) => turn.bookId === bookId)
      .map(([turnId]) => turnId);
    for (const turnId of turns) await this.stop(turnId);
    return turns.length;
  }

  /**
   * The plugin tools for a book.
   *
   * A folder that fails to load is reported to the caller and the turn carries on with the built-in
   * tools (FR-010).
   */
  private async pluginToolsFor(): Promise<PluginTool[]> {
    const loaded = await loadPlugins(this.pluginFolder());
    this.lastPluginLoad = loaded;
    return pluginTools(loaded.plugins);
  }

  /** What the last plugin load found, so the app can show it. */
  lastPluginLoad: LoadedPlugins | null = null;

  /** Record one tool call's outcome for the book's metrics (FR-003). */
  private async recordToolCall(bookId: string, name: string, ok: boolean): Promise<void> {
    if (!this.metrics) return;
    try {
      await this.metrics.append(bookId, { name, ok, at: new Date().toISOString() });
    } catch (error) {
      console.warn("[agent] Could not record the tool metric:", redact((error as Error).message));
    }
  }

  /**
   * Tell the shell what happened so it can notify when the window is hidden. The callback is
   * best-effort: a failed notification must never fail a turn or lose its saved message.
   */
  private reportOutcome(
    turnId: string,
    kind: AgentOutcomeKind,
    state: TurnState,
    extra: { message?: string; approvalName?: string } = {}
  ): void {
    const turn = this.active.get(turnId);
    if (!turn) return;
    try {
      this.onOutcome({
        kind,
        turnId,
        bookId: turn.bookId,
        bookTitle: turn.bookTitle,
        threadId: turn.threadId,
        background: turn.background,
        text: state.text,
        changed: state.changes.length,
        ...(extra.message ? { message: extra.message } : {}),
        ...(extra.approvalName ? { approvalName: extra.approvalName } : {})
      });
    } catch (error) {
      console.warn("[agent] Could not report the turn outcome:", redact((error as Error).message));
    }
  }

  /**
   * Listen to a turn's events.
   *
   * The renderer watches them through the app's own channel. This is for the callers that want
   * the same events without a window: the control plane, and anything reaching the studio over
   * it.
   */
  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Send an event to the window and to every listener. */
  private publish(event: AgentEvent): void {
    try {
      this.emit(event);
    } catch (error) {
      console.warn("[agent] Could not report an event:", redact((error as Error).message));
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[agent] Could not deliver an event:", redact((error as Error).message));
      }
    }
  }

  /**
   * Run a turn and wait for its answer.
   *
   * The renderer wants the stream, so it watches the events. A caller on the control plane wants
   * the answer, so it waits for the turn to finish. It is the same turn, with the same rules,
   * the same checkpoints and the same approvals.
   */
  async runToCompletion(input: AgentTurnInput): Promise<AgentTurnResult> {
    const started = await this.start(input);
    return new Promise<AgentTurnResult>((resolve, reject) => {
      const unsubscribe = this.onEvent((event) => {
        if (event.turnId !== started.turnId) return;
        if (event.type === "done") {
          unsubscribe();
          resolve({
            turnId: started.turnId,
            threadId: started.threadId,
            text: event.text,
            changed: event.changed ?? 0,
            costUsd: event.costUsd
          });
        } else if (event.type === "error") {
          unsubscribe();
          reject(new ProviderError("unknown", event.message));
        } else if (event.type === "stopped") {
          unsubscribe();
          resolve({
            turnId: started.turnId,
            threadId: started.threadId,
            text: "",
            changed: event.changed ?? 0,
            stopped: true
          });
        } else if (event.type === "approval") {
          /*
           * The turn is waiting for the author, and the author can only approve in the app. The
           * turn stays paused; the caller is told why it is not finished.
           */
          unsubscribe();
          reject(
            new ProviderError(
              "invalid-request",
              `The agent needs your approval for ${event.name} in the app before it can carry on.`
            )
          );
        }
      });
    });
  }

  async start(input: AgentTurnInput): Promise<AgentTurnStarted> {    const library = this.studio.requireLibrary();
    const { book, chapters } = await library.readBook(input.bookId);
    const connectionId = input.model?.connectionId ?? book.defaultConnectionId;
    const modelId = input.model?.modelId ?? book.defaultModelId;
    if (!connectionId || !modelId) {
      throw new ProviderError("invalid-request", "Choose a model for this book before asking the agent to write.");
    }
    if (isContributorModelId(modelId) && !book.allowContributorTraining) {
      throw new ProviderError(
        "invalid-request",
        "Muse Spark Contributor may use this book's content to train Meta's models. Allow Contributor training for this book in the model picker, or choose the Standard model."
      );
    }
    const credential = await this.providers.credential(connectionId);
    let contextLength: number | null = null;
    try {
      const catalogue = await this.providers.models(connectionId);
      const selected = findModel(catalogue, modelId);
      if (input.model) {
        if (!selected) {
          throw new ProviderError("not-found", "That model is no longer offered on this connection.");
        }
        const reason = unavailableReason(selected);
        if (reason) throw new ProviderError("unsupported", reason);
      }
      contextLength = selected?.contextLength ?? null;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      console.warn("[agent] Could not read the model's context length:", redact((error as Error).message));
    }
    const model = this.makeModel(credential, modelId);
    const prepared = await prepareThread(library.threads, input);
    const activeChapter = input.chapterId ? (chapters.find((chapter) => chapter.id === input.chapterId) ?? null) : null;
    const skills = await readBookSkills(
      library.root,
      input.bookId,
      book.settings?.agent?.skillsEnabled !== false
    );
    const built = buildPrompt({ book, chapters, activeChapter, skills: skills?.text ?? null });
    const compacted = compactHistory(prepared.thread).messages;
    const messages = modelMessagesFor(compacted);
    const context = contextBreakdown(
      built.sections,
      compacted.map((message) => messageText(message)).join("\n")
    );
    const messageId = newId("msg");
    const state: TurnState = {
      text: "",
      reasoning: "",
      toolParts: [],
      approvals: [],
      changes: [],
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheReported: false,
      costUsd: null,
      contextLength,
      context,
      steps: 0,
      createdAt: new Date().toISOString(),
      persisted: false,
      checkpointAttempted: false,
      checkpointSaved: false
    };
    const cache = cachePrefixFor(
      credential.provider,
      book.settings?.cache?.prefixMode !== "off"
    );
    const tools = buildToolSet(library, input.bookId, {
      disabledTools: book.settings?.agent?.disabledTools ?? [],
      pluginTools: await this.pluginToolsFor(),
      ...(cache.toolProviderOptions ? { toolProviderOptions: cache.toolProviderOptions } : {}),
      onBeforeChange: (change) => {
        if (!state.changes.some((existing) => existing.chapterId === change.chapterId)) state.changes.push(change);
      }
    });
    const agent = new ToolLoopAgent({
      id: "chapter-writer",
      model,
      instructions: cache.systemProviderOptions
        ? ({ role: "system", content: built.system, providerOptions: cache.systemProviderOptions } as const)
        : built.system,
      tools,
      // The destructive tools are the ones the toolkit also keeps behind an explicit opt-in. A
      // tool the author withdrew is not in the set, so it is not listed here either.
      toolApproval: Object.fromEntries(
        DESTRUCTIVE_TOOL_NAMES.filter((name) => name in tools).map((name) => [name, "user-approval"])
      ) as Record<string, "user-approval">,
      stopWhen: isStepCount(MAX_STEPS)
    });

    const turnId = newId("turn");
    const controller = new AbortController();
    this.active.set(turnId, {
      controller,
      bookId: input.bookId,
      bookTitle: book.title,
      threadId: prepared.thread.id,
      messageId,
      background: input.background === true,
      state
    });

    void this.run(
      turnId,
      input,
      agent,
      messages,
      controller,
      prepared.thread.id,
      library.threads,
      credential.provider,
      connectionId,
      credential.label,
      modelId,
      messageId,
      state
    );
    return { turnId, threadId: prepared.thread.id };
  }

  /** Stop a turn. A turn waiting on approval has no live stream, so close it here. */
  async stop(turnId: string): Promise<null> {
    const turn = this.active.get(turnId);
    if (!turn) return null;
    const pending = turn.pending;
    if (pending) {
      await this.setApprovalStatus(turn, pending.approvalId, "expired");
      this.publish({
        type: "stopped",
        turnId,
        changed: turn.state.changes.length,
        undoAvailable: turn.state.changes.length === 0 || turn.state.checkpointSaved
      });
    }
    turn.controller.abort();
    this.active.delete(turnId);
    return null;
  }

  /** Continue a turn that paused on a destructive tool call. */
  async approve(turnId: string, approvalId: string, approved: boolean): Promise<null> {
    const turn = this.active.get(turnId);
    if (!turn?.pending || turn.pending.approvalId !== approvalId) {
      throw new ProviderError("not-found", "That approval is no longer waiting. The turn may have stopped.");
    }
    await this.setApprovalStatus(turn, approvalId, approved ? "approved" : "denied");
    turn.pending.resume(approved);
    return null;
  }

  private async setApprovalStatus(
    turn: ActiveTurn,
    approvalId: string,
    status: AgentApprovalStatus
  ): Promise<void> {
    try {
      await this.studio.requireLibrary().threads.updateApproval(
        turn.bookId,
        turn.threadId,
        turn.messageId,
        approvalId,
        status
      );
    } catch (error) {
      console.warn("[agent] Could not record the approval:", redact((error as Error).message));
    }
  }

  /** Put every chapter this turn changed back the way it was, newest turn first. */
  async undoLast(bookId: string): Promise<{ restored: number; skipped: number }> {
    const library = this.studio.requireLibrary();
    const store = new CheckpointStore(() => this.studio.library?.root ?? null);
    const checkpoint = await store.latest(bookId);
    if (!checkpoint) {
      throw new ProviderError("not-found", "There is no agent turn to undo in this book.");
    }
    let restored = 0;
    let skipped = 0;
    for (const entry of checkpoint.entries) {
      if (entry.created) {
        try {
          await library.deleteChapter(bookId, entry.chapterId);
          restored += 1;
        } catch {
          skipped += 1;
        }
        continue;
      }
      if (entry.deleted) {
        try {
          const recreated = await library.createChapter(bookId, {
            title: entry.title,
            content: entry.before
          });
          if (entry.order) await library.moveChapterTo(bookId, recreated.id, entry.order - 1);
          restored += 1;
        } catch {
          skipped += 1;
        }
        continue;
      }
      try {
        const current = await library.readChapter(bookId, entry.chapterId);
        await library.saveChapter(bookId, entry.chapterId, entry.before, {
          baseVersion: current.version,
          baseHash: current.hash
        });
        restored += 1;
      } catch {
        skipped += 1;
      }
    }
    await store.remove(bookId, checkpoint.file);
    return { restored, skipped };
  }

  private async run<TOOLS extends ToolSet>(
    turnId: string,
    input: AgentTurnInput,
    agent: ToolLoopAgent<never, TOOLS>,
    messages: ModelMessage[],
    controller: AbortController,
    threadId: string,
    threadStore: ThreadStore,
    provider: ProviderId,
    connectionId: string,
    connectionLabel: string,
    modelId: string,
    messageId: string,
    state: TurnState
  ): Promise<void> {
    let waiting = false;
    let approval: { approvalId: string; name: string; input: unknown } | null = null;

    const saveCheckpoint = async (): Promise<boolean> => {
      if (state.changes.length === 0) return true;
      if (state.checkpointAttempted) return state.checkpointSaved;
      state.checkpointAttempted = true;
      try {
        await new CheckpointStore(() => this.studio.library?.root ?? null).save({
          turnId,
          bookId: input.bookId,
          at: new Date().toISOString(),
          prompt: input.prompt,
          entries: state.changes
        });
        state.checkpointSaved = true;
      } catch (error) {
        console.warn("[agent] Could not save the turn checkpoint:", redact((error as Error).message));
      }
      return state.checkpointSaved;
    };

    const writeMessage = async (
      parts: AgentPart[],
      options: { usage?: AgentUsage; checkpoint?: boolean } = {}
    ): Promise<void> => {
      const message = agentMessageSchema.parse({
        id: messageId,
        role: "assistant",
        parts,
        model: { provider, modelId, connectionLabel },
        ...(options.usage ? { usage: options.usage } : {}),
        context: state.context,
        turnId,
        createdAt: state.createdAt
      });
      try {
        let thread = await threadStore.upsertMessage(input.bookId, threadId, message);
        state.persisted = true;
        if (options.checkpoint) {
          const checkpointTurns = thread.checkpointTurns.includes(turnId)
            ? thread.checkpointTurns
            : [...thread.checkpointTurns, turnId];
          thread = await threadStore.save({ ...thread, checkpointTurns });
        }
      } catch (error) {
        console.warn("[agent] Could not save the conversation:", redact((error as Error).message));
      }
    };

    try {
      const stream = await agent.stream({ messages, abortSignal: controller.signal });
      for await (const part of stream.fullStream) {
        if (part.type === "text-delta") {
          state.text += part.text;
          this.publish({ type: "text", turnId, delta: part.text });
        } else if (part.type === "reasoning-delta") {
          state.reasoning += part.text;
          this.publish({ type: "reasoning", turnId, delta: part.text });
        } else if (part.type === "tool-call") {
          state.toolParts.push({
            type: "tool-call",
            id: part.toolCallId,
            name: part.toolName,
            input: part.input
          });
          this.publish({
            type: "tool",
            turnId,
            id: part.toolCallId,
            name: part.toolName,
            status: "start",
            input: part.input
          });
        } else if (part.type === "tool-result") {
          const output = part.output as { ok?: boolean; message?: string } | undefined;
          state.toolParts.push({
            type: "tool-result",
            id: part.toolCallId,
            name: part.toolName,
            output: part.output,
            ...(output?.ok === false ? { isError: true } : {})
          });
          await this.recordToolCall(input.bookId, part.toolName, output?.ok !== false);
          this.publish({
            type: "tool",
            turnId,
            id: part.toolCallId,
            name: part.toolName,
            status: "end",
            output: part.output,
            ...(output?.message ? { detail: output.message } : {})
          });
        } else if (part.type === "tool-approval-request") {
          waiting = true;
          approval = {
            approvalId: part.approvalId,
            name: part.toolCall.toolName,
            input: part.toolCall.input
          };
        } else if (part.type === "error") {
          throw part.error;
        }
      }

      const usage = await stream.totalUsage;
      state.inputTokens += usage.inputTokens ?? 0;
      state.outputTokens += usage.outputTokens ?? 0;
      // The provider reports its cache as an optional count. A missing count means the provider
      // measures no cache, which is not the same as a measured zero (D-147).
      const cacheRead = usage.inputTokenDetails.cacheReadTokens;
      state.cachedInputTokens += cacheRead ?? 0;
      if (cacheRead !== undefined) state.cacheReported = true;
      state.steps += Math.max(1, (await stream.steps).length);
      const finalStep = await stream.finalStep;
      const cost = reportedCost(provider, finalStep.providerMetadata);
      if (cost !== null) state.costUsd = (state.costUsd ?? 0) + cost;
      const costBasis = state.costUsd === null ? "unknown" : "reported";

      if (waiting && approval) {
        await saveCheckpoint();
        const responseMessages = await stream.responseMessages;
        state.approvals.push({
          type: "approval",
          approvalId: approval.approvalId,
          turnId,
          name: approval.name,
          input: approval.input,
          status: "pending",
          requestedAt: new Date().toISOString()
        });
        await writeMessage([...assistantParts(state.reasoning, state.toolParts, state.text), ...state.approvals]);
        const active = this.active.get(turnId);
        if (active) {
          const captured = approval;
          active.pending = {
            approvalId: captured.approvalId,
            resume: (approved) => {
              active.pending = undefined;
              const part = state.approvals.find((entry) => entry.approvalId === captured.approvalId);
              if (part) {
                part.status = approved ? "approved" : "denied";
                part.resolvedAt = new Date().toISOString();
              }
              const responses: ToolApprovalResponse[] = [
                {
                  type: "tool-approval-response",
                  approvalId: captured.approvalId,
                  approved,
                  reason: approved ? "Approved by the author." : "Denied by the author."
                }
              ];
              const resumed: ModelMessage[] = [
                ...responseMessages,
                { role: "tool", content: responses }
              ];
              void this.run(
                turnId,
                input,
                agent,
                resumed,
                controller,
                threadId,
                threadStore,
                provider,
                connectionId,
                connectionLabel,
                modelId,
                messageId,
                state
              );
            }
          };
        }
        this.publish({
          type: "approval",
          turnId,
          approvalId: approval.approvalId,
          name: approval.name,
          input: approval.input
        });
        this.reportOutcome(turnId, "approval", state, { approvalName: approval.name });
        return;
      }

      const undoAvailable = await saveCheckpoint();
      const usageRecord: AgentUsage = {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cachedInputTokens: state.cachedInputTokens,
        cacheReported: state.cacheReported,
        costUsd: state.costUsd,
        costBasis,
        contextLength: state.contextLength
      };
      await writeMessage([...assistantParts(state.reasoning, state.toolParts, state.text), ...state.approvals], {
        usage: usageRecord,
        checkpoint: state.changes.length > 0 && undoAvailable
      });
      this.publish({
        type: "done",
        turnId,
        text: state.text,
        model: { provider, modelId, connectionLabel },
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        costUsd: state.costUsd,
        costBasis,
        contextLength: state.contextLength,
        context: state.context,
        changed: state.changes.length,
        undoAvailable
      });
      this.reportOutcome(turnId, "done", state);

      try {
        await new UsageStore(() => this.studio.library?.root ?? null).append({
          at: new Date().toISOString(),
          bookId: input.bookId,
          provider,
          connectionId,
          connectionLabel,
          modelId,
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          cachedInputTokens: state.cachedInputTokens,
          cacheReported: state.cacheReported,
          costUsd: state.costUsd,
          costBasis,
          contextLength: state.contextLength,
          steps: state.steps
        });
      } catch (error) {
        console.warn("[agent] Could not record usage:", redact((error as Error).message));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const undoAvailable = await saveCheckpoint();
        expirePendingApprovals(state);
        const stopped: AgentErrorPart = { type: "error", code: "stopped", message: "Stopped by the author." };
        await writeMessage([...assistantParts(state.reasoning, state.toolParts, state.text, stopped), ...state.approvals], {
          checkpoint: state.changes.length > 0 && undoAvailable
        });
        this.publish({ type: "stopped", turnId, changed: state.changes.length, undoAvailable });
        this.reportOutcome(turnId, "stopped", state);
      } else {
        const normalized = normalizeProviderError({
          provider,
          message: error instanceof Error ? error.message : String(error)
        });
        const undoAvailable = await saveCheckpoint();
        expirePendingApprovals(state);
        const contextNote =
          normalized.code === "context" && state.contextLength
            ? ` This model's context is ${state.contextLength.toLocaleString()} tokens.`
            : "";
        const base = `${redact(normalized.message)}${contextNote}`;
        const message =
          state.changes.length > 0 && !undoAvailable
            ? `${base} The turn changed the book, but its undo checkpoint could not be saved. Review the affected chapters before continuing.`
            : base;
        // A turn that never paused keeps only its user message, so Retry can reuse it. A turn that
        // did pause already has a stored assistant message; record the failure on that same message.
        if (state.persisted) {
          const failure: AgentErrorPart = { type: "error", code: normalized.code, message };
          await writeMessage([...assistantParts(state.reasoning, state.toolParts, state.text, failure), ...state.approvals], {
            checkpoint: state.changes.length > 0 && undoAvailable
          });
        }
        this.publish({ type: "error", turnId, code: normalized.code, message, changed: state.changes.length, undoAvailable });
        this.reportOutcome(turnId, "error", state, { message });
      }
    } finally {
      if (!waiting) this.active.delete(turnId);
    }
  }
}

/**
 * Resolve the conversation and make sure this prompt is present exactly once. A retry after a failed
 * turn finds the same last user message and reuses it instead of appending a duplicate.
 */
export async function prepareThread(
  store: ThreadStore,
  input: AgentTurnInput,
  now: () => string = () => new Date().toISOString()
): Promise<{ thread: AgentThread; reused: boolean }> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new ProviderError("invalid-request", "Write a message before asking the agent to work.");
  }
  const at = now();
  const userMessage = agentMessageSchema.parse({
    id: newId("msg"),
    role: "user",
    parts: [{ type: "text", text: prompt }],
    createdAt: at
  });

  let thread: AgentThread;
  if (input.threadId) {
    const existing = await store.read(input.bookId, input.threadId);
    if (!existing) {
      throw new ProviderError("not-found", "That conversation no longer exists. Start a new one.");
    }
    thread = existing;
  } else {
    thread = await store.create(input.bookId, titleFromPrompt(prompt), seedMessages(input.history, at));
  }

  const last = thread.messages.at(-1);
  if (last?.role === "user" && messageText(last) === prompt) {
    return { thread, reused: true };
  }
  thread = await store.appendMessage(input.bookId, thread.id, userMessage);
  return { thread, reused: false };
}

function seedMessages(history: AgentTurnInput["history"], at: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const turn of history ?? []) {
    const text = turn.text.trim();
    if (!text) continue;
    messages.push(
      agentMessageSchema.parse({
        id: newId("msg"),
        role: turn.role,
        parts: [{ type: "text", text }],
        createdAt: at
      })
    );
  }
  return messages;
}

function modelMessagesFor(history: AgentMessage[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of history) {
    const text = messageText(message);
    if (!text) continue;
    messages.push({ role: message.role, content: text });
  }
  return messages;
}

function expirePendingApprovals(state: TurnState): void {
  const at = new Date().toISOString();
  for (const part of state.approvals) {
    if (part.status !== "pending") continue;
    part.status = "expired";
    part.resolvedAt = at;
  }
}

function assistantParts(reasoning: string, tools: AgentPart[], text: string, error?: AgentPart): AgentPart[] {
  const parts: AgentPart[] = [];
  if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning.trim() });
  parts.push(...tools);
  if (text.trim()) parts.push({ type: "text", text: text.trim() });
  if (error) parts.push(error);
  return parts.length > 0 ? parts : [{ type: "error", code: "empty", message: "The model returned no text." }];
}

function titleFromPrompt(prompt: string): string {
  const line = prompt.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!line) return "New conversation";
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
