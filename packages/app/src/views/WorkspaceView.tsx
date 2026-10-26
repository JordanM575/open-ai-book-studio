import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, Cpu, Download, Image as ImageIcon, List, MessageSquare, Monitor, Moon, MoreHorizontal, Plus, Search, Settings2, Sun, type LucideIcon } from "lucide-react";
import type { BookDetail, BookMeta, Chapter, ChapterConflict } from "@ai-book-studio/core/schema";
import type { ImageRecord } from "@ai-book-studio/core/images/schema";
import type { StorageSummary } from "@ai-book-studio/core/library/storage";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { ChapterRail } from "../components/ChapterRail";
import { ModelPickerDialog } from "../components/ModelPickerDialog";
import { IllustrationDialog } from "../components/IllustrationDialog";
import { StoryBibleDialog } from "../components/StoryBibleDialog";
import { SearchDialog } from "../components/SearchDialog";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsDialog, type SettingsSection } from "../components/SettingsDialog";
import { ManuscriptEditor, statusLabel, type EditorHandle, type SaveStatus } from "../components/ManuscriptEditor";
import { clearEditorHistory } from "../lib/editor-history";
import { formatCount, formatWords, must, pluralize } from "../lib/utils";
import type { ThemeChoice } from "../hooks/use-theme";

interface Props {
  bookId: string;
  theme: { choice: ThemeChoice; set: (choice: ThemeChoice) => void; cycle: () => void };
  libraryRoot: string;
  libraryStorage?: StorageSummary;
  onBack: () => void;
  onNotice: (error: unknown) => void;
}

const EMPTY_STATUS: SaveStatus = { kind: "saved", at: Date.now() };

/** A short, always-visible label. The full label (with time) stays in aria-label. */
function compactStatus(status: SaveStatus): string {
  switch (status.kind) {
    case "saved":
      return "Saved";
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving…";
    case "conflict":
    case "error":
      return "Not saved";
  }
}

