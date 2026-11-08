import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanningApi } from "@ai-book-studio/core/library/planning-api";
import { planningValue } from "@ai-book-studio/core/library/planning-api";
import type { Planning } from "@ai-book-studio/core/planning/schema";
import type { Result } from "@ai-book-studio/core/ipc";
import type { SidecarSave } from "@ai-book-studio/core/planning/checked-sidecar";
import { Button } from "@ai-book-studio/ui/button";
import { GoalDialog } from "./GoalDialog";
import { WorldbuildingDialog } from "./WorldbuildingDialog";
import { SavedGoalProgress, type ManuscriptSaveState } from "./SavedGoalProgress";
import type { PlanningNavigation } from "./navigation";
import { PlanningCopies } from "./PlanningCopies";
import type { DraftSaveResult, PlanningView } from "./contracts";

let nextLifetime = 0;
async function saveValue<T>(promise: Promise<Result<SidecarSave<T>>>): Promise<DraftSaveResult<T>> {
  const result = await promise;
  if (!result.ok && result.error.outcome === "refused") return { status: "refused", message: result.error.message };
  return planningValue(Promise.resolve(result));
}

export function PlanningPanel({ bookId, bookTitle, api, navigation, sourceGeneration, manuscriptState }: {
  bookId: string; bookTitle: string; api: PlanningApi | undefined; navigation: PlanningNavigation;
  sourceGeneration: string; manuscriptState: ManuscriptSaveState;
}) {
  const [lifetime] = useState(() => ++nextLifetime);
  const serial = useRef(0);
  const [session, setSession] = useState<(PlanningView & { kind: "goal" | "world"; recordId?: string }) | null>(null);
  const [planning, setPlanning] = useState<Planning | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // API identity is part of the mounted workspace lifetime. The shell resolves navigation first.
  const readProgress = useCallback((id: string) => {
    if (!api) throw new Error("Planning is unavailable on this host.");
    return planningValue(api.progress(id));
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: saved-source and explicit-refresh revisions invalidate this read, independently of the API identity.
  useEffect(() => {
    if (!api) return;
    let current = true;
    setError(null);
    setPlanning(null);
    setLoaded(false);
    void planningValue(api.read(bookId)).then((read) => {
      if (current) { setPlanning(read.data); setLoaded(true); }
    }, () => { if (current) setError("World details could not be read. Refresh to inspect storage again."); });
    return () => { current = false; };
  }, [api, bookId, revision, sourceGeneration]);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const open = (kind: "goal" | "world", recordId?: string) => {
    if (!api) return;
    const view = { bookId, viewGeneration: `${lifetime}:${++serial.current}` };
    if (!navigation.begin(view)) return;
    setSession({ ...view, kind, ...(recordId ? { recordId } : {}) });
  };
  const close = (view: PlanningView) => {
    if (!navigation.close(view)) throw new Error("The planning session changed.");
    setSession(null);
    setRevision((value) => value + 1);
  };
  return <section aria-label="Book planning" className="glass mb-4 rounded-[var(--corner-lg)] p-3 space-y-3 [&_button]:min-h-11 [&_button]:min-w-11">
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={!api} onClick={() => open("goal")}>Set saved-word goal</Button>
      <Button variant="secondary" disabled={!api} onClick={() => setExpanded((value) => !value)}>World details</Button>
      <Button variant="ghost" disabled={!api} onClick={() => setRevision((value) => value + 1)}>Refresh planning</Button>
    </div>
    {!api ? <p>Planning is unavailable on this host.</p> : <SavedGoalProgress bookId={bookId} viewGeneration={lifetime}
      sourceGeneration={`${sourceGeneration}:${revision}`} manuscriptState={manuscriptState} readProgress={readProgress} />}
    {expanded && <div className="space-y-2">
      <h2 className="font-semibold">World details · {bookTitle}</h2>
      {error ? <p role="alert">{error}</p> : !loaded ? <p>Reading saved world details…</p> : <>
        {!planning?.worldbuilding.some((record) => !record.archived) && <p>No world details yet. Add a place, custom or other detail.</p>}
        <ul>{planning?.worldbuilding.filter((record) => !record.archived).map((record) => <li key={record.id}>
          <Button variant="ghost" onClick={() => open("world", record.id)}>{record.name}</Button>
        </li>)}</ul>
        <Button variant="secondary" onClick={() => open("world")}>New world detail</Button>
      </>}
    </div>}
    {api && <PlanningCopies api={api} bookId={bookId} revision={revision} />}
    {session && api && (session.kind === "goal" ? <GoalDialog open {...session} bookTitle={bookTitle}
      read={(id) => planningValue(api.readGoal(id))} save={(request) => saveValue(api.saveGoal(request)).finally(() => setRevision((value) => value + 1))}
      readProgress={readProgress} sourceGeneration={`${sourceGeneration}:${revision}`} manuscriptState={manuscriptState}
      onClose={close} onSessionState={(view, state) => navigation.register(view, state)} onResult={() => setRevision((value) => value + 1)} />
      : <WorldbuildingDialog open {...session} bookTitle={bookTitle}
        read={(id) => planningValue(api.read(id))} save={(request) => saveValue(api.save(request)).finally(() => setRevision((value) => value + 1))}
        onClose={close} onSessionState={(view, state) => navigation.register(view, state)} onResult={() => setRevision((value) => value + 1)} />)}
  </section>;
}
