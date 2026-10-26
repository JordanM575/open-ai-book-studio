import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Gauge, Plug, ScrollText, Wrench } from "lucide-react";
import type { AgentStatus } from "@ai-book-studio/core/agent/metrics";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  open: boolean;
  bookId: string;
  onClose: () => void;
  onNotice: (error: unknown) => void;
}

const TIER_LABEL: Record<AgentStatus["tools"][number]["tier"], string> = {
  read: "Reads",
  write: "Writes",
  destructive: "Can remove or replace work"
};

const TIER_ORDER: AgentStatus["tools"][number]["tier"][] = ["read", "write", "destructive"];

/**
 * The agent's own settings and numbers.
 *
 * It shows what the agent can do, how well its tools worked, what the prompt cache did, and where
 * its plugins come from. Everything here is per book except the plugin folder, which points at
 * code on this computer.
 */
export function AgentDialog({ open, bookId, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await must(window.studio.agent.status(bookId));
      setStatus(next);
    } catch (error) {
      onNotice(error);
    }
  }, [bookId, onNotice]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const setSettings = async (
    patch: Parameters<typeof window.studio.agent.setSettings>[1]
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await must(window.studio.agent.setSettings(bookId, patch));
      setStatus(next);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = async (name: string, enabled: boolean): Promise<void> => {
    if (!status) return;
    const disabled = new Set(status.tools.filter((tool) => !tool.enabled).map((tool) => tool.name));
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    await setSettings({ disabledTools: [...disabled] });
  };

  const chooseFolder = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await must(window.studio.agent.choosePluginFolder());
      if (!picked) return;
      const next = await must(window.studio.agent.setPluginFolder(picked));
      setStatus((current) => (current ? { ...current, plugins: next } : current));
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const clearFolder = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await must(window.studio.agent.setPluginFolder(null));
      setStatus((current) => (current ? { ...current, plugins: next } : current));
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const withdrawn = status?.tools.filter((tool) => !tool.enabled) ?? [];
  const visible = showAll ? status?.tools ?? [] : (status?.tools ?? []).filter((tool) => tool.enabled);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Agent"
        description="What the writing agent may do, and how it is doing."
        className="w-[calc(100vw-48px)] max-w-[680px]"
        footer={
          <DialogFooter className="mt-0">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Done
            </Button>
          </DialogFooter>
        }
      >
        <section>
          <h3 className="flex items-center gap-2 text-[var(--text-callout-size)] font-medium">
            <Gauge size={15} />
            Performance
          </h3>
          <p
            className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground"
            data-testid="agent-performance"
          >
            {status ? <PerformanceLine status={status} /> : "Reading…"}
          </p>
          {status ? <CacheDetail status={status} /> : null}
          {status ? (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[var(--text-caption-size)] text-muted-foreground">
              <input
                type="checkbox"
                checked={status.cache.mode === "auto"}
                onChange={(event) =>
                  void setSettings({ cachePrefixMode: event.target.checked ? "auto" : "off" })
                }
                disabled={busy}
                className="size-4 accent-[var(--primary)]"
                data-testid="agent-cache-prefix"
                aria-label="Mark the prompt for the provider's cache"
              />
              <span>Mark the prompt for the provider&apos;s cache</span>
            </label>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-[var(--text-callout-size)] font-medium">
            <ScrollText size={15} />
            This book&apos;s instructions
          </h3>
          <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            {status?.skills.present
              ? `This book has a SKILLS.md with ${status.skills.characters} characters of instructions. The agent reads it as the author's own voice.`
              : "This book has no SKILLS.md. Add one to the book folder to give the agent your own house rules."}
          </p>
          {status?.skills.present ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[var(--text-caption-size)] text-muted-foreground">
              <input
                type="checkbox"
                checked={status.skills.enabled}
                onChange={(event) => void setSettings({ skillsEnabled: event.target.checked })}
                disabled={busy}
                className="size-4 accent-[var(--primary)]"
                data-testid="agent-skills-enabled"
                aria-label="Use this book's SKILLS.md"
              />
              <span>Use the SKILLS.md</span>
            </label>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-[var(--text-callout-size)] font-medium">
            <Plug size={15} />
            Plugins
          </h3>
          <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            A plugin folder holds TypeScript files that add tools. They run inside this app, with the same
            access to your books. Only point at code you trust.
          </p>
          {status?.plugins.folder ? (
            <p
              className="mt-2 truncate rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 font-mono text-[11px] text-muted-foreground"
              title={status.plugins.folder}
              data-testid="agent-plugin-folder"
            >
              {status.plugins.folder}
            </p>
          ) : null}
          {status?.plugins.tools.length ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground" data-testid="agent-plugin-tools">
              Tools from plugins: {status.plugins.tools.join(", ")}
            </p>
          ) : null}
          {status?.plugins.failures.length ? (
            <ul className="mt-2 space-y-1" data-testid="agent-plugin-failures">
              {status.plugins.failures.map((failure) => (
                <li key={failure.file} className="text-[var(--text-caption-size)] text-[var(--destructive-text)]">
                  {failure.file}: {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void chooseFolder()}
              disabled={busy}
              data-testid="agent-choose-plugins"
            >
              <FolderOpen size={14} />
              Choose a folder…
            </Button>
            {status?.plugins.folder ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void clearFolder()}
                disabled={busy}
                data-testid="agent-clear-plugins"
              >
                Use no plugins
              </Button>
            ) : null}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-[var(--text-callout-size)] font-medium">
            <Wrench size={15} />
            Tools
          </h3>
          <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Turn a tool off and the agent will not be offered it. A tool that is off is also
            unreachable from the command line and from another agent.
          </p>
          {withdrawn.length > 0 ? (
            <p className="mt-2 text-[var(--text-caption-size)] text-muted-foreground" data-testid="agent-withdrawn-tools">
              Off for this book: {withdrawn.map((tool) => tool.name).join(", ")}
            </p>
          ) : null}
          <ul className="mt-3 divide-y divide-border rounded-[var(--corner-lg)] border border-border">
            {TIER_ORDER.flatMap((tier) => visible.filter((tool) => tool.tier === tier)).map((tool) => (
              <li key={tool.name} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[var(--text-caption-size)]">{tool.name}</p>
                  <p className="mt-0.5 text-[var(--text-caption-size)] text-muted-foreground">
                    {TIER_LABEL[tool.tier]}
                  </p>
                  {tool.calls > 0 ? (
                    <p
                      className="mt-0.5 text-[var(--text-caption-size)] text-muted-foreground"
                      data-testid={`agent-tool-counts-${tool.name}`}
                    >
                      {tool.calls} call{tool.calls === 1 ? "" : "s"} · {tool.successes} ok
                      {tool.failures > 0 ? ` · ${tool.failures} failed` : ""}
                    </p>
                  ) : null}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[var(--text-caption-size)] text-muted-foreground">
                  <span>{tool.enabled ? "On" : "Off"}</span>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={(event) => void toggleTool(tool.name, event.target.checked)}
                    disabled={busy}
                    className="size-4 accent-[var(--primary)]"
                    data-testid={`agent-tool-${tool.name}`}
                    aria-label={`${tool.name} ${tool.enabled ? "on" : "off"}`}
                  />
                </label>
              </li>
            ))}
          </ul>
          {status && status.tools.length > visible.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setShowAll((current) => !current)}
              data-testid="agent-show-all-tools"
            >
              {showAll ? "Show only the tools in use" : `Show all ${status.tools.length} tools`}
            </Button>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** One line: the cache rate, the tool success rate and the busiest tool. */
function PerformanceLine({ status }: { status: AgentStatus }) {
  const cache = status.cache;
  const cacheText =
    cache.hitRate === null
      ? "This provider does not report a prompt cache."
      : `${Math.round(cache.hitRate * 100)}% of the prompt came from the cache${
          cache.turnsWithCache > 0 ? ` (${cache.turnsWithCache} of ${cache.turns} turns)` : ""
        }.`;
  const totals = status.toolTotals;
  const toolText =
    totals.calls === 0
      ? "The agent has not called a tool yet."
      : `${totals.calls} tool call${totals.calls === 1 ? "" : "s"}, ${totals.failures} of them failed.`;
  return (
    <>
      {cacheText} {toolText}
    </>
  );
}

/** The cache numbers, when there are any. */
function CacheDetail({ status }: { status: AgentStatus }) {
  const cache = status.cache;
  if (cache.turns === 0) return null;
  return (
    <dl
      className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-caption-size)] text-muted-foreground sm:grid-cols-4"
      data-testid="agent-cache-detail"
    >
      <div>
        <dt className="sr-only">Cached input tokens</dt>
        <dd>{cache.cachedInputTokens.toLocaleString()} cached tokens</dd>
      </div>
      <div>
        <dt className="sr-only">Fresh input tokens</dt>
        <dd>{cache.freshInputTokens.toLocaleString()} sent</dd>
      </div>
      <div>
        <dt className="sr-only">Turns that hit the cache</dt>
        <dd>
          {cache.turnsWithCache} of {cache.turns} turns hit
        </dd>
      </div>
      <div>
        <dt className="sr-only">Cache mode</dt>
        <dd>{cache.mode === "auto" ? "Prefix marked" : "Prefix not marked"}</dd>
      </div>
    </dl>
  );
}
