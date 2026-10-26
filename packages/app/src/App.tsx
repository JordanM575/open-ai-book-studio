import { useCallback, useEffect, useState } from "react";
import type { LibraryInfo } from "@ai-book-studio/core/ipc";
import { must } from "./lib/utils";
import { useTheme } from "./hooks/use-theme";
import { LibraryView } from "./views/LibraryView";
import { WorkspaceView } from "./views/WorkspaceView";
import { WelcomeView } from "./views/WelcomeView";
import { Notice } from "@ai-book-studio/ui/notice";

type Screen = { kind: "library" } | { kind: "workspace"; bookId: string };

export default function App() {
  const theme = useTheme();
  const [library, setLibrary] = useState<LibraryInfo | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>({ kind: "library" });
  const [notice, setNotice] = useState<string | null>(null);

  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);

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

  if (library === undefined) {
    return (
      <div className="window-wash flex h-full items-center justify-center">
        <p className="text-[var(--text-subheadline-size)] text-muted-foreground">Opening your library…</p>
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
          onBack={() => setScreen({ kind: "library" })}
          onNotice={report}
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
    </>
  );
}
