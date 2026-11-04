import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Gauge, Plug, ScrollText, SlidersHorizontal, Smartphone, Wallet, Wrench } from "lucide-react";
import type { AgentStatus, SpendingStatus } from "@ai-book-studio/core/agent/metrics";
import type { AgentAnswerLength } from "@ai-book-studio/core/agent/settings";
import type { BridgeStatus } from "@ai-book-studio/core/ipc";
import { formatUsd } from "@ai-book-studio/core/providers/usage";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@ai-book-studio/ui/components/native-select";
import { Switch } from "@ai-book-studio/ui/components/switch";
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

/** Parse a dollar limit the author typed: empty clears it, anything else must be a positive number. */
function parseLimit(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The month line: what this book spent, honestly qualified when some turns went unpriced. */
function monthText(spending: SpendingStatus): string {
  const amount = formatUsd(spending.monthToDateUsd);
  if (spending.monthUnknownCostTurns <= 0) return `Spent ${amount} so far this month.`;
  const turns =
    spending.monthUnknownCostTurns === 1 ? "1 turn" : `${spending.monthUnknownCostTurns} turns`;
  return `Spent at least ${amount} so far this month: ${turns} did not report a cost.`;
}

/**
 * The agent's own settings and numbers.
 *
 * It shows what the agent can do, how well its tools worked, what the prompt cache did, and where
 * its plugins come from. Everything here is per book except the plugin folder, which points at
 * code on this computer.
 */
export function AgentDialog({ open, bookId, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  /** Tools switched on or off since the dialog opened. Their rows stay put until it closes. */
  const [changedTools, setChangedTools] = useState<ReadonlySet<string>>(() => new Set());
  const [toneDraft, setToneDraft] = useState<string | null>(null);
  const [perTurnDraft, setPerTurnDraft] = useState<string | null>(null);
  const [monthlyDraft, setMonthlyDraft] = useState<string | null>(null);

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
    void window.studio.agent
      .bridge()
      .then((result) => {
        if (result.ok) setBridge(result.data);
      })
      .catch(() => undefined);
  }, [open, refresh]);

  useEffect(() => {
    if (open) setChangedTools(new Set());
  }, [open]);

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
    if (!status || busy) return;
    // Before the save, so the row is still listed when the answer turns the tool off.
    setChangedTools((current) => new Set(current).add(name));
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
  // A row never leaves from under the author's pointer: a tool switched off here stays listed, reading Off.
  const visible = showAll
    ? status?.tools ?? []
    : (status?.tools ?? []).filter((tool) => tool.enabled || changedTools.has(tool.name));

  const toneValue = toneDraft ?? status?.tone ?? "";
  const saveTone = async (): Promise<void> => {
    await setSettings({ tone: toneValue });
    setToneDraft(null);
  };
  const clearTone = async (): Promise<void> => {
    setToneDraft(null);
    await setSettings({ tone: "" });
  };

  const perTurnLimit = status?.spending.perTurnCeilingUsd ?? null;
  const monthlyLimit = status?.spending.monthlyWarningUsd ?? null;
  const perTurnValue = perTurnDraft ?? (perTurnLimit === null ? "" : String(perTurnLimit));
  const monthlyValue = monthlyDraft ?? (monthlyLimit === null ? "" : String(monthlyLimit));
  const perTurnParsed = parseLimit(perTurnValue);
  const monthlyParsed = parseLimit(monthlyValue);
  const spendingUnchanged = perTurnParsed === perTurnLimit && monthlyParsed === monthlyLimit;
  const saveSpending = async (): Promise<void> => {
    if (perTurnParsed === undefined || monthlyParsed === undefined) return;
    await setSettings({ perTurnCeilingUsd: perTurnParsed, monthlyWarningUsd: monthlyParsed });
    setPerTurnDraft(null);
    setMonthlyDraft(null);
  };
  const clearSpending = async (): Promise<void> => {
    setPerTurnDraft(null);
    setMonthlyDraft(null);
    await setSettings({ perTurnCeilingUsd: null, monthlyWarningUsd: null });
  };

  const toggleBridge = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await must(window.studio.agent.setBridge(!(bridge?.running ?? false)));
      setBridge(next);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

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
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <Gauge size={15} />
            Performance
          </h3>
          <p
            className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground"
            data-testid="agent-performance"
          >
            {status ? <PerformanceLine status={status} /> : "Reading…"}
          </p>
          {status ? <CacheDetail status={status} /> : null}
          {status ? (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-(length:--text-caption-size) text-muted-foreground">
              <Switch
                checked={status.cache.mode === "auto"}
                onCheckedChange={(checked) => void setSettings({ cachePrefixMode: checked ? "auto" : "off" })}
                disabled={busy}
                data-testid="agent-cache-prefix"
                aria-label="Mark the prompt for the provider's cache"
              />
              <span>Mark the prompt for the provider&apos;s cache</span>
            </label>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <ScrollText size={15} />
            This book&apos;s instructions
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            {status?.skills.present
              ? `This book has a SKILLS.md with ${status.skills.characters} characters of instructions. The agent reads it as the author's own voice.`
              : "This book has no SKILLS.md. Add one to the book folder to give the agent your own house rules."}
          </p>
          {status?.skills.present ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-(length:--text-caption-size) text-muted-foreground">
              <Switch
                checked={status.skills.enabled}
                onCheckedChange={(checked) => void setSettings({ skillsEnabled: checked })}
                disabled={busy}
                data-testid="agent-skills-enabled"
                aria-label="Use this book's SKILLS.md"
              />
              <span>Use the SKILLS.md</span>
            </label>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <SlidersHorizontal size={15} />
            Tone and answer length
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Tell the agent how to sound and how long its answers should run. The tone and answer
            length travel with every turn you send for this book.
          </p>
          <label
            className="mt-3 block text-(length:--text-caption-size) text-muted-foreground"
            htmlFor="agent-tone"
          >
            Tone
          </label>
          <input
            id="agent-tone"
            type="text"
            value={toneValue}
            maxLength={500}
            placeholder="For example: plainspoken with dry humor"
            onChange={(event) => setToneDraft(event.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-[var(--corner-md)] border border-border px-3 py-2 text-(length:--text-body-size)"
            data-testid="agent-tone"
            aria-label="Tone"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void saveTone()}
              disabled={busy || toneValue === (status?.tone ?? "")}
              data-testid="agent-tone-save"
            >
              Save tone
            </Button>
            {toneValue !== "" ? (
              <Button variant="ghost" size="sm" onClick={() => void clearTone()} disabled={busy} data-testid="agent-tone-clear">
                Clear
              </Button>
            ) : null}
          </div>
          <label
            className="mt-4 block text-(length:--text-caption-size) text-muted-foreground"
            htmlFor="agent-answer-length"
          >
            Answer length
          </label>
          <NativeSelect
            id="agent-answer-length"
            value={status?.answerLength ?? "standard"}
            onChange={(event) => void setSettings({ answerLength: event.target.value as AgentAnswerLength })}
            disabled={busy || !status}
            className="mt-1"
            data-testid="agent-answer-length"
            aria-label="Answer length"
          >
            <NativeSelectOption value="brief">Brief</NativeSelectOption>
            <NativeSelectOption value="standard">Standard</NativeSelectOption>
            <NativeSelectOption value="detailed">Detailed</NativeSelectOption>
          </NativeSelect>
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <Wallet size={15} />
            Spending
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Set a per-turn ceiling and a monthly warning level for this book, in dollars. The studio
            warns you here when spending nears them. A warning never stops the agent.
          </p>
          <p
            className="mt-2 text-(length:--text-subheadline-size) text-muted-foreground"
            data-testid="agent-spending-month"
          >
            {status?.spending ? monthText(status.spending) : "Reading…"}
          </p>
          {status?.spending?.lastTurnWarning ?? status?.spending?.monthlyWarning ? (
            <ul className="mt-2 space-y-1" data-testid="agent-spending-warnings">
              {status?.spending?.lastTurnWarning ? (
                <li className="text-(length:--text-caption-size) text-muted-foreground">
                  {status.spending.lastTurnWarning.message}
                </li>
              ) : null}
              {status?.spending?.monthlyWarning ? (
                <li className="text-(length:--text-caption-size) text-muted-foreground">
                  {status.spending.monthlyWarning.message}
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block text-(length:--text-caption-size) text-muted-foreground"
                htmlFor="agent-spending-per-turn"
              >
                Per-turn ceiling
              </label>
              <input
                id="agent-spending-per-turn"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Dollars, for example 5"
                value={perTurnValue}
                onChange={(event) => setPerTurnDraft(event.target.value)}
                disabled={busy || !status}
                className="mt-1 w-full rounded-[var(--corner-md)] border border-border px-3 py-2 text-(length:--text-body-size)"
                data-testid="agent-spending-per-turn"
                aria-label="Per-turn ceiling in dollars"
              />
            </div>
            <div>
              <label
                className="block text-(length:--text-caption-size) text-muted-foreground"
                htmlFor="agent-spending-monthly"
              >
                Monthly warning level
              </label>
              <input
                id="agent-spending-monthly"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Dollars, for example 20"
                value={monthlyValue}
                onChange={(event) => setMonthlyDraft(event.target.value)}
                disabled={busy || !status}
                className="mt-1 w-full rounded-[var(--corner-md)] border border-border px-3 py-2 text-(length:--text-body-size)"
                data-testid="agent-spending-monthly"
                aria-label="Monthly warning level in dollars"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void saveSpending()}
              disabled={
                busy ||
                perTurnParsed === undefined ||
                monthlyParsed === undefined ||
                spendingUnchanged
              }
              data-testid="agent-spending-save"
            >
              Save spending limits
            </Button>
            {perTurnLimit !== null || monthlyLimit !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void clearSpending()}
                disabled={busy}
                data-testid="agent-spending-clear"
              >
                Clear
              </Button>
            ) : null}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <Smartphone size={15} />
            Your phone
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Turn this on and a phone on the same network can reach the studio: to show the agent&apos;s
            status on your glasses, and to send you the agent&apos;s answer. It listens on one local
            address and stops when you turn it off.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant={bridge?.running ? "secondary" : "primary"}
              size="sm"
              onClick={() => void toggleBridge()}
              disabled={busy}
              data-testid="agent-bridge-toggle"
            >
              {bridge?.running ? "Turn it off" : "Turn it on"}
            </Button>
          </div>
          {bridge?.running && bridge.url ? (
            <div className="mt-2" data-testid="agent-bridge-details">
              <p className="truncate rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {bridge.url}
              </p>
              <p className="mt-1 truncate rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 font-mono text-[11px] text-muted-foreground">
                token {bridge.token}
              </p>
            </div>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <Plug size={15} />
            Plugins
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
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
            <p className="mt-2 text-(length:--text-caption-size) text-muted-foreground" data-testid="agent-plugin-tools">
              Tools from plugins: {status.plugins.tools.join(", ")}
            </p>
          ) : null}
          {status?.plugins.failures.length ? (
            <ul className="mt-2 space-y-1" data-testid="agent-plugin-failures">
              {status.plugins.failures.map((failure) => (
                <li key={failure.file} className="text-(length:--text-caption-size) text-[var(--destructive-text)]">
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
          <h3 className="flex items-center gap-2 text-(length:--text-callout-size) font-medium">
            <Wrench size={15} />
            Tools
          </h3>
          <p className="mt-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
            Turn a tool off and the agent will not be offered it. A tool that is off is also
            unreachable from the command line and from another agent.
          </p>
          {withdrawn.length > 0 ? (
            <p className="mt-2 text-(length:--text-caption-size) text-muted-foreground" data-testid="agent-withdrawn-tools">
              Off for this book: {withdrawn.map((tool) => tool.name).join(", ")}
            </p>
          ) : null}
          <ul className="mt-3 divide-y divide-border rounded-[var(--corner-lg)] border border-border">
            {TIER_ORDER.flatMap((tier) => visible.filter((tool) => tool.tier === tier)).map((tool) => (
              <li key={tool.name} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-(length:--text-caption-size)">{tool.name}</p>
                  <p className="mt-0.5 text-(length:--text-caption-size) text-muted-foreground">
                    {TIER_LABEL[tool.tier]}
                  </p>
                  {tool.calls > 0 ? (
                    <p
                      className="mt-0.5 text-(length:--text-caption-size) text-muted-foreground"
                      data-testid={`agent-tool-counts-${tool.name}`}
                    >
                      {tool.calls} call{tool.calls === 1 ? "" : "s"} · {tool.successes} ok
                      {tool.failures > 0 ? ` · ${tool.failures} failed` : ""}
                    </p>
                  ) : null}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-(length:--text-caption-size) text-muted-foreground">
                  <span>{tool.enabled ? "On" : "Off"}</span>
                  {/* Never disabled while a save is on its way: Chromium drops focus from a focused
                      button that becomes disabled. toggleTool ignores a press until the save lands. */}
                  <Switch
                    checked={tool.enabled}
                    onCheckedChange={(checked) => void toggleTool(tool.name, checked)}
                    data-testid={`agent-tool-${tool.name}`}
                    aria-label={tool.name}
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
      className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-(length:--text-caption-size) text-muted-foreground sm:grid-cols-4"
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
