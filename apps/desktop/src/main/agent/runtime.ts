import {
  APICallError,
  ToolLoopAgent,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolSet
} from "ai";
import type {
  AgentEvent,
  AgentTurnInput,
  AgentTurnResult,
  AgentTurnStarted,
  AgentUndoResult
} from "@ai-book-studio/core/agent";
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
import { normalizeProviderError, parseRetryAfter } from "@ai-book-studio/core/providers/errors";
import { redact } from "@ai-book-studio/core/providers/redact";
import type { ProviderId, StoredCredential } from "@ai-book-studio/core/providers/types";
import type { Chapter } from "@ai-book-studio/core/schema";
import { LibraryError } from "@ai-book-studio/core/library/errors";
import { ProviderError } from "@ai-book-studio/core/providers/types";
import type { Studio } from "../studio";
import type { ProviderService } from "../providers";
import { UsageStore } from "../usage";
import { newId } from "../library/paths";
import type { Library } from "../library/store";
import { modelFor } from "./transport";
import {
  CheckpointStore,
  bodyHash,
  checkpointMeta,
  metaHash,
  recordChange,
  type CheckpointEntry,
  type TurnCheckpoint
} from "./checkpoints";
import { DESTRUCTIVE_TOOL_NAMES, ProposedBases } from "./tools";
import { buildToolSet } from "./tool-set";
import { buildPrompt } from "./prompt";
import { readBookSkills } from "./skills";
import { cachePrefixFor } from "./cache";
import { loadPlugins, pluginTools, type LoadedPlugins } from "./plugins";
import type { PluginTool } from "@ai-book-studio/core/agent/plugins";
import type { MetricsStore } from "../metrics";

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
  /** The chapter the author was looking at when the turn started, so a reopened window can return to it. */
  chapterId?: string | undefined;
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
  /** The chapter that was open for the turn, or the last one it changed, for a window reopening on it. */
  chapterId?: string;
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
  changes: CheckpointEntry[];
  /** The catalogue's display name for the turn's model, when the catalogue named one. */
  modelName: string | null;
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
  checkpoint: CheckpointProgress;
  /** What each paused destructive call was proposed against, noted before the author is asked. */
  proposed: ProposedBases;
  /** Tool calls still running. A stop or a failure waits for them before it reports. */
  running: Set<Promise<void>>;
}

/** How far the turn's one checkpoint file has caught up with the chapters the turn changed. */
interface CheckpointProgress {
  /** Moves on each time the turn records a change. */
  revision: number;
  /** The revision the file on disk holds. */
  saved: number;
  /** Set by the first save and kept, so every later save rewrites the same file. */
  at: string | null;
  file: string | null;
  /** Saves run one at a time, because the tool calls of one step can finish together. */
  queue: Promise<unknown>;
}

