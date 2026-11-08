import { useEffect, useRef, useState } from "react";
import { planningValue, type PlanningApi } from "@ai-book-studio/core/library/planning-api";
import { inspectPlanningCopy, type PlanningCopyList, type PlanningCopy } from "@ai-book-studio/core/library/planning-recovery";
import { Button } from "@ai-book-studio/ui/button";

export function PlanningCopies({ api, bookId, revision }: { api: PlanningApi; bookId: string; revision: number }) {
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<PlanningCopyList | null>(null);
  const [copy, setCopy] = useState<PlanningCopy | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a completed save/explicit refresh invalidates the copy listing.
  useEffect(() => {
    const token = ++generation.current;
    setCopy(null);
    setList(null);
    setError(false);
    void planningValue(api.listCopies(bookId, offset)).then((value) => {
      if (token === generation.current) setList(value);
    }, () => { if (token === generation.current) setError(true); });
    return () => { generation.current++; };
  }, [api, bookId, offset, revision]);
  const inspect = async (name: string) => {
    const token = ++generation.current;
    setCopy(null);
    setError(false);
    try {
      const value = await planningValue(api.readCopy(bookId, name));
      if (token === generation.current) setCopy(value);
    } catch { if (token === generation.current) setError(true); }
  };
  const inspected = copy ? inspectPlanningCopy(copy) : null;
  return <details className="space-y-2">
    <summary className="min-h-11 cursor-pointer py-2">Planning recovery copies</summary>
    <p>Copies are retained in this book’s conflicts folder and travel in its archive. Inspect a copy, then reopen the goal or world detail editor and manually enter the values you want to recover against the current saved version. Save changes performs a new checked edit; it never replaces the whole file with a copy.</p>
    {error && <p role="alert">The copy or listing could not be verified. Nothing was changed. Refresh to inspect again.</p>}
    {list?.names.length === 0 && <p>No planning recovery copies on this page.</p>}
    <ul>{list?.names.map((name) => <li key={name}><Button variant="ghost" className="max-w-full break-all whitespace-normal" onClick={() => void inspect(name)}>Inspect {name}</Button></li>)}</ul>
    {offset > 0 && <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - 25))}>Previous copies</Button>}
    {list?.nextOffset != null && <Button variant="ghost" onClick={() => { if (list.nextOffset !== null) setOffset(list.nextOffset); }}>Next copies</Button>}
    {copy && <div className="space-y-2">
      <p className="break-all">Verified copy · {copy.name}</p>
      {inspected?.kind === "goals" && <p>Copy target: {inspected.data.targetWords ?? "No goal"}</p>}
      {inspected?.kind === "planning" && inspected.data.worldbuilding.map((record) => <dl key={record.id} className="whitespace-pre-wrap break-words">
        <dt>{record.name} · {record.id}{record.archived ? " · Archived" : ""}</dt>
        <dd>{record.category}</dd><dd>{record.description}</dd><dd>{record.notes}</dd>
      </dl>)}
      <label className="block">Complete read-only copy<textarea readOnly value={copy.rawJson} rows={8} className="w-full font-mono" /></label>
    </div>}
  </details>;
}
