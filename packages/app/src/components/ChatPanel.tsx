import { FormEvent, Fragment, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Cpu, GitBranch, History, Pencil, Plus, Send, Square, Trash2, X } from "lucide-react";
import type { AgentEvent, AgentTurnInput } from "@ai-book-studio/core/agent";
import type { ThreadSummary } from "@ai-book-studio/core/agent/threads";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { cn, must } from "../lib/utils";
import {
  approvalLabel,
  toChatMessage,
  toolDetailText,
  toolLabel,
  usageNote,
  type Approval,
  type Message
} from "../lib/chat-view";

interface Props {
  bookId: string;
  chapterId: string | null;
  onClose: () => void;
  onBeforeSend: () => Promise<void>;
  onChanged: () => Promise<void> | void;
  onReconnect: () => void;
  onChooseModel: () => void;
  onChooseTurnModel: () => void;
  /** A one-off model for the next message. The book default stays unchanged. */
  turnModel?: { connectionId: string; modelId: string } | null;
  onTurnModelUsed: () => void;
  onNotice: (error: unknown) => void;
  className?: string;
}

function nextId(): string {
  return `m_${Math.random().toString(36).slice(2, 10)}`;
}

const APPROVAL_STATUS: Record<Approval["status"], string> = {
  pending: "Waiting",
  approved: "Allowed",
  denied: "Denied",
  expired: "Expired"
};

/**
 * The author's side of one conversation with the writing agent. Text arrives as the model produces
 * it; tool activity is reduced to short, human lines. The panel never sees a key or a raw provider
 * request.
 */
