/** Synthetic-only browser harness. Not imported by the application. */
import { createRoot, type Root } from "react-dom/client";
import { InlineReviewControls } from "../../../packages/app/src/components/inline-editor/InlineTextSurface";
import { InlineEditor } from "../../../packages/app/src/components/inline-editor/editor";
import type { InlineChange, InlineInspection, InlineSource } from "../../../packages/app/src/components/inline-editor/contracts";
import type { InlineSpan } from "../../../packages/core/src/review/inline/overlap";
import { clearEditorHistory, pushHistory, redoHistory, undoHistory } from "../../../packages/app/src/lib/editor-history";

let editor: InlineEditor;
let controls: Root | undefined;
let source: InlineSource;
let changes: InlineChange[] = [];
let inspections: InlineInspection[] = [];
let commands: string[] = [];
let statuses: string[] = [];
let invalidationCounts: number[] = [];
let composition: boolean[] = [];
let spans: readonly InlineSpan[] = [];
let blurCount = 0;
let visit = 0;
let deferred: (() => void) | undefined;
let deferProof = false;
const historyKey = "synthetic-inline-probe";

function mount(body: string, evidence: readonly InlineSpan[] = []) {
  editor?.destroy();
  controls?.unmount();
  clearEditorHistory(historyKey);
  changes = []; inspections = []; commands = []; statuses = []; composition = []; invalidationCounts = []; blurCount = 0;
  spans = evidence;
  source = {
    libraryId: "synthetic-library", bookId: "synthetic-book", chapterId: "synthetic-chapter", viewGeneration: String(++visit),
    sourceEpoch: 1, version: 1, rawHash: "a".repeat(64), savedBody: body, clean: true, pending: false, available: true
  };
  const parent = document.getElementById("editor");
  const buttons = document.getElementById("controls");
  if (!parent || !buttons) throw new Error("Missing synthetic mount");
  editor = new InlineEditor(parent, {
    initialText: body, readSource: () => source,
    evidence: {
      validate: async (_input, target) => {
        // This fixture is a trusted proof producer for supplied synthetic spans, not a verifier.
        const proof = { source: target, spans };
        if (deferProof) await new Promise<void>((resolve) => { deferred = resolve; });
        return proof;
      }
    },
    onChange: (change) => {
      invalidationCounts.push(document.querySelectorAll(".inline-review-mark").length);
      if (change.recordHistory) pushHistory(historyKey, change.previous, Date.now(), change.isolated);
      changes.push(change);
      source = { ...source, clean: false, pending: true, sourceEpoch: source.sourceEpoch + 1 };
    },
    onCommand: (command) => {
      commands.push(command);
      const snapshot = editor.getSnapshot();
      const next = command === "undo" ? undoHistory(historyKey, snapshot.body) : command === "redo" ? redoHistory(historyKey, snapshot.body) : null;
      if (next !== null && command !== "save") editor.replaceText(next, snapshot.revision, command);
    },
    onInspect: (item) => {
      inspections.push(item);
      const detail = document.getElementById("finding");
      if (detail) { detail.textContent = `${item.choices.length} evidence spans · ${item.active.quote}`; if (item.action === "return") detail.focus(); }
    },
    onReviewStatus: (status) => { statuses.push(status); },
    onComposition: (value) => { composition.push(value); },
    onBlur: () => { blurCount += 1; }
  });
  controls = createRoot(buttons);
  controls.render(<InlineReviewControls editor={editor} />);
}

const probe = {
  mount,
  snapshot: () => editor.getSnapshot(),
  show: () => editor.showEvidence({}),
  selection: (anchor: number, head: number, focus = true) => editor.setSelection({ anchor, head }, focus),
  dictation: (text: string) => editor.insertDictation(text, editor.getSnapshot().revision),
  replace: (text: string) => editor.replaceText(text, editor.getSnapshot().revision),
  command: (command: "previous" | "next" | "inspect" | "return") => editor.reviewCommand(command),
  visibility: (keys: string[] | null, hidden: boolean) => editor.setVisibility(keys === null ? null : new Set(keys), hidden),
  state: () => ({ changes, inspections, commands, statuses, invalidationCounts, composition, blurCount }),
  confirm: () => {
    source = { ...source, savedBody: editor.getSnapshot().body, version: source.version + 1, rawHash: "b".repeat(64), clean: true, pending: false, sourceEpoch: source.sourceEpoch + 1 };
    editor.syncSource();
  },
  sourceChange: (change: Partial<InlineSource>) => { source = { ...source, ...change, sourceEpoch: source.sourceEpoch + 1 }; editor.syncSource(); },
  defer: () => { deferProof = true; },
  release: () => { deferProof = false; deferred?.(); deferred = undefined; },
  destroy: () => { editor.destroy(); controls?.unmount(); }
};

declare global { interface Window { inlineProbe: typeof probe } }
window.inlineProbe = probe;
