import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import type { BookMeta } from "@ai-book-studio/core/schema";
import type { ConnectionSummary, ModelInfo, ProviderDescription } from "@ai-book-studio/core/providers/types";
import { canRunAgent, unavailableReason } from "@ai-book-studio/core/providers/models";
import { contributorWarning, isContributorModel } from "@ai-book-studio/core/providers/compatibility";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  open: boolean;
  book: BookMeta;
  onClose: () => void;
  /** Save the book default. Omit when choosing a one-off model. */
  onSaved?: (book: BookMeta) => void;
  /** Choose a model for the next turn only. Omit when saving the book default. */
  onPick?: (choice: { connectionId: string; modelId: string }) => void;
  /** The current one-off choice when the turn picker is reopened. */
  initial?: { connectionId: string; modelId: string } | null;
  /** Open Settings on the provider connections, so an author with no key is not stuck. */
  onOpenSettings?: () => void;
}

export function ModelPickerDialog({ open, book, onClose, onSaved, onPick, initial, onOpenSettings }: Props) {
  const turnMode = Boolean(onPick);
  const initialConnectionId = initial?.connectionId ?? book.defaultConnectionId;
  const initialModelId = initial?.modelId ?? book.defaultModelId;
  const [providers, setProviders] = useState<ProviderDescription[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(initialModelId);
  const [allowContributor, setAllowContributor] = useState(book.allowContributorTraining);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setError(null);
    try {
      const [providerList, connectionList] = await Promise.all([
        must(window.studio.providers.list()),
        must(window.studio.connections.list())
      ]);
      setProviders(providerList);
      setConnections(connectionList);
      setConnectionId((current) => {
        if (current && connectionList.some((connection) => connection.id === current)) return current;
        const saved = connectionList.find((connection) => connection.id === initialConnectionId);
        return saved?.id ?? connectionList[0]?.id ?? null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [initialConnectionId]);

  useEffect(() => {
    if (!open) return;
    setConnectionId(initialConnectionId);
    setChosen(initialModelId);
    setAllowContributor(book.allowContributorTraining);
    setSearch("");
    void loadConnections();
  }, [open, initialConnectionId, initialModelId, book.allowContributorTraining, loadConnections]);

  const loadModels = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setModels([]);
    try {
      const catalogue = await must(window.studio.providers.models(id));
      setModels(catalogue.models);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !connectionId) return;
    void loadModels(connectionId);
  }, [open, connectionId, loadModels]);

  const savedModelMissing =
    !loading &&
    models.length > 0 &&
    connectionId === initialConnectionId &&
    initialModelId !== null &&
    !models.some((model) => model.id === initialModelId);

  useEffect(() => {
    if (savedModelMissing) setChosen(null);
  }, [savedModelMissing]);

  const providerName = (id: ConnectionSummary["provider"]) => providers.find((provider) => provider.id === id)?.name ?? id;
  const connection = connections.find((item) => item.id === connectionId) ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...models].sort((a, b) => Number(canRunAgent(b)) - Number(canRunAgent(a)) || a.name.localeCompare(b.name));
    return query ? sorted.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query)) : sorted;
  }, [models, search]);
  const chosenModel = models.find((model) => model.id === chosen) ?? null;
  const contributor = isContributorModel(chosenModel);
  const warning = contributorWarning(chosenModel);

  const save = async (): Promise<void> => {
    if (!connection || !chosen || saving) return;
    if (contributor && !allowContributor) return;
    if (onPick) {
      if (contributor && !book.allowContributorTraining) {
        setSaving(true);
        setError(null);
        try {
          await must(window.studio.books.update(book.id, { allowContributorTraining: true }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setSaving(false);
          return;
        }
        setSaving(false);
      }
      onPick({ connectionId: connection.id, modelId: chosen });
      onClose();
      return;
    }
    if (!onSaved) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await must(
        window.studio.books.update(book.id, {
          defaultProvider: connection.provider,
          defaultConnectionId: connection.id,
          defaultModelId: chosen,
          allowContributorTraining: contributor ? allowContributor : book.allowContributorTraining
        })
      );
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title={turnMode ? "Model for this turn" : "Model for this book"}
        description={
          turnMode
            ? "Use this model for the next message only. The book default stays the same."
            : "The writing agent uses this model until you change it."
        }
        className="w-[calc(100vw-48px)] max-w-[600px]"
      >
        {connections.length === 0 ? (
          <div className="py-6">
            <p className="text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
              No provider is connected yet. Add a key in Settings to choose a model.
            </p>
            {onOpenSettings ? (
              <Button variant="secondary" className="mt-4" onClick={onOpenSettings} data-testid="open-provider-settings">
                Open Settings
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[var(--text-caption-size)] font-medium text-muted-foreground">Connection</p>
              <div className="flex flex-wrap gap-2">
                {connections.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setConnectionId(item.id);
                      setChosen(null);
                    }}
                    className={`rounded-[var(--corner-md)] border px-3 py-2 text-left text-[var(--text-subheadline-size)] transition-colors ${
                      item.id === connectionId
                        ? "border-[var(--ring)] bg-[var(--accent)]"
                        : "border-[var(--border)] hover:bg-[var(--accent)]"
                    }`}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-[var(--text-caption-size)] text-muted-foreground">{providerName(item.provider)}</span>
                  </button>
                ))}
              </div>
            </div>

            {savedModelMissing ? (
              <p className="rounded-[var(--corner-md)] border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-[var(--text-subheadline-size)] text-muted-foreground">
                The {turnMode ? "chosen" : "saved"} model is no longer offered on this connection. Choose
                another before you write.
              </p>
            ) : null}

            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="w-full rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] py-2 pl-9 pr-3 text-[var(--text-subheadline-size)] outline-none focus-visible:border-[var(--ring)]"
              />
            </div>

            <div className="thin-scroll max-h-[320px] space-y-1 overflow-y-auto rounded-[var(--corner-lg)] border border-[var(--border)] p-1">
              {loading ? (
                <p className="flex items-center gap-2 p-4 text-[var(--text-subheadline-size)] text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Loading models…
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-[var(--text-subheadline-size)] text-muted-foreground">No models match that search.</p>
              ) : (
                filtered.map((model) => {
                  const usable = canRunAgent(model);
                  const reason = unavailableReason(model);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      disabled={!usable}
                      onClick={() => setChosen(model.id)}
                      className={`flex w-full items-start justify-between gap-3 rounded-[var(--corner-sm)] px-3 py-2 text-left transition-colors ${
                        model.id === chosen ? "bg-[var(--accent)]" : usable ? "hover:bg-[var(--accent)]" : "opacity-60"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[var(--text-subheadline-size)] font-medium">{model.name}</span>
                        <span className="tabular block text-[var(--text-caption-size)] text-muted-foreground">
                          {model.contextLength ? `${Math.round(model.contextLength / 1000)}k context` : "Context not reported"}
                          {" · "}
                          {model.inputPricePerMillion === null
                            ? "Price not reported"
                            : `$${model.inputPricePerMillion.toFixed(2)} in · $${(model.outputPricePerMillion ?? 0).toFixed(2)} out per million`}
                        </span>
                        {model.trainingOnData ? (
                          <span className="block text-[var(--text-caption-size)] text-muted-foreground">
                            Contributor · Meta may train on this content
                          </span>
                        ) : null}
                        {!usable && reason ? (
                          <span className="block text-[var(--text-caption-size)] text-destructive-text">{reason}</span>
                        ) : null}
                      </span>
                      {model.id === chosen ? <Check size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden /> : null}
                    </button>
                  );
                })
              )}
            </div>

            {error ? (
              <p className="text-[var(--text-subheadline-size)] text-destructive-text" role="alert">
                {error}
              </p>
            ) : null}

            {contributor && warning ? (
              <div className="rounded-[var(--corner-lg)] border border-[var(--warning)] bg-[var(--secondary)] p-3">
                <p className="text-[var(--text-subheadline-size)] font-medium">Contributor mode</p>
                <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground">{warning}</p>
                <label className="mt-2 flex items-start gap-2 text-[var(--text-caption-size)]">
                  <input
                    type="checkbox"
                    checked={allowContributor}
                    onChange={(event) => setAllowContributor(event.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    data-testid="allow-contributor"
                  />
                  <span>
                    I understand and allow this book’s content to be used to train Meta’s models.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!connection || !chosen || saving || connections.length === 0 || (contributor && !allowContributor)}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {turnMode ? "Use for this turn" : "Use this model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