export function ChatPanel({
  bookId,
  chapterId,
  onClose,
  onBeforeSend,
  onChanged,
  onReconnect,
  onChooseModel,
  onChooseTurnModel,
  turnModel,
  onTurnModelUsed,
  onNotice,
  className
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [background, setBackground] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  const turnRef = useRef<string | null>(null);
  const assistantRef = useRef<string | null>(null);
  const retryRequestsRef = useRef(new Map<string, AgentTurnInput>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadToken = useRef(0);
  const noticeRef = useRef(onNotice);

  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);

  const patchAssistant = useCallback((turnId: string, patch: (message: Message) => Message) => {
    setMessages((current) =>
      current.map((message) => (message.id === assistantRef.current && turnRef.current === turnId ? patch(message) : message))
    );
  }, []);

  const patchMessage = useCallback((id: string, patch: (message: Message) => Message) => {
    setMessages((current) => current.map((message) => (message.id === id ? patch(message) : message)));
  }, []);

  // Load the newest stored conversation for this book. A send cancels this read so it cannot
  // overwrite a turn the author already started.
  useEffect(() => {
    const token = ++loadToken.current;
    setThreadId(null);
    setMessages([]);
    void (async () => {
      try {
        const threads = await must(window.studio.agent.threads.list(bookId));
        const latest = threads[0];
        if (!latest || token !== loadToken.current) return;
        const thread = await must(window.studio.agent.threads.read(bookId, latest.id));
        if (!thread || token !== loadToken.current) return;
        const checkpointTurn = thread.checkpointTurns.at(-1);
        setThreadId(thread.id);
        setMessages(thread.messages.map((message) => toChatMessage(message, checkpointTurn)));
      } catch (error) {
        if (token === loadToken.current) noticeRef.current(error);
      }
    })();
    return () => {
      loadToken.current += 1;
    };
  }, [bookId]);

  const startNew = (): void => {
    if (running) return;
    loadToken.current += 1;
    setThreadId(null);
    setMessages([]);
    setInput("");
    setHistoryOpen(false);
    retryRequestsRef.current.clear();
    assistantRef.current = null;
    turnRef.current = null;
  };

  const openHistory = async (): Promise<void> => {
    if (running) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setThreads(await must(window.studio.agent.threads.list(bookId)));
    } catch (error) {
      onNotice(error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadThread = async (id: string): Promise<void> => {
    if (running) return;
    try {
      const thread = await must(window.studio.agent.threads.read(bookId, id));
      if (!thread) return;
      const checkpointTurn = thread.checkpointTurns.at(-1);
      setThreadId(thread.id);
      setMessages(thread.messages.map((message) => toChatMessage(message, checkpointTurn)));
      setHistoryOpen(false);
    } catch (error) {
      onNotice(error);
    }
  };

  const beginRename = (thread: ThreadSummary): void => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  };

  const saveRename = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const title = renameValue.trim();
    if (!renamingId || !title) return;
    try {
      const updated = await must(window.studio.agent.threads.rename(bookId, renamingId, title));
      setThreads((current) =>
        current.map((thread) =>
          thread.id === renamingId ? { ...thread, title: updated.title, updatedAt: updated.updatedAt } : thread
        )
      );
      setRenamingId(null);
    } catch (error) {
      onNotice(error);
    }
  };

  const deleteThread = async (): Promise<void> => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await must(window.studio.agent.threads.remove(bookId, target.id));
      setThreads((current) => current.filter((thread) => thread.id !== target.id));
      if (threadId === target.id) {
        setThreadId(null);
        setMessages([]);
      }
      setDeleteTarget(null);
    } catch (error) {
      onNotice(error);
    }
  };

  const branchFrom = async (message: Message): Promise<void> => {
    if (running || !threadId || !message.turnId) return;
    try {
      const created = await must(window.studio.agent.threads.fork(bookId, threadId, message.turnId));
      const checkpointTurn = created.checkpointTurns.at(-1);
      setThreadId(created.id);
      setMessages(created.messages.map((entry) => toChatMessage(entry, checkpointTurn)));
      setHistoryOpen(false);
    } catch (error) {
      onNotice(error);
    }
  };

  const startAttempt = async (assistantId: string, request: AgentTurnInput): Promise<void> => {
    assistantRef.current = assistantId;
    turnRef.current = null;
    setRunning(true);
    setWaiting(true);
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, text: "", tools: [], note: undefined, failed: false, retryable: undefined, errorCode: undefined, turnId: undefined, changed: 0, undoAvailable: undefined, approvals: undefined }
          : message
      )
    );

    try {
      await onBeforeSend();
      const started = await window.studio.agent.start(request);
      if (!started.ok) {
        throw Object.assign(new Error(started.error.message), { code: started.error.code });
      }
      turnRef.current = started.data.turnId;
      setThreadId(started.data.threadId);
      retryRequestsRef.current.set(assistantId, { ...request, threadId: started.data.threadId });
      if (request.model) onTurnModelUsed();
      setWaiting(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
      turnRef.current = null;
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, failed: true, retryable: true, note: message, errorCode: code, changed: 0, undoAvailable: true }
            : item
        )
      );
      setRunning(false);
      setWaiting(false);
      onNotice(error);
    }
  };

  const retry = async (assistantId: string): Promise<void> => {
    const request = retryRequestsRef.current.get(assistantId);
    if (!request || running) return;
    await startAttempt(assistantId, request);
  };

  useEffect(() => {
    const unsubscribe = window.studio.agent.onEvent((event: AgentEvent) => {
      if (event.turnId !== turnRef.current) return;
      if (event.type === "text") {
        patchAssistant(event.turnId, (message) => ({ ...message, text: message.text + event.delta }));
      } else if (event.type === "reasoning") {
        // Reasoning is deliberately not shown; the author sees the result, not the machinery.
      } else if (event.type === "tool") {
        patchAssistant(event.turnId, (message) => {
          const tools = [...message.tools];
          const index = tools.findIndex((tool) => tool.id === event.id && tool.status === "start");
          if (event.status === "start") {
            tools.push({ id: event.id, name: event.name, status: "start", input: event.input });
          } else if (index >= 0) {
            tools[index] = {
              ...tools[index]!,
              status: "end",
              output: event.output,
              ...(event.detail ? { detail: event.detail } : {})
            };
          } else {
            tools.push({
              id: event.id,
              name: event.name,
              status: "end",
              output: event.output,
              ...(event.detail ? { detail: event.detail } : {})
            });
          }
          return { ...message, tools };
        });
      } else if (event.type === "approval") {
        patchAssistant(event.turnId, (message) => ({
          ...message,
          turnId: event.turnId,
          approvals: [
            ...(message.approvals ?? []).filter((entry) => entry.id !== event.approvalId),
            {
              id: event.approvalId,
              turnId: event.turnId,
              name: event.name,
              input: event.input,
              status: "pending"
            }
          ],
          note: "Waiting for your approval."
        }));
        setWaiting(false);
      } else if (event.type === "done") {
        patchAssistant(event.turnId, (message) => ({
          ...message,
          text: event.text || message.text,
          turnId: event.turnId,
          model: event.model.connectionLabel
            ? `${event.model.connectionLabel} · ${event.model.modelId}`
            : event.model.modelId,
          context: event.context,
          changed: event.changed ?? 0,
          undoAvailable: event.undoAvailable,
          note:
            usageNote({
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              costUsd: event.costUsd,
              costBasis: event.costBasis,
              contextLength: event.contextLength
            }) + (event.changed && event.undoAvailable === false ? " · no undo checkpoint" : "")
        }));
        if (assistantRef.current) retryRequestsRef.current.delete(assistantRef.current);
        turnRef.current = null;
        setRunning(false);
        setWaiting(false);
        void onChanged();
      } else if (event.type === "stopped") {
        patchAssistant(event.turnId, (message) => ({
          ...message,
          turnId: event.turnId,
          changed: event.changed ?? 0,
          undoAvailable: event.undoAvailable,
          note: "Stopped",
          approvals: message.approvals?.map((entry) =>
            entry.status === "pending" ? { ...entry, status: "expired" } : entry
          )
        }));
        turnRef.current = null;
        setRunning(false);
        setWaiting(false);
        void onChanged();
      } else if (event.type === "error") {
        patchAssistant(event.turnId, (message) => ({
          ...message,
          failed: true,
          note: event.message,
          errorCode: event.code,
          turnId: event.turnId,
          changed: event.changed ?? 0,
          undoAvailable: event.undoAvailable,
          approvals: message.approvals?.map((entry) =>
            entry.status === "pending" ? { ...entry, status: "expired" } : entry
          )
        }));
        turnRef.current = null;
        setRunning(false);
        setWaiting(false);
      }
    });
    return unsubscribe;
  }, [onChanged, patchAssistant]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || running) return;
    setInput("");
    const user: Message = { id: nextId(), role: "user", text: prompt, tools: [] };
    const assistant: Message = { id: nextId(), role: "assistant", text: "", tools: [] };
    const history = messages
      .filter((message) => message.text.trim() && !(message.role === "assistant" && message.failed))
      .slice(-20)
      .map((message) => ({ role: message.role, text: message.text }));
    const request: AgentTurnInput = {
      bookId,
      chapterId,
      prompt,
      threadId: threadId ?? undefined,
      history,
      ...(background ? { background: true } : {}),
      ...(turnModel ? { model: turnModel } : {})
    };
    setBackground(false);
    loadToken.current += 1;
    retryRequestsRef.current.set(assistant.id, request);
    setMessages((current) => [...current, user, assistant]);
    await startAttempt(assistant.id, request);
  };

  const approve = async (message: Message, approval: Approval, approved: boolean): Promise<void> => {
    if (approval.status !== "pending") return;
    try {
      setWaiting(true);
      setRunning(true);
      turnRef.current = approval.turnId;
      assistantRef.current = message.id;
      await must(window.studio.agent.approve(approval.turnId, approval.id, approved));
      const status: Approval["status"] = approved ? "approved" : "denied";
      patchMessage(message.id, (item) => ({
        ...item,
        note: approved ? "Approved. Working…" : "Denied. Working…",
        approvals: item.approvals?.map((entry) =>
          entry.id === approval.id ? { ...entry, status } : entry
        )
      }));
    } catch (error) {
      const expired = error instanceof Error && /no longer waiting/i.test(error.message);
      if (expired) {
        patchMessage(message.id, (item) => ({
          ...item,
          note: "This approval expired when the app closed. Ask the agent to try again.",
          approvals: item.approvals?.map((entry) =>
            entry.id === approval.id ? { ...entry, status: "expired" } : entry
          )
        }));
        turnRef.current = null;
        assistantRef.current = null;
      } else {
        onNotice(error);
      }
      setWaiting(false);
      setRunning(false);
    }
  };

  const stop = async (): Promise<void> => {
    const turnId = turnRef.current;
    if (!turnId) return;
    try {
      await must(window.studio.agent.stop(turnId));
    } catch (error) {
      onNotice(error);
    }
  };

  const undo = async (turnId: string): Promise<void> => {
    try {
      const result = await must(window.studio.agent.undoLast(bookId));
      patchAssistant(turnId, (message) => ({
        ...message,
        changed: result.skipped,
        undoAvailable: false,
        note: result.skipped
          ? `Restored ${result.restored} ${result.restored === 1 ? "chapter" : "chapters"}, but skipped ${result.skipped}. Review the remaining changes before retrying.`
          : `Restored ${result.restored} ${result.restored === 1 ? "chapter" : "chapters"}.`
      }));
      await onChanged();
    } catch (error) {
      onNotice(error);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <aside
      className={cn("glass flex w-[400px] shrink-0 flex-col overflow-hidden rounded-[var(--corner-xl)]", className)}
      aria-label="Writing agent"
      data-testid="chat-panel"
    >
      <header className="flex items-center justify-between border-b border-[var(--glass-outline)] px-4 py-3">
        <div>
          <h2 className="text-[var(--text-headline-size)] font-semibold">Writing agent</h2>
          <p className="text-[var(--text-caption-size)] text-muted-foreground">Edits arrive as small changes you can undo.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={startNew}
            disabled={running}
            aria-label="New conversation"
            title="New conversation"
            className="size-11 min-[700px]:size-7"
            data-testid="agent-new-thread"
          >
            <Plus size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void openHistory()}
            disabled={running}
            aria-label="Conversation history"
            title="Conversation history"
            className="size-11 min-[700px]:size-7"
            data-testid="agent-history"
          >
            <History size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close the writing agent"
            title="Close"
            className="size-11 min-[700px]:size-7"
          >
            <X size={16} />
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="rounded-[var(--corner-lg)] bg-[var(--secondary)] px-4 py-3">
            <p className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
              Ask for a scene, a tighter paragraph, or a check of what happened earlier. The agent reads the book before it
              changes anything.
            </p>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const previousModel = messages
            .slice(0, index)
            .reverse()
            .find((item) => item.role === "assistant" && item.model)?.model;
          const showModel = message.role === "assistant" && message.model && message.model !== previousModel;
          return (
            <Fragment key={message.id}>
              {showModel ? (
                <div
                  className="flex items-center gap-2 pt-1 text-[var(--text-caption-size)] text-muted-foreground"
                  data-testid="model-change"
                >
                  <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
                  <span>{message.model}</span>
                  <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
                </div>
              ) : null}
              <div className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[92%] rounded-[var(--corner-lg)] px-3.5 py-2.5 ${
                message.role === "user"
                  ? "bg-[var(--bubble-author-bg)] text-[var(--primary-foreground)]"
                  : "bg-[var(--bubble-agent-bg)] text-foreground"
              }`}
            >
              {message.tools.length > 0 ? (
                <ul className="mb-2 space-y-1">
                  {message.tools.map((tool, index) => {
                    const detail = toolDetailText(tool);
                    return (
                      <li key={`${tool.id ?? tool.name}-${index}`} className="text-[var(--text-caption-size)]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${tool.status === "end" ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`}
                            aria-hidden
                          />
                          <span className={message.role === "user" ? "opacity-80" : "text-muted-foreground"}>{toolLabel(tool.name)}</span>
                        </div>
                        {detail ? (
                          <details className="ml-3.5 mt-1">
                            <summary className="cursor-pointer select-none text-[var(--text-caption-size)] text-muted-foreground">
                              Details
                            </summary>
                            <pre className="thin-scroll mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--corner-md)] bg-[var(--background)] p-2 font-mono text-[11px] leading-[1.45] text-muted-foreground">{detail}</pre>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {message.text ? (
                <p className="whitespace-pre-wrap text-[var(--text-body-size)] leading-[var(--text-body-leading)]">{message.text}</p>
              ) : waiting && message.role === "assistant" ? (
                <p className="text-[var(--text-subheadline-size)] text-muted-foreground">Reading and thinking…</p>
              ) : null}
              {message.approvals?.map((approval) => (
                <div
                  key={approval.id}
                  className="mt-2 rounded-[var(--corner-md)] border border-[var(--border)] bg-[var(--secondary)] p-3"
                  data-testid="agent-approval"
                >
                  <p className="text-[var(--text-subheadline-size)] font-medium">
                    {approvalLabel(approval.name)}
                  </p>
                  <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground">
                    {approval.status === "pending"
                      ? "The agent will wait for your answer before changing anything."
                      : APPROVAL_STATUS[approval.status]}
                  </p>
                  {approval.status === "pending" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void approve(message, approval, true)}
                        data-testid="agent-approve"
                      >
                        Allow
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void approve(message, approval, false)}
                        data-testid="agent-deny"
                      >
                        Deny
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {message.note ? (
                <p
                  role={message.failed ? "alert" : undefined}
                  className={`mt-2 text-[var(--text-caption-size)] ${message.failed ? "text-[var(--destructive-text)]" : "text-muted-foreground"}`}
                >
                  {message.note}
                </p>
              ) : null}
              {message.failed && message.changed ? (
                <p role="status" className="mt-2 text-[var(--text-caption-size)] text-muted-foreground">
                  This attempt changed {message.changed} {message.changed === 1 ? "chapter" : "chapters"}. Undo it before retrying.
                </p>
              ) : null}
              {message.role === "assistant" && message.changed && message.turnId && message.undoAvailable !== false ? (
                <Button variant="secondary" size="sm" className="mt-2" onClick={() => void undo(message.turnId!)}>
                  Undo this turn
                </Button>
              ) : null}
              {message.role === "assistant" && message.turnId && !message.failed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => void branchFrom(message)}
                  data-testid="agent-branch-turn"
                  title="Copy this conversation up to this turn into a new thread"
                >
                  <GitBranch size={13} />
                  Branch from here
                </Button>
              ) : null}
              {message.failed && !message.changed && message.retryable !== false && message.errorCode !== "context" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void retry(message.id)} data-testid="agent-retry-request">
                    Retry request
                  </Button>
                  {message.errorCode === "auth" ? (
                    <Button variant="ghost" size="sm" onClick={onReconnect} data-testid="agent-reconnect">
                      Reconnect
                    </Button>
                  ) : null}
                  {message.errorCode === "invalid-request" ? (
                    <Button variant="ghost" size="sm" onClick={onChooseModel} data-testid="agent-request-model">
                      Choose a model
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {message.failed && message.errorCode === "context" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onChooseModel}
                    data-testid="agent-context-model"
                  >
                    Choose a larger model
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startNew}
                    data-testid="agent-context-new"
                  >
                    Start a new conversation
                  </Button>
                </div>
              ) : null}
              {message.context ? (
                <details className="mt-2 text-[var(--text-caption-size)]" data-testid="agent-context">
                  <summary className="cursor-pointer select-none text-muted-foreground">
                    Context · ~{message.context.totalTokens.toLocaleString()} tokens
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {message.context.sections.map((section) => (
                      <li key={section.id} className="flex justify-between gap-3">
                        <span>{section.label}</span>
                        <span className="tabular-nums">~{section.estimatedTokens.toLocaleString()}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3">
                      <span>Conversation</span>
                      <span className="tabular-nums">~{message.context.conversationTokens.toLocaleString()}</span>
                    </li>
                  </ul>
                  <p className="mt-1 text-muted-foreground">
                    Estimated from characters. The provider&apos;s reported usage is authoritative.
                  </p>
                </details>
              ) : null}
            </div>
          </div>
            </Fragment>
          );
        })}
      </div>

      <form onSubmit={(event) => void send(event)} className="border-t border-[var(--glass-outline)] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="What should change?"
          aria-label="Message the writing agent"
          data-testid="chat-input"
          className="w-full resize-none rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] px-3 py-2 text-[var(--text-body-size)] leading-[var(--text-body-leading)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <div className="mt-2 flex items-center justify-end gap-2 min-[520px]:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onChooseTurnModel}
              data-testid="agent-turn-model"
              title="Choose a model for the next message only"
              className="flex min-w-0 items-center gap-1 rounded-[var(--corner-sm)] px-1.5 py-1 text-[var(--text-caption-size)] text-muted-foreground transition-colors hover:bg-[var(--accent)] hover:text-foreground"
            >
              <Cpu size={13} className="shrink-0" />
              <span className="truncate">
                {turnModel ? `This turn: ${turnModel.modelId.split("/").pop()}` : "Model: book default"}
              </span>
            </button>
            <label
              className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[var(--text-caption-size)] text-muted-foreground"
              title="Keep the turn running after the window closes and notify you when it finishes"
            >
              <input
                type="checkbox"
                checked={background}
                onChange={(event) => setBackground(event.target.checked)}
                disabled={running}
                data-testid="agent-background"
                className="size-4 accent-[var(--primary)]"
              />
              <span className="hidden min-[520px]:inline">Background</span>
            </label>
            <p className="hidden min-w-0 text-[var(--text-caption-size)] text-muted-foreground min-[520px]:block">
              Enter sends · Shift Enter adds a line
            </p>
          </div>
          {running ? (
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => void stop()}>
              <Square size={13} />
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="sm" className="shrink-0" disabled={!input.trim()} data-testid="chat-send">
              <Send size={14} />
              Send
            </Button>
          )}
        </div>
      </form>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent
          title="Conversations"
          description="Continue an earlier conversation or start a new one."
        >
          {historyLoading ? (
            <p className="text-[var(--text-subheadline-size)] text-muted-foreground">Loading conversations…</p>
          ) : threads.length === 0 ? (
            <p className="text-[var(--text-subheadline-size)] text-muted-foreground">
              No earlier conversations yet. Send a message to start one.
            </p>
          ) : (
            <ul className="space-y-2">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  className="rounded-[var(--corner-md)] border border-[var(--border)] bg-[var(--secondary)]"
                >
                  {renamingId === thread.id ? (
                    <form onSubmit={(event) => void saveRename(event)} className="flex flex-wrap items-center gap-2 p-2">
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        aria-label="Conversation title"
                        data-testid="agent-rename-input"
                        autoFocus
                        className="min-w-0 flex-1 rounded-[var(--corner-sm)] border border-[var(--input)] bg-[var(--card)] px-2 py-1.5 text-[var(--text-subheadline-size)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      />
                      <Button type="submit" size="sm" disabled={!renameValue.trim()} data-testid="agent-rename-save">
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-start gap-1 p-2">
                      <button
                        type="button"
                        data-testid="thread-option"
                        onClick={() => void loadThread(thread.id)}
                        className="min-w-0 flex-1 rounded-[var(--corner-sm)] px-1.5 py-1 text-left transition-colors hover:bg-[var(--accent)] focus-visible:outline-2"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[var(--text-subheadline-size)] font-medium">
                            {thread.title}
                            {thread.id === threadId ? " · current" : ""}
                          </span>
                          <span className="shrink-0 text-[var(--text-caption-size)] text-muted-foreground">
                            {new Date(thread.updatedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric"
                            })}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[var(--text-caption-size)] text-muted-foreground">
                          {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
                        </span>
                        {thread.preview ? (
                          <span className="mt-1 line-clamp-2 block text-[var(--text-caption-size)] text-muted-foreground">
                            {thread.preview}
                          </span>
                        ) : null}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-11 min-[700px]:size-7"
                        onClick={() => beginRename(thread)}
                        aria-label={`Rename ${thread.title}`}
                        title="Rename conversation"
                        data-testid="agent-rename-thread"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-11 min-[700px]:size-7"
                        onClick={() => setDeleteTarget(thread)}
                        aria-label={`Delete ${thread.title}`}
                        title="Delete conversation"
                        data-testid="agent-delete-thread"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent
          title="Delete conversation?"
          description="This removes the stored messages and their checkpoints. The manuscript is not changed."
          footer={
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void deleteThread()} data-testid="agent-confirm-delete">
                Delete
              </Button>
            </DialogFooter>
          }
        >
          <p className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            “{deleteTarget?.title ?? "This conversation"}” will be removed from this book. This cannot be
            undone.
          </p>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