export function WorkspaceView({ bookId, theme, libraryRoot, libraryStorage, onBack, onNotice }: Props) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>(EMPTY_STATUS);
  const [conflicts, setConflicts] = useState<ChapterConflict[]>([]);
  const [externalChange, setExternalChange] = useState<{ paths: string[]; at: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Chapter | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelMode, setModelMode] = useState<"book" | "turn">("book");
  const [turnModel, setTurnModel] = useState<{ connectionId: string; modelId: string } | null>(null);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [illustrationOpen, setIllustrationOpen] = useState(false);
  const [illustration, setIllustration] = useState<ImageRecord | null>(null);
  const [illustrationData, setIllustrationData] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const lastLocalActionAt = useRef(0);
  const isMac = window.studio.platform === "darwin";

  const openSettings = useCallback((next?: SettingsSection) => {
    setSettingsSection(next);
    setSettingsOpen(true);
  }, []);

  const openModelPicker = useCallback((mode: "book" | "turn" = "book") => {
    setModelMode(mode);
    setModelOpen(true);
  }, []);

  useEffect(() => {
    setTurnModel(null);
  }, [bookId]);

  const load = useCallback(
    async (preferId?: string) => {
      try {
        const next = await must(window.studio.books.open(bookId));
        setDetail(next);
        setConflicts(await must(window.studio.conflicts.list(bookId)));
        setSelectedId((current) => {
          const wanted = preferId ?? current;
          return next.chapters.some((chapter) => chapter.id === wanted) ? (wanted ?? null) : (next.chapters[0]?.id ?? null);
        });
      } catch (error) {
        onNotice(error);
      }
    },
    [bookId, onNotice]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.studio.library.onChange((change) => {
      // A local save, create, delete or reorder also reaches the watcher. Give it a short grace
      // period so the author is not asked to refresh their own work.
      if (Date.now() - lastLocalActionAt.current < 2000) return;
      setExternalChange(change);
    });
  }, []);

  const selected = detail?.chapters.find((chapter) => chapter.id === selectedId) ?? null;
  const ordinal = selected ? detail!.chapters.filter((chapter) => chapter.order <= selected.order).length : 0;

  const loadIllustration = useCallback(
    async (chapterId: string | null) => {
      if (!chapterId) {
        setIllustration(null);
        setIllustrationData(null);
        return;
      }
      try {
        const listed = await must(window.studio.images.list(bookId));
        const attached = listed.manifest.images.find((image) => image.chapterId === chapterId) ?? null;
        if (!attached) {
          setIllustration(null);
          setIllustrationData(null);
          return;
        }
        const stored = await must(window.studio.images.read(bookId, attached.id));
        setIllustration(attached);
        setIllustrationData(stored?.dataUrl ?? null);
      } catch {
        setIllustration(null);
        setIllustrationData(null);
      }
    },
    [bookId]
  );

  useEffect(() => {
    void loadIllustration(selectedId);
  }, [selectedId, loadIllustration]);

  const select = async (chapterId: string): Promise<void> => {
    if (chapterId === selectedId) return;
    await editorRef.current?.flush();
    setStatus(EMPTY_STATUS);
    setSelectedId(chapterId);
  };

  const addChapter = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await editorRef.current?.flush();
      const chapter = await must(window.studio.chapters.create(bookId, {}));
      lastLocalActionAt.current = Date.now();
      setDetail((current) =>
        current ? { ...current, chapters: [...current.chapters, chapter].sort((a, b) => a.order - b.order) } : current
      );
      setSelectedId(chapter.id);
      setStatus(EMPTY_STATUS);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const moveChapter = async (chapter: Chapter, direction: "up" | "down"): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await editorRef.current?.flush();
      const result = await must(window.studio.chapters.reorder(bookId, chapter.id, direction));
      lastLocalActionAt.current = Date.now();
      if (result.status === "conflict") {
        onNotice(
          new Error(
            `The chapter order changed outside the studio. ${result.conflict.savedAs ? `Your version is in ${result.conflict.savedAs}.` : "Reopen the book and try again."}`
          )
        );
        await load(chapter.id);
        return;
      }
      setDetail((current) => (current ? { ...current, chapters: result.chapters } : current));
      setSelectedId(chapter.id);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const moveChapterTo = async (chapter: Chapter, targetIndex: number): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await editorRef.current?.flush();
      const result = await must(window.studio.chapters.move(bookId, chapter.id, targetIndex));
      lastLocalActionAt.current = Date.now();
      if (result.status === "conflict") {
        onNotice(
          new Error(
            `The chapter order changed outside the studio. ${result.conflict.savedAs ? `Your version is in ${result.conflict.savedAs}.` : "Reopen the book and try again."}`
          )
        );
        await load(chapter.id);
        return;
      }
      setDetail((current) => (current ? { ...current, chapters: result.chapters } : current));
      setSelectedId(chapter.id);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const refreshFromDisk = async (): Promise<void> => {
    try {
      await editorRef.current?.flush();
      setExternalChange(null);
      // The disk version is the new baseline; undo must not jump back across an external edit.
      if (selectedId) clearEditorHistory(selectedId);
      await load(selectedId ?? undefined);
      // Remount after the new detail is in state; remounting first would seed the editor with the
      // old chapter and leave it there when the hash arrives.
      setReloadKey((key) => key + 1);
    } catch (error) {
      onNotice(error);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!selected || busy) return;
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void moveChapter(selected, event.key === "ArrowUp" ? "up" : "down");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, busy, moveChapter]);

  const exportDocx = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      await editorRef.current?.flush();
      const path = await must(window.studio.books.exportDocx(bookId));
      if (!path) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      setExportNote(`Saved ${name}`);
      window.setTimeout(() => setExportNote(null), 8000);
    } catch (error) {
      onNotice(error);
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await editorRef.current?.flush();
      await must(window.studio.chapters.delete(bookId, pendingDelete.id));
      clearEditorHistory(pendingDelete.id);
      lastLocalActionAt.current = Date.now();
      const remaining = detail?.chapters.filter((chapter) => chapter.id !== pendingDelete.id) ?? [];
      setDetail((current) => (current ? { ...current, chapters: remaining } : current));
      if (selectedId === pendingDelete.id) setSelectedId(remaining[0]?.id ?? null);
      setPendingDelete(null);
      setStatus(EMPTY_STATUS);
    } catch (error) {
      onNotice(error);
    } finally {
      setBusy(false);
    }
  };

  const onSaved = useCallback((saved: Chapter) => {
    lastLocalActionAt.current = Date.now();
    setDetail((current) =>
      current
        ? {
            ...current,
            chapters: current.chapters
              .map((chapter) => (chapter.id === saved.id ? saved : chapter))
              .sort((a, b) => a.order - b.order)
          }
        : current
    );
  }, []);

  const wordTotal = detail?.chapters.reduce((total, chapter) => total + chapter.wordCount, 0) ?? 0;
  const conflict = status.kind === "conflict" ? status.conflict : null;

  return (
    <div className="window-wash flex h-full flex-col" data-testid="workspace-view">
      <header className={`titlebar-drag flex h-14 shrink-0 items-center justify-between gap-3 pr-2 pl-3 min-[700px]:h-16 min-[700px]:gap-4 min-[700px]:pr-4 ${isMac ? "min-[700px]:pl-[92px]" : "min-[700px]:pl-5"}`}>
        <div className="flex min-w-0 items-center gap-1.5 min-[700px]:gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to library" title="Back to library" className="shrink-0">
            <ChevronLeft size={18} />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-[var(--text-headline-size)] leading-tight font-semibold">{detail?.book.title || "Loading…"}</h1>
            <p className="tabular text-[11px] text-muted-foreground min-[700px]:text-[var(--text-caption-size)]">
              {detail ? `${formatCount(detail.chapters.length)} ${pluralize(detail.chapters.length, "chapter")} · ${formatWords(wordTotal)}` : "Opening book…"}
            </p>
          </div>
        </div>

        <div className="titlebar-no-drag flex shrink-0 items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-[var(--text-caption-size)] text-muted-foreground"
            aria-live="polite"
            aria-label={statusLabel(status)}
            data-testid="save-status"
          >
            <span
              className={`size-1.5 rounded-full ${
                status.kind === "saved"
                  ? "bg-[var(--success)]"
                  : status.kind === "conflict" || status.kind === "error"
                    ? "bg-[var(--destructive)]"
                    : "bg-[var(--warning)]"
              }`}
              aria-hidden
            />
            <span className="text-[11px] min-[700px]:text-[var(--text-caption-size)]">{compactStatus(status)}</span>
          </span>

          <div className="hidden items-center gap-2 min-[700px]:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Search the book"
              title="Search the book"
              data-testid="open-search"
            >
              <Search size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setBibleOpen(true)}
              aria-label="Story Bible"
              title="Story Bible"
              data-testid="open-story-bible"
            >
              <BookOpen size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIllustrationOpen(true)}
              aria-label="Illustration"
              title="Illustration"
              data-testid="open-illustration"
            >
              <ImageIcon size={16} />
            </Button>
            {exportNote ? (
              <span className="max-w-[180px] truncate text-[var(--text-caption-size)] text-muted-foreground" title={exportNote}>
                {exportNote}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void exportDocx()}
              aria-label="Export manuscript"
              title="Export manuscript"
              data-testid="export-docx"
              disabled={exporting}
            >
              <Download size={16} />
            </Button>
            <Button variant="ghost" size="icon" onClick={theme.cycle} aria-label={`Theme: ${theme.choice}`} title={`Theme: ${theme.choice}`}>
              {theme.choice === "light" ? <Sun size={16} /> : theme.choice === "dark" ? <Moon size={16} /> : <Monitor size={16} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openSettings()}
              aria-label="Settings"
              title="Settings"
              data-testid="open-settings"
            >
              <Settings2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChatOpen((open) => !open)}
              aria-label={chatOpen ? "Hide the writing agent" : "Show the writing agent"}
              title="Writing agent"
              data-testid="toggle-chat"
            >
              <MessageSquare size={16} />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openModelPicker("book")}
              title="Choose the model for this book"
              data-testid="open-model-picker"
            >
              <Cpu size={15} />
              <span className="max-w-[160px] truncate">{detail?.book.defaultModelId?.split("/").pop() ?? "Choose a model"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 gap-3 px-3 pb-3 min-[700px]:gap-4 min-[700px]:px-4 min-[700px]:pb-4">
        <div className="hidden min-[700px]:flex">
          <ChapterRail
            chapters={detail?.chapters ?? []}
            selectedId={selectedId}
            busy={busy}
            onSelect={select}
            onAdd={addChapter}
            onMove={moveChapter}
            onMoveTo={moveChapterTo}
            onDelete={setPendingDelete}
          />
        </div>

        {railOpen ? (
          <div className="fixed inset-0 z-30 flex min-[700px]:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
              aria-label="Close chapters"
              onClick={() => setRailOpen(false)}
            />
            <ChapterRail
              className="relative z-10 m-3 w-[280px]"
              chapters={detail?.chapters ?? []}
              selectedId={selectedId}
              busy={busy}
              onSelect={async (chapterId) => {
                await select(chapterId);
                setRailOpen(false);
              }}
              onAdd={addChapter}
              onMove={moveChapter}
              onMoveTo={moveChapterTo}
              onDelete={setPendingDelete}
              onClose={() => setRailOpen(false)}
            />
          </div>
        ) : null}

        <section className="thin-scroll min-w-0 flex-1 overflow-y-auto">
          {conflict ? (
            <div className="glass mb-4 rounded-[var(--corner-lg)] p-4">
              <p className="text-[var(--text-callout-size)] font-semibold text-[var(--destructive-text)]">This chapter was saved somewhere else</p>
              <p className="mt-1 text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
                {conflict.reason === "external-edit"
                  ? "The file changed on disk while you were writing, so your text was kept as a separate copy instead of overwriting the change."
                  : "A newer version of this chapter exists on disk, so your text was kept as a separate copy instead of overwriting it."}
              </p>
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={conflict.savedAs}>
                {conflict.savedAs}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void must(window.studio.conflicts.reveal(bookId, conflict.savedAs)).catch((error) => onNotice(error))
                  }
                >
                  Show the saved copy
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void load(selectedId ?? undefined).then(() => setReloadKey((key) => key + 1));
                  }}
                >
                  Load the version on disk
                </Button>
              </div>
            </div>
          ) : null}

          {conflicts.length > 0 && !conflict ? (
            <div className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--corner-lg)] px-4 py-3">
              <p className="text-[var(--text-subheadline-size)] text-muted-foreground">
                {formatCount(conflicts.length)} saved {pluralize(conflicts.length, "copy", "copies")} from earlier sync conflicts.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void must(window.studio.conflicts.reveal(bookId, conflicts[0]!.savedAs)).catch((error) => onNotice(error))}
              >
                Show in folder
              </Button>
            </div>
          ) : null}

          {externalChange ? (
            <div
              className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--corner-lg)] px-4 py-3"
              data-testid="external-change"
              role="status"
            >
              <div className="min-w-0">
                <p className="text-[var(--text-subheadline-size)] font-medium">The library changed outside the studio</p>
                <p className="mt-0.5 truncate text-[var(--text-caption-size)] text-muted-foreground" title={externalChange.paths.join(", ")}>
                  {externalChange.paths.length === 1
                    ? externalChange.paths[0]
                    : `${formatCount(externalChange.paths.length)} files changed`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => void refreshFromDisk()}>
                  Refresh
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExternalChange(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          {!detail ? (
            <div className="mx-auto w-full max-w-[760px] animate-pulse rounded-[var(--corner-xl)] bg-[var(--manuscript-bg)] p-14 shadow-[var(--elevation-2)]">
              <div className="h-6 w-1/3 rounded bg-[var(--secondary)]" />
              <div className="mt-10 space-y-3">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className="h-4 rounded bg-[var(--secondary)]" style={{ width: `${88 - n * 6}%` }} />
                ))}
              </div>
            </div>
          ) : selected ? (
            <ManuscriptEditor
              key={`${selected.id}:${reloadKey}`}
              ref={editorRef}
              bookId={bookId}
              chapter={selected}
              ordinal={ordinal}
              onSaved={onSaved}
              onStatus={setStatus}
              illustration={illustration}
              illustrationData={illustrationData}
            />
          ) : (
            <div className="glass mx-auto mt-10 max-w-[520px] rounded-[var(--corner-xl)] px-8 py-12 text-center">
              <h2 className="text-[var(--text-title-3-size)] font-semibold">An empty book</h2>
              <p className="mx-auto mt-2 max-w-[34ch] text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
                Add the first chapter and start writing. Each chapter is its own file in your library.
              </p>
              <Button variant="primary" className="mt-5" onClick={() => void addChapter()}>
                <Plus size={15} />
                Add chapter
              </Button>
            </div>
          )}
        </section>

        {chatOpen ? (
          <ChatPanel
            className="chat-sheet"
            bookId={bookId}
            chapterId={selectedId}
            onClose={() => setChatOpen(false)}
            onBeforeSend={async () => {
              await editorRef.current?.flush();
            }}
            onReconnect={() => openSettings("providers")}
            onChooseModel={() => openModelPicker("book")}
            onChooseTurnModel={() => openModelPicker("turn")}
            turnModel={turnModel}
            onTurnModelUsed={() => setTurnModel(null)}
            onChanged={async () => {
              setReloadKey((key) => key + 1);
              await load(selectedId ?? undefined);
            }}
            onNotice={onNotice}
          />
        ) : null}
      </main>

      <nav
        className="glass mx-3 mb-3 flex items-center justify-around gap-2 rounded-[var(--corner-xl)] px-1.5 py-1.5 min-[700px]:hidden"
        aria-label="Workspace actions"
      >
        <MobileTab icon={List} label="Chapters" testid="mobile-chapters" onClick={() => setRailOpen(true)} />
        <MobileTab icon={Search} label="Search" testid="mobile-search" onClick={() => setSearchOpen(true)} />
        <MobileTab icon={MessageSquare} label="Agent" testid="mobile-agent" active={chatOpen} onClick={() => setChatOpen((open) => !open)} />
        <MobileTab icon={MoreHorizontal} label="More" testid="mobile-more" onClick={() => setMoreOpen(true)} />
      </nav>

      {detail ? (
        <ModelPickerDialog
          open={modelOpen}
          book={detail.book}
          initial={modelMode === "turn" ? turnModel : null}
          onPick={modelMode === "turn" ? (choice) => setTurnModel(choice) : undefined}
          onSaved={
            modelMode === "book"
              ? (book) => {
                  setTurnModel(null);
                  setDetail((current) => (current ? { ...current, book } : current));
                }
              : undefined
          }
          onClose={() => setModelOpen(false)}
        />
      ) : null}

      {detail ? (
        <>
          <SearchDialog
            open={searchOpen}
            bookId={bookId}
            onClose={() => setSearchOpen(false)}
            onOpenChapter={(chapterId) => {
              setSelectedId(chapterId);
              setSearchOpen(false);
            }}
          />
          <StoryBibleDialog
            open={bibleOpen}
            book={detail.book}
            onClose={() => setBibleOpen(false)}
            onSaved={(book) => setDetail((current) => (current ? { ...current, book } : current))}
            onNotice={onNotice}
          />
        </>
      ) : null}

      <IllustrationDialog
        open={illustrationOpen}
        bookId={bookId}
        chapter={selected}
        characters={detail?.book.characters ?? []}
        onClose={() => setIllustrationOpen(false)}
        onChanged={() => loadIllustration(selectedId)}
        onOpenSettings={() => openSettings("providers")}
      />

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More" description="Book tools, settings, and appearance.">
          <div className="grid gap-1">
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-settings"
              onClick={() => {
                setMoreOpen(false);
                openSettings();
              }}
            >
              <Settings2 size={16} />
              Settings
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-story-bible"
              onClick={() => {
                setMoreOpen(false);
                setBibleOpen(true);
              }}
            >
              <BookOpen size={16} />
              Story Bible
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-illustration"
              onClick={() => {
                setMoreOpen(false);
                setIllustrationOpen(true);
              }}
            >
              <ImageIcon size={16} />
              Illustration
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-search"
              onClick={() => {
                setMoreOpen(false);
                setSearchOpen(true);
              }}
            >
              <Search size={16} />
              Search the book
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              disabled={exporting}
              data-testid="more-export"
              onClick={() => {
                setMoreOpen(false);
                void exportDocx();
              }}
            >
              <Download size={16} />
              Export manuscript
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-model-picker"
              onClick={() => {
                setMoreOpen(false);
                openModelPicker("book");
              }}
            >
              <Cpu size={16} />
              Choose a model
            </Button>
            <Button variant="ghost" className="justify-start" onClick={theme.cycle}>
              {theme.choice === "light" ? <Sun size={16} /> : theme.choice === "dark" ? <Moon size={16} /> : <Monitor size={16} />}
              Theme: {theme.choice}
            </Button>
            <Button
              variant="ghost"
              className="justify-start"
              data-testid="more-back"
              onClick={() => {
                setMoreOpen(false);
                onBack();
              }}
            >
              <ChevronLeft size={16} />
              Back to library
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        onNotice={onNotice}
        theme={theme}
        libraryRoot={libraryRoot}
        storage={libraryStorage}
        section={settingsSection}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}>
        <DialogContent
          title="Delete this chapter?"
          description="The chapter file moves to the library's trash folder. You can bring it back by moving it into the chapters folder again."
        >
          <p className="rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-[var(--text-subheadline-size)]">
            {pendingDelete?.title || "Untitled chapter"}
            <span className="tabular text-muted-foreground"> · {formatWords(pendingDelete?.wordCount ?? 0)}</span>
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Keep chapter
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirmDelete()}>
              Delete chapter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MobileTab({
  icon: Icon,
  label,
  onClick,
  active = false,
  testid
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testid}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[var(--corner-md)] px-1 py-1.5 text-[10px] font-medium transition-colors duration-[var(--duration-fast)] ${
        active ? "bg-[var(--rail-item-selected)] text-[var(--primary)]" : "text-muted-foreground hover:bg-[var(--accent)]"
      }`}
    >
      <Icon size={19} />
      <span className="truncate">{label}</span>
    </button>
  );
}
