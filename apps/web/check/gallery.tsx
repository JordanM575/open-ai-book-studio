import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Wordmark } from "@ai-book-studio/ui/brand";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@ai-book-studio/ui/dialog";
import { Notice } from "@ai-book-studio/ui/notice";
import "../src/styles.css";

const requested = new URLSearchParams(window.location.search).get("theme");
document.documentElement.dataset["theme"] = requested === "dark" ? "dark" : "light";

function Section({
  title,
  description,
  children,
  testId
}: {
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      data-testid={testId}
      className="glass rounded-[var(--corner-xl)] p-5"
      aria-labelledby={`${testId}-title`}
    >
      <h2 id={`${testId}-title`} className="text-(length:--text-headline-size) font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-(length:--text-caption-size) text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StorageCard({ kind }: { kind: "browser" | "folder" }) {
  const browser = kind === "browser";
  return (
    <article
      data-testid={browser ? "storage-browser" : "storage-folder"}
      className="rounded-[var(--corner-lg)] border border-[var(--border)] bg-[var(--secondary)] p-4"
    >
      <h3 className="text-(length:--text-subheadline-size) font-semibold">
        {browser ? "Browser storage" : "Folder library"}
      </h3>
      <p className="mt-1 text-(length:--text-caption-size) leading-[var(--text-caption-leading)] text-muted-foreground">
        {browser
          ? "Kept in this browser. The browser can clear it, so export an archive to keep a copy."
          : "A folder the desktop app and other editors can open. Use a folder you can back up."}
      </p>
      <p className="mt-2 text-(length:--text-caption-size) font-medium">
        {browser ? "Less protected · can be cleared" : "Portable · yours to back up"}
      </p>
    </article>
  );
}

function Gallery() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main data-testid="gallery" className="window-wash min-h-dvh px-4 py-6 text-foreground sm:px-6">
      <h1 className="sr-only">Shared UI check</h1>
      <div className="mx-auto w-full max-w-[1120px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1">
          <Wordmark subtitle="Shared UI check" />
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            onClick={() => {
              document.documentElement.dataset["theme"] =
                document.documentElement.dataset["theme"] === "dark" ? "light" : "dark";
            }}
          >
            Toggle theme
          </Button>
        </header>

        <Section
          testId="buttons"
          title="Buttons"
          description="The shared Button, in every variant and size the apps use."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" className="min-h-11">Primary action</Button>
            <Button variant="secondary" size="lg" className="min-h-11">Secondary</Button>
            <Button variant="outline" size="lg" className="min-h-11">Outline</Button>
            <Button variant="ghost" size="lg" className="min-h-11">Ghost</Button>
            <Button variant="danger" size="lg" className="min-h-11">Danger</Button>
            <Button size="lg" className="min-h-11" disabled>Disabled</Button>
          </div>
        </Section>

        <Section
          testId="storage"
          title="Storage disclosure"
          description="The two states the welcome screen explains before an author chooses."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <StorageCard kind="browser" />
            <StorageCard kind="folder" />
          </div>
        </Section>

        <Section
          testId="dialogs"
          title="Dialog and notice"
          description="The shared dialog shell and the transient error notice."
        >
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="lg" className="min-h-11" data-testid="dialog-trigger">
                  Open dialog
                </Button>
              </DialogTrigger>
              <DialogContent
                title="A shared dialog"
                description="The same shell the desktop and web apps use."
                footer={
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button>Save</Button>
                  </DialogFooter>
                }
              >
                <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                  Content sits between the title and the footer, with the close control in the header.
                </p>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="lg"
              className="min-h-11"
              data-testid="notice-trigger"
              onClick={() => setNotice("The library could not be saved. Your text is still here.")}
            >
              Show notice
            </Button>
          </div>
        </Section>

        <p className="px-1 text-(length:--text-caption-size) text-muted-foreground">
          The desktop renderer re-exports these components from <code>@ai-book-studio/ui</code>; this
          page is the web target&apos;s visual check. Storage copy is compared above.
        </p>
      </div>
      <Notice message={notice} onDismiss={() => setNotice(null)} />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<Gallery />);
