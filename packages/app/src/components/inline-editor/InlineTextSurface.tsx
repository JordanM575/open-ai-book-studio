import { useLayoutEffect, useRef } from "react";
import type { InlineEditorOptions } from "./contracts";
import { InlineEditor } from "./editor";

/** Host supplies stable options for a single visit; key by library/book/chapter/view generation. */
export function InlineTextSurface({ options, onReady }: {
  options: InlineEditorOptions;
  onReady: (editor: InlineEditor | null) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!parent.current) return;
    const editor = new InlineEditor(parent.current, options);
    onReady(editor);
    return () => {
      editor.destroy();
      onReady(null);
    };
  }, [options, onReady]);
  return <div ref={parent} className="min-w-0" />;
}

/** Place beside the host's named aside/full finding details and polite status region. */
export function InlineReviewControls({ editor }: { editor: InlineEditor | null }) {
  return (
    <fieldset aria-label="Evidence navigation" className="flex flex-wrap gap-2">
      {([
        ["previous", "Previous evidence"], ["next", "Next evidence"],
        ["inspect", "Inspect evidence"], ["return", "Return to finding"]
      ] as const).map(([command, label]) => (
        <button key={command} type="button" disabled={!editor}
          className="min-h-[44px] rounded-[var(--corner-sm)] px-3 text-foreground focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
          onClick={() => editor?.reviewCommand(command)}>{label}</button>
      ))}
    </fieldset>
  );
}
