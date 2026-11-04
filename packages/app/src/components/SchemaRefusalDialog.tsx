import { useEffect, useState } from "react";
import type { BuildMetadata } from "@ai-book-studio/core/build";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";
import { buildSupportSummary } from "../lib/schema-refusal";

interface Props {
  detectedSchema: number | null;
  onBack: () => void;
}

/**
 * Spec 009 T029: the newer-schema refusal journey. The library opens, the book
 * does not, and nothing is written. The dialog names the schema mismatch, the
 * compatible-build next step and the no-migration guarantee (FR-047), plus a
 * user-reviewed local support summary (FR-048) that is copied only on request.
 */
export function SchemaRefusalDialog({ detectedSchema, onBack }: Props) {
  const [build, setBuild] = useState<BuildMetadata | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const info = await must(window.studio.app.info());
        if (alive) setBuild(info);
      } catch {
        // The summary stays unavailable; the refusal itself still stands.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const summary = build ? buildSupportSummary(build, detectedSchema) : null;

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  const mismatch =
    build && detectedSchema !== null
      ? `These files use library schema ${detectedSchema}, but this build supports schema ${build.schemaVersion}. Nothing was changed.`
      : "These files use a newer library schema than this build supports. Nothing was changed.";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
    >
      <DialogContent
        data-testid="schema-refusal"
        title="Update to open this book"
        description="Your files are untouched. This build cannot read them yet."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" data-testid="schema-refusal-copy" onClick={() => void copy()} disabled={!summary}>
              Copy summary
            </Button>
            <Button data-testid="schema-refusal-back" onClick={onBack}>
              Back to library
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p>{mismatch}</p>
          <p>To open them, use the newer build that wrote them.</p>
          <p>Reinstalling an older build does not change your library files.</p>
          <p className="text-muted-foreground">
            The summary below stays on this device. Nothing is sent anywhere. Copy it only if you choose to share
            it.
          </p>
          {summary ? (
            <pre data-testid="schema-refusal-summary" className="thin-scroll overflow-x-auto rounded-[var(--corner-lg)] bg-muted p-3 text-(length:--text-caption-size) whitespace-pre-wrap">
              {summary}
            </pre>
          ) : (
            <p className="text-muted-foreground">Loading summary…</p>
          )}
          {copied ? <p>Copied.</p> : null}
          {copyFailed ? <p>Copy failed. Select the summary text manually.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
