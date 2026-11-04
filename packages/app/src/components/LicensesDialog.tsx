import { type KeyboardEvent, type MouseEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { licenseLabel, type LicenseReport } from "@ai-book-studio/core/licenses";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@ai-book-studio/ui/dialog";
import { cn, must } from "../lib/utils";

/** One row of the list: the studio itself first, then each package the build ships. */
interface Entry {
  key: string;
  name: string;
  version: string;
  license: string;
  link: string | null;
  author: string | null;
  texts: Array<{ file: string; text: string }>;
  notes: string[];
}

const STUDIO = "studio";

function entriesOf(report: LicenseReport): Entry[] {
  const studio: Entry = {
    key: STUDIO,
    name: report.project.name,
    version: report.project.version,
    license: report.project.license ?? "No license declared",
    link: null,
    author: null,
    texts: report.project.texts,
    notes: []
  };
  const packages = report.packages.map(
    (pkg): Entry => ({
      key: `${pkg.name}@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
      license: licenseLabel(pkg),
      link: pkg.repository ?? pkg.homepage,
      author: pkg.author,
      texts: pkg.texts,
      notes: [pkg.exception ? `Allowed exception: ${pkg.exception.reason}` : null, pkg.note].filter(
        (note): note is string => note !== null
      )
    })
  );
  return [studio, ...packages];
}

function matching(packages: Entry[], query: string): Entry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return packages;
  return packages.filter((entry) => entry.name.toLowerCase().includes(needle) || entry.license.toLowerCase().includes(needle));
}

const STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  PageDown: (index, last) => Math.min(index + 10, last),
  PageUp: (index) => Math.max(index - 10, 0),
  Home: () => 0,
  End: (_index, last) => last
};

function LicenseText({ entry, headingId }: { entry: Entry; headingId: string }) {
  return (
    <>
      <h3 id={headingId} className="text-(length:--text-callout-size) leading-[var(--text-callout-leading)] font-medium break-words">
        {entry.name}
      </h3>
      <p className="tabular mt-0.5 text-(length:--text-caption-size) text-muted-foreground">
        {entry.version} · {entry.license}
        {entry.author ? ` · ${entry.author}` : ""}
      </p>
      {entry.link ? (
        <p className="mt-1 truncate text-(length:--text-caption-size)">
          <a href={entry.link} target="_blank" rel="noreferrer" className="text-[var(--primary)] underline-offset-2 hover:underline">
            {entry.link.replace(/^https?:\/\//, "")}
          </a>
        </p>
      ) : null}
      {entry.notes.map((note) => (
        <p
          key={note}
          className="mt-3 rounded-[var(--corner-md)] bg-[var(--secondary)] px-3 py-2 text-(length:--text-caption-size) leading-[var(--text-caption-leading)] text-muted-foreground"
        >
          {note}
        </p>
      ))}
      {entry.texts.length === 0 ? (
        <p className="mt-3 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-muted-foreground">
          This package ships no license file of its own. It declares {entry.license}.
        </p>
      ) : (
        entry.texts.map((text) => (
          <section key={text.file} className="mt-4">
            <h4 className="text-(length:--text-caption-size) font-medium text-muted-foreground">{text.file}</h4>
            <pre className="mt-1 font-mono text-(length:--text-caption-size) leading-[var(--text-caption-leading)] break-words whitespace-pre-wrap">
              {text.text}
            </pre>
          </section>
        ))
      )}
    </>
  );
}

function LicensesBody({ searchRef }: { searchRef: RefObject<HTMLInputElement | null> }) {
  const [report, setReport] = useState<LicenseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(STUDIO);
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement>(null);
  const id = useId();

  // The list is read when this view opens, not when Settings does.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const next = await must(window.studio.app.licenses());
        if (live) setReport(next);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "The list of open-source licenses could not be read.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const all = useMemo(() => (report ? entriesOf(report) : []), [report]);
  const indexOf = useMemo(() => new Map(all.map((entry, index) => [entry.key, index])), [all]);
  const studio = all[0];
  const packages = all.slice(1);
  const matches = matching(packages, query);
  const visible = studio ? [studio, ...matches] : [];
  const current = all[indexOf.get(selected) ?? 0];
  const optionId = (key: string): string => `${id}-option-${indexOf.get(key) ?? 0}`;
  const listId = `${id}-list`;
  const headingId = `${id}-heading`;

  useEffect(() => {
    if (!current) return;
    document.getElementById(`${id}-option-${indexOf.get(current.key) ?? 0}`)?.scrollIntoView?.({ block: "nearest" });
    if (textRef.current) textRef.current.scrollTop = 0;
  }, [current, id, indexOf]);

  const search = (value: string): void => {
    setQuery(value);
    // A selected package the search hides gives way to the first match, so the text follows the list.
    const next = matching(packages, value);
    const first = next[0];
    if (selected !== STUDIO && first && !next.some((entry) => entry.key === selected)) setSelected(first.key);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const index = visible.findIndex((entry) => entry.key === selected);
    const target = visible[index < 0 ? 0 : step(index, visible.length - 1)];
    if (target) setSelected(target.key);
  };

  const onListClick = (event: MouseEvent<HTMLDivElement>): void => {
    const option = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
    const key = option?.dataset.key;
    if (key) setSelected(key);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    listRef.current?.focus();
  };

  const selectedVisible = visible.some((entry) => entry.key === selected);

  return (
    <div className="flex h-[min(34rem,calc(100dvh-15rem))] min-h-[18rem] flex-col gap-3">
      <div className="relative shrink-0">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search packages"
          aria-label="Search packages"
          aria-controls={report ? listId : undefined}
          data-testid="licenses-search"
          className="w-full rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] py-2 pr-3 pl-9 text-(length:--text-subheadline-size) outline-none focus-visible:border-[var(--ring)]"
        />
      </div>
      {error ? (
        <p role="alert" className="text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] text-[var(--destructive-text)]">
          {error}
        </p>
      ) : null}
      {!report && !error ? (
        <p className="flex items-center gap-2 text-(length:--text-subheadline-size) text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Reading the license list…
        </p>
      ) : null}
      {report && current ? (
        <>
          <p className="tabular shrink-0 text-(length:--text-caption-size) text-muted-foreground" aria-live="polite" data-testid="licenses-count">
            {query.trim()
              ? matches.length === 0
                ? `No packages match “${query.trim()}”`
                : `${matches.length} of ${packages.length} packages`
              : `${packages.length} ${packages.length === 1 ? "package" : "packages"}`}
          </p>
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:grid-rows-1">
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={0}
              aria-label="Packages"
              aria-activedescendant={selectedVisible ? optionId(selected) : undefined}
              onKeyDown={onListKeyDown}
              onClick={onListClick}
              data-testid="licenses-list"
              className="thin-scroll min-h-0 overflow-y-auto rounded-[var(--corner-lg)] border border-[var(--border)] p-1"
            >
              {visible.map((entry) => (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox, which points at this option with aria-activedescendant
                <div
                  key={entry.key}
                  id={optionId(entry.key)}
                  role="option"
                  aria-selected={entry.key === selected}
                  data-key={entry.key}
                  data-package={entry.key === STUDIO ? undefined : entry.name}
                  data-testid="licenses-option"
                  className={cn(
                    "rounded-[var(--corner-sm)] px-2.5 py-1.5 transition-colors duration-[var(--duration-fast)]",
                    entry.key === selected ? "bg-[var(--rail-item-selected)]" : "hover:bg-[var(--accent)]"
                  )}
                >
                  <span className="block truncate text-(length:--text-subheadline-size) font-medium">{entry.name}</span>
                  <span className="tabular block truncate text-(length:--text-caption-size) text-muted-foreground">
                    {entry.version} · {entry.license}
                  </span>
                </div>
              ))}
            </div>
            <section
              ref={textRef}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the text scrolls on its own, so it takes focus for the keyboard to scroll it
              tabIndex={0}
              aria-labelledby={headingId}
              data-testid="licenses-text"
              className="thin-scroll min-h-0 overflow-y-auto rounded-[var(--corner-lg)] border border-[var(--border)] p-3"
            >
              <LicenseText entry={current} headingId={headingId} />
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Settings → About → Open-source licenses (D-186).
 *
 * The studio's own license and notice come first, then every package this build ships, from the list
 * the build generated. Search narrows the list and selecting a package shows its license text. The
 * list is one listbox: the arrow keys, Page Up, Page Down, Home and End move the selection and the
 * text follows it. Closing the view returns focus to the button that opened it.
 */
export function OpenSourceLicenses() {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="show-licenses">
          Show open-source licenses
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Open-source licenses"
        description="AI Book Studio and the open-source packages this build ships. Select one to read its license."
        className="w-[calc(100vw-48px)] max-w-[880px]"
        data-testid="licenses-dialog"
        onOpenAutoFocus={(event) => {
          // Start in the search field rather than on the close button.
          event.preventDefault();
          searchRef.current?.focus();
        }}
        footer={
          <DialogFooter className="mt-0">
            <DialogClose asChild>
              <Button variant="secondary">Done</Button>
            </DialogClose>
          </DialogFooter>
        }
      >
        <LicensesBody searchRef={searchRef} />
      </DialogContent>
    </Dialog>
  );
}
