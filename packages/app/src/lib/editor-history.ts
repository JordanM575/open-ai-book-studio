/**
 * Per-chapter text history for the manuscript editor.
 *
 * The textarea's native undo stack dies when the editor remounts for another chapter. This small
 * store keeps the last hundred text states per chapter, coalesces a typing burst into one undo step,
 * and is intentionally in memory: a relaunch starts a fresh session.
 */
export interface EditorHistory {
  undo: string[];
  redo: string[];
  lastPushAt: number;
}

const LIMIT = 100;
const histories = new Map<string, EditorHistory>();

export function historyFor(chapterId: string): EditorHistory {
  let history = histories.get(chapterId);
  if (!history) {
    history = { undo: [], redo: [], lastPushAt: 0 };
    histories.set(chapterId, history);
  }
  return history;
}

/**
 * Record the text before a change. A burst of typing inside half a second is one undo step; a
 * paste, a large deletion or a pause starts a new one.
 */
export function pushHistory(chapterId: string, previous: string, now: number, largeChange: boolean): void {
  const history = historyFor(chapterId);
  if (history.undo.at(-1) === previous) return;
  if (!largeChange && now - history.lastPushAt <= 500) return;

  history.undo.push(previous);
  if (history.undo.length > LIMIT) history.undo.shift();
  history.redo.length = 0;
  history.lastPushAt = now;
}

export function undoHistory(chapterId: string, current: string): string | null {
  const history = historyFor(chapterId);
  const previous = history.undo.pop();
  if (previous === undefined) return null;

  history.redo.push(current);
  if (history.redo.length > LIMIT) history.redo.shift();
  history.lastPushAt = 0;
  return previous;
}

export function redoHistory(chapterId: string, current: string): string | null {
  const history = historyFor(chapterId);
  const next = history.redo.pop();
  if (next === undefined) return null;

  history.undo.push(current);
  if (history.undo.length > LIMIT) history.undo.shift();
  history.lastPushAt = 0;
  return next;
}

export function clearEditorHistory(chapterId: string): void {
  histories.delete(chapterId);
}
