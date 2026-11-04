import { FolderOpen } from "lucide-react";
import { Button } from "@ai-book-studio/ui/button";
import { Wordmark } from "@ai-book-studio/ui/brand";

export function WelcomeView({ onChooseLibrary }: { onChooseLibrary: () => void | Promise<void> }) {
  const isMac = window.studio.platform === "darwin";

  return (
    <div className="window-wash flex h-full flex-col" data-testid="welcome-view">
      <header className={`titlebar-drag flex h-16 shrink-0 items-center ${isMac ? "pl-[92px]" : "pl-5"}`}>
        <Wordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[560px]">
          <div className="glass-strong rounded-[var(--corner-xl)] p-8">
            <h1 className="text-(length:--text-title-1-size) leading-[var(--text-title-1-leading)] font-semibold tracking-[-0.3px]">
              A quiet place to write a book.
            </h1>
            <p className="mt-3 max-w-[44ch] text-(length:--text-body-size) leading-[var(--text-body-leading)] text-muted-foreground">
              Your manuscript lives in a folder you choose. Point the studio at a folder in iCloud Drive, Google Drive, or
              anywhere on this computer. Every chapter is a file you can open, copy, or sync.
            </p>

            <div className="mt-6 flex items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => void onChooseLibrary()}>
                <FolderOpen size={16} />
                Choose a library folder
              </Button>
            </div>

            <p className="mt-4 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
              Already have a library? Choose that folder. Nothing is imported, moved, or rewritten.
            </p>
          </div>

          <p className="mt-5 px-2 text-(length:--text-caption-size) leading-[var(--text-caption-leading)] text-muted-foreground">
            We never see your manuscript. There is no account, no server, and no sync of our own.
          </p>
        </div>
      </main>
    </div>
  );
}
