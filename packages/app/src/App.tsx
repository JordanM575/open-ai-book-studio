import { useCallback, useEffect, useState } from "react";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import type { DriftEntry, DriftReport } from "@ai-book-studio/core/sync/types";
import { must } from "./lib/utils";
import { useTheme } from "./hooks/use-theme";
import { LibraryView } from "./views/LibraryView";
import { WorkspaceView, type ChapterRequest, type ConversationRequest } from "./views/WorkspaceView";
import { WelcomeView } from "./views/WelcomeView";
import { Notice } from "@ai-book-studio/ui/notice";
import { DriftReportDialog, type DriftReviewTarget } from "./components/DriftReportDialog";
import { SchemaRefusalDialog } from "./components/SchemaRefusalDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";

type Screen = { kind: "library" } | { kind: "workspace"; bookId: string };

export default function App() {
  return (
    <ErrorBoundary>
      <Studio />
    </ErrorBoundary>
  );
}

function Studio() {
  const theme = useTheme();
  const [library, setLibrary] = useState<LibraryInfo | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>({ kind: "library" });
  const [notice, setNotice] = useState<string | null>(null);
  const [schemaRefusal, setSchemaRefusal] = useState<{ detectedSchema: number | null } | null>(null);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftBusy, setDriftBusy] = useState(false);
  const [chapterRequest, setChapterRequest] = useState<ChapterRequest | null>(null);
  const [conversationRequest, setConversationRequest] = useState<ConversationRequest | null>(null);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});

  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);

  const openDriftReport = useCallback((next: DriftReport | null) => {
    if (!next || next.clean) return;
    setDrift(next);
    void (async () => {
      try {
        const books = await must(window.studio.books.list());
        const titles: Record<string, string> = {};
        for (const book of books) titles[book.id] = book.title;
        setBookTitles(titles);
      } catch {
        // Titles are a courtesy; paths still identify every entry.
      }
    })();
  }, []);

  useEffect(
    () =>
      window.studio.sync.onDrift(({ report: pushed }) => {
        openDriftReport(pushed);
      }),
    [openDriftReport]
  );

  const runDriftCheck = useCallback(async () => {
    try {
      openDriftReport(await must(window.studio.sync.check()));
    } catch (error) {
      report(error);
    }
  }, [openDriftReport, report]);

  useEffect(() => {
    if (library) void runDriftCheck();
  }, [library, runDriftCheck]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const info = await must(window.studio.library.current());
        if (alive) setLibrary(info);
      } catch (error) {
        if (alive) {
          setLibrary(null);
          report(error);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [report]);

  const chooseLibrary = useCallback(async () => {
    try {
      const info = await must(window.studio.library.choose());
      if (info) {
        setLibrary(info);
        setScreen({ kind: "library" });
      }
    } catch (error) {
      report(error);
    }
  }, [report]);

  useEffect(() => window.studio.menu.onOpenLibrary(() => void chooseLibrary()), [chooseLibrary]);

  useEffect(
    () =>
      window.studio.app.onSecondInstance(() => {
        setNotice("AI Book Studio is already open. The second copy closed without opening your library.");
      }),
    []
  );

  // A window made after a background turn opens on the conversation the turn ended in.
  useEffect(
    () =>
      window.studio.app.onOpenConversation(({ bookId, threadId }) => {
        setScreen({ kind: "workspace", bookId });
        setConversationRequest({ bookId, threadId, nonce: Date.now() });
      }),
    []
  );

  const reviewDriftTarget = useCallback(
    (target: DriftReviewTarget, revert: boolean) => {
      setScreen({ kind: "workspace", bookId: target.bookId });
      setChapterRequest({ ...target, nonce: Date.now(), revert });
      setDrift(null);
    },
    []
  );

  const refreshDrift = useCallback(
    async (paths: string[]) => {
      const fresh = await must(window.studio.sync.accept(paths));
      if (fresh) setDrift(fresh.clean ? null : fresh);
    },
    []
  );

  const keepDriftDisk = useCallback(
    async (entry: DriftEntry) => {
      setDriftBusy(true);
      try {
        if (entry.kind === "both-changed" && entry.bookId && entry.chapterId) {
          await must(window.studio.sync.accept([entry.path]));
          await must(window.studio.sync.discardDraft(entry.bookId, entry.chapterId));
          reviewDriftTarget({ bookId: entry.bookId, chapterId: entry.chapterId }, true);
          return;
        }
        await refreshDrift([entry.path]);
      } catch (error) {
        report(error);
      } finally {
        setDriftBusy(false);
      }
    },
    [refreshDrift, reviewDriftTarget, report]
  );

  const keepDriftMine = useCallback(
    async (entry: DriftEntry) => {
      if (!entry.bookId || !entry.chapterId) return;
      const { bookId, chapterId } = entry;
      setDriftBusy(true);
      try {
        const result = await must(window.studio.sync.keepMine(bookId, chapterId));
        await refreshDrift([entry.path]);
        if (!result) {
          report(new Error("Nothing unsent was left to keep."));
          return;
        }
        if (result.status === "conflict") {
          setNotice("Kept as a conflict copy — both versions are safe.");
          reviewDriftTarget({ bookId, chapterId }, false);
        }
      } catch (error) {
        report(error);
      } finally {
        setDriftBusy(false);
      }
    },
    [refreshDrift, reviewDriftTarget, report]
  );

  const openDriftBoth = useCallback(
    async (entry: DriftEntry) => {
      setDriftBusy(true);
      try {
        const bookId = entry.bookId ?? /^books\/([^/]+)\//.exec(entry.path)?.[1] ?? null;
        if (!bookId) return;
        let chapterId = entry.chapterId ?? undefined;
        if (!chapterId || entry.kind === "conflict-copy") {
          try {
            const copies = await must(window.studio.conflicts.list(bookId));
            const match =
              copies.find((copy) => copy.savedAs === entry.path) ??
              (entry.chapterId ? copies.find((copy) => copy.chapterId === entry.chapterId) : undefined);
            if (match) chapterId = match.chapterId;
          } catch {
            // Fall through to the book; the rail lists whatever the app preserved.
          }
        }
        reviewDriftTarget(chapterId ? { bookId, chapterId } : { bookId }, false);
      } finally {
        setDriftBusy(false);
      }
    },
    [reviewDriftTarget]
  );

  const exportDriftLibrary = useCallback(async () => {
    setDriftBusy(true);
    try {
      const summary = await must(window.studio.library.exportArchive());
      if (summary) setNotice(`Exported the library to ${summary.path.split("/").pop()}.`);
    } catch (error) {
      report(error);
    } finally {
      setDriftBusy(false);
    }
  }, [report]);

  const checkForChanges = useCallback(async () => {
    const fresh = await must(window.studio.sync.check());
    if (fresh && !fresh.clean) {
      openDriftReport(fresh);
      return { dirty: true };
    }
    return { dirty: false };
  }, [openDriftReport]);

  if (library === undefined) {
    return (
      <div className="window-wash flex h-full items-center justify-center">
        <p className="text-(length:--text-subheadline-size) text-muted-foreground">Opening your library…</p>
      </div>
    );
  }

  return (
    <>
      {library === null ? (
        <WelcomeView onChooseLibrary={chooseLibrary} />
      ) : screen.kind === "workspace" ? (
        <WorkspaceView
          bookId={screen.bookId}
          theme={theme}
          libraryRoot={library.root}
          libraryStorage={library.storage}
          deviceName={library.deviceName}
          chapterRequest={chapterRequest}
          onChapterRequestHandled={() => setChapterRequest(null)}
          conversationRequest={conversationRequest}
          onConversationRequestHandled={() => setConversationRequest(null)}
          onCheckForChanges={checkForChanges}
          onBack={() => setScreen({ kind: "library" })}
          onNotice={report}
          onSchemaRefusal={(refusal) => setSchemaRefusal(refusal)}
        />
      ) : (
        <LibraryView
          library={library}
          theme={theme}
          onOpenBook={(bookId) => setScreen({ kind: "workspace", bookId })}
          onChooseLibrary={chooseLibrary}
          onLibraryImported={(info) => {
            setLibrary(info);
            setScreen({ kind: "library" });
          }}
          onNotice={report}
        />
      )}
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {drift ? (
        <DriftReportDialog
          open
          report={drift}
          busy={driftBusy}
          bookTitles={bookTitles}
          onReview={(target) => reviewDriftTarget(target, false)}
          onKeepDisk={(entry) => void keepDriftDisk(entry)}
          onKeepMine={(entry) => void keepDriftMine(entry)}
          onOpenBoth={(entry) => void openDriftBoth(entry)}
          onExportLibrary={() => void exportDriftLibrary()}
          onClose={() => setDrift(null)}
        />
      ) : null}
      {schemaRefusal ? (
        <SchemaRefusalDialog
          detectedSchema={schemaRefusal.detectedSchema}
          onBack={() => {
            setSchemaRefusal(null);
            setScreen({ kind: "library" });
          }}
        />
      ) : null}
    </>
  );
}
