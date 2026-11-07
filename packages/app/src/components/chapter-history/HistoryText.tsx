import type { HistoryComparison, StoredHistoryRecord } from "@ai-book-studio/core/library/history";

const proseClass = "mt-2 whitespace-pre-wrap break-words rounded-[var(--corner-md)] border border-border bg-card text-card-foreground p-3 font-mono text-(length:--text-body-size) select-text";

export function HistoryRecordText({ record }: { record: StoredHistoryRecord }) {
  if (record.meta.kind === "intent") {
    return <p>Restore intent · {record.meta.state}. This record has no saved body. Selected snapshot: {record.meta.selected.fileName}. Safety snapshot: {record.meta.safety.fileName}.</p>;
  }
  return <section aria-label="Snapshot body"><pre className={proseClass}>{record.content}</pre></section>;
}

/** A linear, faithful changed-span view; deliberately not a minimal diff. */
export function HistoryComparisonText({ comparison }: { comparison: HistoryComparison }) {
  const left = Array.from(comparison.snapshot.content);
  const right = Array.from(comparison.current.content);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end += 1;
  const body = (text: string[], label: string) => (
    <section aria-label={label}><pre className={proseClass}>
      {text.slice(0, start).join("")}
      {text.length - end > start ? <mark className="bg-accent text-accent-foreground">{text.slice(start, text.length - end).join("")}</mark> : null}
      {end > 0 ? text.slice(text.length - end).join("") : ""}
    </pre></section>
  );
  return (
    <div className="space-y-3">
      <p>{comparison.equal ? "The saved bodies are identical." : "The saved bodies differ. Marked text spans the first through last difference in each body; it may include unchanged text between edits."}</p>
      <section aria-label="Historical saved text">
        <h3 className="font-medium">Snapshot · version {comparison.snapshot.meta.sourceVersion}</h3>
        {body(left, "Snapshot body")}
      </section>
      <section aria-label="Current saved text">
        <h3 className="font-medium">Current saved body · version {comparison.current.version}</h3>
        <p className="break-all text-(length:--text-caption-size) text-muted-foreground">Raw file hash: {comparison.current.hash}</p>
        {body(right, "Current saved body")}
      </section>
    </div>
  );
}