const MAX_STEPS = 20;
/** How long a stop or a failure waits for a tool call that is still running. */
const RUNNING_CALL_WAIT_MS = 5_000;

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
   * The background turns still running, oldest first, with the chapter each was open on. The shell
   * remembers the newest when the window closes, so the next window opens on its conversation
   * while it still runs, not only once it has ended.
   */
  activeBackgroundTurns(): Array<{ bookId: string; threadId: string; chapterId?: string }> {
    return [...this.active.values()]
      .filter((turn) => turn.background)
      .map((turn) => {
        const chapterId = turn.chapterId ?? turn.state.changes.at(-1)?.chapterId;
        return { bookId: turn.bookId, threadId: turn.threadId, ...(chapterId ? { chapterId } : {}) };
      });
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
    const chapterId = turn.chapterId ?? state.changes.at(-1)?.chapterId;
    try {
      this.onOutcome({
        kind,
        turnId,
        bookId: turn.bookId,
        bookTitle: turn.bookTitle,
        threadId: turn.threadId,
        ...(chapterId ? { chapterId } : {}),
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
    let modelName: string | null = null;
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
      modelName = selected?.name ?? null;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      console.warn("[agent] Could not read the model's context length:", redact((error as Error).message));
    }
    const model = this.makeModel(credential, modelId);
    const prepared = await prepareThread(library.threads, input);
    await this.expireStaleApprovals(input.bookId, prepared.thread);
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
      modelName,
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
      checkpoint: { revision: 0, saved: 0, at: null, file: null, queue: Promise.resolve() },
      proposed: new ProposedBases(library, input.bookId),
      running: new Set()
    };
    const turnId = newId("turn");
    const cache = cachePrefixFor(
      credential.provider,
      book.settings?.cache?.prefixMode !== "off"
    );
    const tools = buildToolSet(library, input.bookId, {
      disabledTools: book.settings?.agent?.disabledTools ?? [],
      pluginTools: await this.pluginToolsFor(),
      ...(cache.toolProviderOptions ? { toolProviderOptions: cache.toolProviderOptions } : {}),
      proposed: state.proposed,
      // Every change goes into the checkpoint as it is made, before the tool answers the model, so
      // a change after a pause or a resume is as undoable as one before it.
      onBeforeChange: async (change) => {
        recordChange(state.changes, change);
        state.checkpoint.revision += 1;
        await this.saveCheckpoint(turnId, input, state);
      }
    });
    trackRunningCalls(tools, state.running);
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
      // A failed request is the author's to retry, not the loop's: the SDK must not hide a
      // rate limit behind its own backoff and replays.
      maxRetries: 0,
      stopWhen: isStepCount(MAX_STEPS)
    });

    const controller = new AbortController();
    this.active.set(turnId, {
      controller,
      bookId: input.bookId,
      bookTitle: book.title,
      threadId: prepared.thread.id,
      messageId,
      background: input.background === true,
      chapterId: activeChapter?.id,
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
      const undoAvailable = checkpointCovers(turn.state);
      // No stream is left to write the turn's end, so its checkpoint is listed with the conversation
      // here, on the terms a finished turn's is.
      if (turn.state.changes.length > 0 && undoAvailable) await this.listCheckpointTurn(turn.bookId, turn.threadId, turnId);
      this.publish({
        type: "stopped",
        turnId,
        changed: turn.state.changes.length,
        undoAvailable
      });
    }
    turn.controller.abort();
    this.active.delete(turnId);
    return null;
  }

  /** Add a turn to its conversation's checkpoint turns, newest last, so a reload offers its undo. */
  private async listCheckpointTurn(bookId: string, threadId: string, turnId: string): Promise<void> {
    try {
      const threads = this.studio.requireLibrary().threads;
      const thread = await threads.read(bookId, threadId);
      if (!thread || thread.checkpointTurns.includes(turnId)) return;
      await threads.save({ ...thread, checkpointTurns: [...thread.checkpointTurns, turnId] });
    } catch (error) {
      console.warn("[agent] Could not record the turn's checkpoint:", redact((error as Error).message));
    }
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

  /**
   * Expire approvals no live turn can still answer. A previous run's pending approval — left
   * behind by a closed app or a killed process — is persisted as expired the next time any turn
   * starts on the thread, so it can never resume and never shows as waiting again. Approvals
   * held by a live turn are untouched.
   */
  private async expireStaleApprovals(bookId: string, thread: AgentThread): Promise<void> {
    const library = this.studio.requireLibrary();
    for (const message of thread.messages) {
      for (const part of message.parts) {
        if (part.type !== "approval" || part.status !== "pending") continue;
        if (this.active.has(part.turnId)) continue;
        await library.threads.updateApproval(bookId, thread.id, message.id, part.approvalId, "expired");
      }
    }
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

  /**
   * Put every chapter the newest turn changed back the way the turn found it.
   *
   * The entries are undone newest first, so the turn's structural changes come apart in the reverse
   * of the order they were made. A chapter whose text or details changed during or after the turn is
   * left as it is and counted as skipped: undo never writes over someone else's words. A chapter someone
   * else wrote in between two of the turn's own changes is restored too, but its file is kept as a
   * conflict copy first, and the result names the chapter and the copy.
   *
   * With `turnId`, as the chat sends for the turn it offered, undo goes ahead only while that turn owns
   * the book's newest checkpoint. Otherwise it changes nothing and says what is newest. The strip, the
   * CLI and the phone name no turn and take the newest on purpose.
   */
  async undoLast(bookId: string, turnId?: string): Promise<AgentUndoResult> {
    const library = this.studio.requireLibrary();
    const store = new CheckpointStore(() => this.studio.library);
    const checkpoint = await store.latest(bookId);
    if (turnId !== undefined && checkpoint?.turnId !== turnId) {
      throw new ProviderError("not-found", staleUndoMessage(checkpoint));
    }
    if (!checkpoint) {
      throw new ProviderError("not-found", "There is no agent turn to undo in this book.");
    }
    let restored = 0;
    let skipped = 0;
    const kept: NonNullable<AgentUndoResult["kept"]> = [];
    const notes: string[] = [];
    for (const entry of [...checkpoint.entries].reverse()) {
      const undone = await undoEntry(library, bookId, entry);
      if (undone.restored) restored += 1;
      else skipped += 1;
      if (undone.kept) kept.push(undone.kept);
      if (undone.note) notes.push(undone.note);
    }
    await store.remove(bookId, checkpoint.file);
    try {
      // The turn is used up, so no conversation may offer its undo again, even after a reload.
      await library.threads.forgetCheckpointTurn(bookId, checkpoint.turnId);
    } catch (error) {
      // The chapters are already back; a conversation that could not be updated must not hide that.
      console.warn("[agent] Could not update the conversation after undo:", redact((error as Error).message));
    }
    return { restored, skipped, ...(kept.length > 0 ? { kept } : {}), ...(notes.length > 0 ? { notes } : {}) };
  }

  /**
   * Write the turn's checkpoint with every chapter the turn has changed so far.
   *
   * A turn has one checkpoint file. Each save rewrites it whole and atomically, so the file always
   * holds what every changed chapter was before the turn first wrote it, however many pauses and
   * approvals came between. A failed save is logged and tried again by the next one; it never fails
   * the tool that made the change. Resolves true when the file holds every change.
   */
  private saveCheckpoint(turnId: string, input: AgentTurnInput, state: TurnState): Promise<boolean> {
    const progress = state.checkpoint;
    const saving = progress.queue.then(async () => {
      if (progress.saved === progress.revision) return checkpointCovers(state);
      const revision = progress.revision;
      const store = new CheckpointStore(() => this.studio.library);
      try {
        if (state.changes.length === 0) {
          // The turn's changes cancelled out, such as a chapter it created and then deleted.
          if (progress.file) await store.remove(input.bookId, progress.file);
          progress.at = null;
          progress.file = null;
        } else {
          progress.at ??= new Date().toISOString();
          progress.file = await store.save({
            turnId,
            bookId: input.bookId,
            at: progress.at,
            prompt: input.prompt,
            entries: state.changes
          });
        }
        progress.saved = revision;
      } catch (error) {
        console.warn("[agent] Could not save the turn checkpoint:", redact((error as Error).message));
      }
      return checkpointCovers(state);
    });
    progress.queue = saving.catch(() => {});
    return saving;
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
    let approval: { approvalId: string; toolCallId: string; name: string; input: unknown } | null = null;

    // Each change saved the checkpoint as it was made. This catches up after a save that failed.
    const saveCheckpoint = (): Promise<boolean> => this.saveCheckpoint(turnId, input, state);

    const writeMessage = async (
      parts: AgentPart[],
      options: { usage?: AgentUsage; checkpoint?: boolean } = {}
    ): Promise<void> => {
      const message = agentMessageSchema.parse({
        id: messageId,
        role: "assistant",
        parts,
        model: {
          provider,
          modelId,
          connectionLabel,
          ...(state.modelName ? { name: state.modelName } : {})
        },
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
        } else if (part.type === "tool-error") {
          // A tool that throws ends like one that answered `ok: false`: a failed step in the chat and
          // the thread, and a failed call in the metrics. Without this it would stay running forever.
          const output = { ok: false, message: toolErrorMessage(part.error) };
          state.toolParts.push({ type: "tool-result", id: part.toolCallId, name: part.toolName, output, isError: true });
          await this.recordToolCall(input.bookId, part.toolName, false);
          this.publish({
            type: "tool",
            turnId,
            id: part.toolCallId,
            name: part.toolName,
            status: "end",
            output,
            detail: output.message
          });
        } else if (part.type === "tool-approval-request") {
          waiting = true;
          approval = {
            approvalId: part.approvalId,
            toolCallId: part.toolCall.toolCallId,
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
      const steps = await stream.steps;
      state.steps += Math.max(1, steps.length);
      // Every step reports its own price, so the turn's price is the sum of the steps, not the
      // last step's alone.
      let stepCost: number | null = null;
      for (const step of steps) {
        const part = reportedCost(provider, step.providerMetadata);
        if (part !== null) stepCost = (stepCost ?? 0) + part;
      }
      if (stepCost !== null) state.costUsd = (state.costUsd ?? 0) + stepCost;
      const costBasis = state.costUsd === null ? "unknown" : "reported";

      if (waiting && approval) {
        // The call's chapters as they are now, before the author sees the request. Once approved,
        // the call writes against them, so words saved while it waits are a conflict, never lost.
        await state.proposed.note(approval);
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
              // The resume is the same conversation: what this stream was sent (the history and the
              // author's prompt, or an earlier resume), what it answered, then the approval. The
              // stream's response alone would leave the model without the request it is carrying out.
              const resumed: ModelMessage[] = [
                ...messages,
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
        model: {
          provider,
          modelId,
          connectionLabel,
          ...(state.modelName ? { name: state.modelName } : {})
        },
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
      // A tool call that was still writing finishes first, so the changes this reports, and the
      // checkpoint it leaves, include that write.
      await settleRunningCalls(state.running);
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
        // A provider transport failure arrives as an API error carrying its status, body and
        // headers. Anything else is only words, and the normalizer treats it that way.
        const apiError = APICallError.isInstance(error) ? error : null;
        const retryAfter = parseRetryAfter(
          apiError?.responseHeaders?.["retry-after"] ?? apiError?.responseHeaders?.["Retry-After"]
        );
        const normalized = normalizeProviderError({
          provider,
          message: error instanceof Error ? error.message : String(error),
          ...(apiError?.statusCode !== undefined ? { status: apiError.statusCode } : {}),
          ...(apiError?.responseBody ? { body: apiError.responseBody } : {}),
          ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
        });
        const wait = normalized.options.retryAfterSeconds;
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
          const failure: AgentErrorPart = {
            type: "error",
            code: normalized.code,
            message,
            ...(wait !== undefined ? { retryAfterSeconds: wait } : {})
          };
          await writeMessage([...assistantParts(state.reasoning, state.toolParts, state.text, failure), ...state.approvals], {
            checkpoint: state.changes.length > 0 && undoAvailable
          });
        } else if (state.changes.length > 0 && undoAvailable) {
          // Still the newest checkpoint: listed, a reload offers no earlier turn's undo in its place.
          await this.listCheckpointTurn(input.bookId, threadId, turnId);
        }
        this.publish({
          type: "error",
          turnId,
          code: normalized.code,
          message,
          changed: state.changes.length,
          undoAvailable,
          ...(wait !== undefined ? { retryAfterSeconds: wait } : {})
        });
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
  // Thread preparation needs only routing and content, never the turn's permission level.
  input: Pick<AgentTurnInput, "bookId" | "threadId" | "prompt" | "history">,
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

/** Whether one undo can put back everything the turn has changed so far. */
function checkpointCovers(state: TurnState): boolean {
  return state.changes.length === 0 || state.checkpoint.saved === state.checkpoint.revision;
}

/** Note each tool call while it runs, without changing what it returns. */
function trackRunningCalls(tools: ToolSet, running: Set<Promise<void>>): void {
  for (const definition of Object.values(tools)) {
    const execute = definition.execute;
    if (!execute) continue;
    definition.execute = (toolInput, options) => {
      const result = execute(toolInput, options);
      if (result instanceof Promise) {
        const settled = result.then(
          () => undefined,
          () => undefined
        );
        running.add(settled);
        void settled.then(() => running.delete(settled));
      }
      return result;
    };
  }
}

/** Wait for the tool calls still running, but never longer than a stop should take to show. */
async function settleRunningCalls(running: Set<Promise<void>>): Promise<void> {
  if (running.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(running),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RUNNING_CALL_WAIT_MS);
    })
  ]);
  clearTimeout(timer);
}

/** What undoing one checkpoint entry did. */
interface UndoneEntry {
  restored: boolean;
  /** The conflict copy kept before the chapter was restored. */
  kept?: { chapterId: string; title: string; savedAs: string };
  /** One sentence for the author when the chapter did not simply go back. */
  note?: string;
}

/**
 * Undo one checkpoint entry. A chapter that changed during or after the turn, or that could not be put
 * back, is left as it is. A chapter someone else wrote in between two of the turn's own changes is kept
 * as a conflict copy before anything replaces it, and is left as it is when the copy cannot be made.
 */
async function undoEntry(library: Library, bookId: string, entry: CheckpointEntry): Promise<UndoneEntry> {
  const name = `“${entry.title}”`;
  let kept: UndoneEntry["kept"];
  const left = (why: string): UndoneEntry => ({
    restored: false,
    ...(kept ? { kept } : {}),
    note: `${name} ${why}, so undo left it as it is.${kept ? ` Its text from before the undo is kept at ${kept.savedAs}.` : ""}`
  });
  try {
    let current: Chapter;
    if (entry.deleted) {
      const { chapters } = await library.readBook(bookId);
      if (chapters.some((chapter) => chapter.id === entry.chapterId)) return left("is already back in the book");
      const back = entry.trashedAt ? await fromTrash(library, bookId, entry.chapterId, entry.trashedAt) : null;
      if (back?.status === "already-in-book") return left("is already back in the book");
      if (!back) {
        // The file has left the trash, or an older checkpoint did not say where it went.
        const recreated = await library.createChapter(bookId, { title: entry.title, content: entry.before });
        if (entry.order) await library.moveChapterTo(bookId, recreated.id, entry.order - 1);
        return {
          restored: true,
          note: `${name} was no longer in the trash, so undo wrote it again as a new chapter with its title and text only.`
        };
      }
      current = back.chapter;
    } else {
      current = await library.readChapter(bookId, entry.chapterId);
      // Text or details that are no longer what the turn left belong to whoever wrote them since. The
      // checkpoint cannot tell an edit during an approval pause from one after the turn, so it says both.
      if (entry.afterHash !== undefined && (await bodyHash(current.content)) !== entry.afterHash) {
        return left("changed during or after the turn");
      }
      if (entry.afterMetaHash !== undefined && (await metaHash(checkpointMeta(current))) !== entry.afterMetaHash) {
        return left("changed during or after the turn");
      }
      if (entry.created) {
        await library.deleteChapter(bookId, entry.chapterId);
        return { restored: true };
      }
    }
    if (entry.outsideEdit) {
      // Words the turn did not write are in this chapter's history. Keep what is there now first.
      const copy = await library.keepConflictCopy(bookId, entry.chapterId, {
        baseVersion: current.version,
        baseHash: current.hash
      });
      if (copy.status !== "kept") return left("changed while undo was reading it");
      kept = { chapterId: entry.chapterId, title: entry.title, savedAs: copy.savedAs };
    }
    const saved = await library.saveChapter(bookId, entry.chapterId, entry.before, {
      baseVersion: current.version,
      baseHash: current.hash
    });
    if (saved.status !== "saved") return left("changed while undo was restoring it");
    current = saved.chapter;
    if (entry.meta && (await metaHash(entry.meta)) !== (await metaHash(checkpointMeta(current)))) {
      // Only the seven details: the entry was read back from a file, and order or id are not undo's.
      const restored = await library.updateChapterMeta(bookId, entry.chapterId, checkpointMeta(entry.meta), {
        baseVersion: current.version,
        baseHash: current.hash
      });
      if (restored.status !== "saved") return left("changed while undo was restoring it");
    }
    if (entry.order) {
      const moved = await library.moveChapterTo(bookId, entry.chapterId, entry.order - 1);
      if (moved.status !== "saved") return left("changed while undo was restoring it");
    }
    if (!kept) return { restored: true };
    return {
      restored: true,
      kept,
      note: `${name} was edited during the turn, so undo kept its text from before the undo at ${kept.savedAs}.`
    };
  } catch {
    return left("could not be put back");
  }
}

/**
 * Bring a deleted chapter's own file back from the trash. A failed restore may mean the author
 * returned it after undo's first read. Check again before recreating anything; an invalid trash
 * reference is not evidence of a missing chapter and must never trigger recreation.
 */
async function fromTrash(
  library: Library, bookId: string, chapterId: string, trashedAt: string
): Promise<{ status: "restored"; chapter: Chapter } | { status: "already-in-book" } | null> {
  try {
    return { status: "restored", chapter: await library.restoreChapter(bookId, chapterId, trashedAt) };
  } catch (error) {
    if (error instanceof LibraryError && (error.code === "not-found" || error.code === "invalid")) {
      const { chapters } = await library.readBook(bookId);
      if (chapters.some((chapter) => chapter.id === chapterId)) return { status: "already-in-book" };
      if (error.code === "not-found") return null;
    }
    throw error;
  }
}

/**
 * Why an undo that named its turn did nothing: another change owns the book's newest checkpoint, or
 * none is left. The newest is named by its request and the chapters it changed, never by a path.
 */
function staleUndoMessage(newest: TurnCheckpoint | null): string {
  const lead = "The book changed since that turn, so nothing was undone.";
  if (!newest) return `${lead} No agent turn is left to undo.`;
  const titles = [...new Set(newest.entries.map((entry) => `“${entry.title}”`))];
  const where =
    titles.length === 0
      ? ""
      : titles.length <= 2
        ? ` in ${titles.join(" and ")}`
        : ` in ${titles[0]} and ${titles.length - 1} more chapters`;
  return `${lead} The newest change is “${titleFromPrompt(newest.prompt)}”${where}.`;
}

/**
 * What the author is told about a tool that threw. The library's refusal is written for the author and
 * names only ids, so it is kept. Any other exception is the program's own, and its text can name paths
 * on this computer, so the conversation file gets a plain line instead.
 */
function toolErrorMessage(error: unknown): string {
  if (!(error instanceof LibraryError)) return "The tool failed.";
  return redact(error.message.trim()).slice(0, 500) || "The tool failed.";
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
