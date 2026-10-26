import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, Download, FolderOpen, FolderSearch, Monitor, Moon, MoreHorizontal, Plus, Settings2, Sun, Upload } from "lucide-react";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type { BookSummary } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Wordmark } from "@ai-book-studio/ui/brand";
import { NewBookDialog } from "../components/NewBookDialog";
import { BookActionsDialog } from "../components/BookActionsDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { formatCount, formatWords, must } from "../lib/utils";
import type { ThemeChoice } from "../hooks/use-theme";

interface Props {
  library: LibraryInfo;
  theme: { choice: ThemeChoice; set: (choice: ThemeChoice) => void; cycle: () => void };
  onOpenBook: (bookId: string) => void;
  onChooseLibrary: () => void | Promise<void>;
  onLibraryImported: (library: LibraryInfo) => void;
  onNotice: (error: unknown) => void;
}

export function LibraryView({ library, theme, onOpenBook, onChooseLibrary, onLibraryImported, onNotice }: Props) {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [managed, setManaged] = useState<BookSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [archiving, setArchiving] = useState<"export" | "import" | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const isMac = window.studio.platform === "darwin";
  const isWeb = window.studio.platform === "web";
  const canChooseFolder = !isWeb || "showDirectoryPicker" in window;

  const refresh = useCallback(async () => {
    try {
      setBooks(await must(window.studio.books.list()));
    } catch (error) {
      onNotice(error);
      setBooks([]);
    }
  }, [onNotice]);

  useEffect(() => {
    void refresh();
  }, [library.root, refresh]);

  const importBackup = async (): Promise<void> => {
    if (importing) return;
    setImporting(true);
    try {
      const report = await must(window.studio.library.importLegacy());
      if (!report) return;
      const chapters = report.books.reduce((sum, book) => sum + book.chapters, 0);
      setImportNote(
        `Imported ${report.imported} ${report.imported === 1 ? "book" : "books"} and ${chapters} ${chapters === 1 ? "chapter" : "chapters"}.`
      );
      await refresh();
    } catch (error) {
      onNotice(error);
    } finally {
      setImporting(false);
    }
  };

  const exportArchive = async (): Promise<void> => {
    if (archiving) return;
    setArchiving("export");
    try {
      const summary = await must(window.studio.library.exportArchive());
      if (!summary) return;
      setImportNote(
        `Exported ${formatCount(summary.entryCount)} ${summary.entryCount === 1 ? "file" : "files"} to ${summary.path.split("/").pop()}.`
      );
    } catch (error) {
      onNotice(error);
    } finally {
      setArchiving(null);
    }
  };

  const importArchive = async (): Promise<void> => {
    if (archiving) return;
    setArchiving("import");
    try {
      const summary = await must(window.studio.library.importArchive());
      if (!summary) return;
      setImportNote(
        `Imported ${formatCount(summary.bookCount)} ${summary.bookCount === 1 ? "book" : "books"} into ${summary.library.root}.`
      );
      onLibraryImported(summary.library);
    } catch (error) {
      onNotice(error);
    } finally {
      setArchiving(null);
    }
  };

  const reveal = async (): Promise<void> => {
    try {
      await must(window.studio.library.reveal());
    } catch (error) {
      onNotice(error);
    }
  };

  return (
    <div className="window-wash flex h-full flex-col" data-testid="library-view">
      <header className={`titlebar-drag flex h-14 shrink-0 items-center justify-between pr-2 pl-3 min-[700px]:h-16 min-[700px]:pr-4 ${isMac ? "min-[700px]:pl-[92px]" : "min-[700px]:pl-5"}`}>
        <Wordmark subtitle="Library" />
        <div className="titlebar-no-drag flex items-center gap-1.5">
          {importNote ? (
            <span className="hidden max-w-[200px] truncate text-[var(--text-caption-size)] text-muted-foreground min-[700px]:inline" title={importNote}>
              {importNote}
            </span>
          ) : null}
          {isWeb ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void importBackup()}
              disabled={importing}
              data-testid="import-backup"
              aria-label="Import backup"
              title="Import backup"
            >
              <Upload size={15} />
              <span className="hidden min-[520px]:inline">{importing ? "Importing…" : "Import backup"}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            data-testid="open-settings"
          >
            <Settings2 size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={theme.cycle} aria-label={`Theme: ${theme.choice}`} title={`Theme: ${theme.choice}`}>
            {theme.choice === "light" ? <Sun size={16} /> : theme.choice === "dark" ? <Moon size={16} /> : <Monitor size={16} />}
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            <span className="hidden min-[420px]:inline">New book</span>
          </Button>
        </div>
      </header>

      <main className="thin-scroll flex-1 overflow-y-auto px-4 pb-12 min-[700px]:px-6 min-[700px]:pb-14">
        <div className="mx-auto w-full max-w-[1080px]">
          <div className="flex flex-wrap items-end justify-between gap-4 pt-5 pb-5 min-[700px]:pt-6 min-[700px]:pb-6">
            <div className="min-w-0">
              <h1 className="text-[30px] leading-[36px] font-semibold tracking-[-0.4px] min-[700px]:text-[var(--text-large-title-size)] min-[700px]:leading-[var(--text-large-title-leading)]">Library</h1>
              <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[var(--text-subheadline-size)] text-muted-foreground">
                <FolderOpen size={13} className="shrink-0" />
                <span className="min-w-0 max-w-[62ch] truncate font-mono text-[12px]" title={library.root}>
                  {library.root}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isWeb ? null : (
                <Button variant="ghost" size="sm" onClick={() => void reveal()}>
                  <FolderSearch size={14} />
                  Show files
                </Button>
              )}
              {canChooseFolder ? (
                <Button variant="ghost" size="sm" onClick={() => void onChooseLibrary()}>
                  Change folder…
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void exportArchive()}
                disabled={archiving !== null}
                data-testid="export-archive"
                aria-label="Export library archive"
                title="Export library archive"
              >
                <Download size={14} />
                <span className="hidden min-[520px]:inline">{archiving === "export" ? "Exporting…" : "Export archive…"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void importArchive()}
                disabled={archiving !== null}
                data-testid="import-archive"
                aria-label="Import library archive"
                title="Import library archive"
              >
                <ArchiveRestore size={14} />
                <span className="hidden min-[520px]:inline">{archiving === "import" ? "Importing…" : "Import archive…"}</span>
              </Button>
            </div>
          </div>

          {books === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4" aria-hidden>
              {[0, 1, 2].map((n) => (
                <div key={n} className="glass h-[164px] animate-pulse rounded-[var(--corner-lg)] opacity-60" />
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="glass mt-10 rounded-[var(--corner-xl)] px-8 py-14 text-center">
              <h2 className="text-[var(--text-title-3-size)] font-semibold">No books yet</h2>
              <p className="mx-auto mt-2 max-w-[38ch] text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
                Start with a title and a one-line idea. You can change both later, or replace them as the story takes shape.
              </p>
              <Button variant="primary" className="mt-5" onClick={() => setCreating(true)}>
                <Plus size={15} />
                New book
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {books.map((book) => (
                <li key={book.id} className="relative">
                  <button
                    type="button"
                    data-testid="book-card"
                    onClick={() => onOpenBook(book.id)}
                    className="glass group h-full w-full rounded-[var(--corner-lg)] p-5 pr-12 text-left transition-[box-shadow,background-color,transform] duration-[var(--duration-fast)] hover:brightness-[1.02] focus-visible:outline-2"
                  >
                    <h2 className="line-clamp-2 text-[var(--text-title-3-size)] leading-[var(--text-title-3-leading)] font-semibold tracking-[-0.2px]">
                      {book.title || "Untitled book"}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 min-h-[2.9em] text-[var(--text-subheadline-size)] leading-[var(--text-subheadline-leading)] text-muted-foreground">
                      {book.description || "No description yet."}
                    </p>
                    <p className="tabular mt-4 text-[var(--text-caption-size)] text-muted-foreground">
                      {formatCount(book.chapterCount)} {book.chapterCount === 1 ? "chapter" : "chapters"}
                      <span className="mx-1.5 opacity-50">·</span>
                      {formatWords(book.wordCount)}
                      <span className="mx-1.5 opacity-50">·</span>
                      <span className="hidden min-[420px]:inline">{book.stage === "drafting" ? "Drafting" : "Setting up"}</span>
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-2.5 right-2.5 text-muted-foreground"
                    aria-label={`Settings for ${book.title || "this book"}`}
                    title="Book settings"
                    data-testid="book-actions"
                    onClick={() => setManaged(book)}
                  >
                    <MoreHorizontal size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-10 text-[var(--text-caption-size)] leading-[var(--text-caption-leading)] text-muted-foreground">
            Each book is a folder: <span className="font-mono">book.json</span> for the idea and cast,{" "}
            <span className="font-mono">chapters/*.md</span> for the prose. Open them in any editor; the studio will pick up
            the change.
          </p>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onNotice={onNotice}
        theme={theme}
        libraryRoot={library.root}
        storage={library.storage}
      />

      <BookActionsDialog
        book={managed}
        onOpenChange={(open) => {
          if (!open) setManaged(null);
        }}
        onSaved={(updated) => {
          setBooks((current) =>
            current
              ? current.map((item) =>
                  item.id === updated.id ? { ...item, title: updated.title, description: updated.description } : item
                )
              : current
          );
        }}
        onDeleted={(bookId) => {
          setBooks((current) => (current ? current.filter((item) => item.id !== bookId) : current));
        }}
        onNotice={onNotice}
      />

      <NewBookDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (bookId) => {
          setCreating(false);
          await refresh();
          onOpenBook(bookId);
        }}
        onNotice={onNotice}
      />
    </div>
  );
}
