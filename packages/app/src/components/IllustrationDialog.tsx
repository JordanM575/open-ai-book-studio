import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import type { Chapter } from "@ai-book-studio/core/schema";
import type { ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type { ImageRecord } from "@ai-book-studio/core/images/schema";
import type { ImageSize } from "@ai-book-studio/core/providers/images";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { must } from "../lib/utils";

interface Props {
  open: boolean;
  bookId: string;
  chapter: Chapter | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onOpenSettings: () => void;
}

const SIZES: Array<{ value: ImageSize; label: string }> = [
  { value: "1024x1024", label: "Square · 1024×1024" },
  { value: "1536x1024", label: "Landscape · 1536×1024" },
  { value: "1024x1536", label: "Portrait · 1024×1536" },
  { value: "1792x1024", label: "Wide · 1792×1024" },
  { value: "1024x1792", label: "Tall · 1024×1792" }
];

/**
 * One illustration surface for the selected chapter. Generation is explicit and paid; the panel
 * shows the flat $0.01 estimate, the current image and the saved records. The image bytes are
 * served from the library through `images.read`, never from a provider URL.
 */
export function IllustrationDialog({ open, bookId, chapter, onClose, onChanged, onOpenSettings }: Props) {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [selected, setSelected] = useState<ImageRecord | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1024x1024");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const showImage = useCallback(async (record: ImageRecord) => {
    setSelected(record);
    setPreview(null);
    const stored = await must(window.studio.images.read(bookId, record.id));
    setPreview(stored?.dataUrl ?? null);
  }, [bookId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectionList, listed] = await Promise.all([
        must(window.studio.connections.list()),
        must(window.studio.images.list(bookId))
      ]);
      setConnections(connectionList.filter((connection) => connection.provider === "meta"));
      setImages([...listed.manifest.images].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      const attached = chapter
        ? listed.manifest.images.find((image) => image.chapterId === chapter.id)
        : undefined;
      const newest = listed.manifest.images
        .filter((image) => image.kind === "chapter")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (attached ?? newest) await showImage(attached ?? newest!);
      else {
        setSelected(null);
        setPreview(null);
      }
      if (listed.warning) setError(listed.warning);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, [bookId, chapter, showImage]);

  useEffect(() => {
    if (!open) return;
    setPrompt(chapter ? `An illustration for “${chapter.title}”: ` : "");
    setSavedNote(null);
    setError(null);
    void refresh();
  }, [open, chapter, refresh]);

  const generate = async (): Promise<void> => {
    if (!chapter || busy) return;
    if (!prompt.trim()) {
      setError("Write an image prompt first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSavedNote(null);
    try {
      const record = await must(
        window.studio.images.generate({
          bookId,
          chapterId: chapter.id,
          prompt: prompt.trim(),
          size
        })
      );
      setSavedNote("Illustration saved to this book.");
      await refresh();
      await showImage(record);
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (): Promise<void> => {
    if (!chapter || !selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await must(window.studio.images.attach(bookId, selected.id, chapter.id));
      setSavedNote("This image is now the chapter illustration.");
      await refresh();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const attached = Boolean(selected && chapter && selected.chapterId === chapter.id);
  const connected = connections.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Illustration"
        description={
          chapter
            ? `A saved image for “${chapter.title}”. Generation uses Muse Image and costs about $0.01.`
            : "Select a chapter before generating an illustration."
        }
        className="w-[calc(100vw-48px)] max-w-[720px]"
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="secondary"
              onClick={() => void attach()}
              disabled={!selected || !chapter || attached || busy}
              data-testid="attach-illustration"
            >
              {attached ? "Attached" : "Use for this chapter"}
            </Button>
            <Button
              variant="primary"
              onClick={() => void generate()}
              disabled={!chapter || !connected || busy || !prompt.trim()}
              data-testid="generate-illustration"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {busy ? "Generating…" : "Generate · $0.01"}
            </Button>
          </DialogFooter>
        }
      >
        {!connected ? (
          <div className="rounded-[var(--corner-lg)] border border-border p-4">
            <p className="text-[var(--text-subheadline-size)] font-medium">Connect Meta to generate images</p>
            <p className="mt-1 text-[var(--text-caption-size)] text-muted-foreground">
              Muse Image uses the Meta connection you already added. The image and prompt stay in this
              book folder.
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
            >
              Open Settings
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 min-[560px]:grid-cols-[1fr_220px]">
          <div className="space-y-3">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[var(--corner-lg)] border border-border bg-[var(--secondary)]">
              {preview ? (
                <img src={preview} alt={selected ? `Illustration: ${selected.prompt}` : "Chapter illustration"} className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
                  <ImageIcon size={28} />
                  <p className="text-[var(--text-caption-size)]">
                    {loading ? "Reading the book…" : "No illustration for this chapter yet."}
                  </p>
                </div>
              )}
            </div>
            <p className="text-[var(--text-caption-size)] text-muted-foreground" aria-live="polite">
              {savedNote ?? (selected ? `${selected.width}×${selected.height} · ${selected.model}` : "")}
            </p>
            {error ? (
              <p role="alert" className="text-[var(--text-caption-size)] text-[var(--destructive-text)]">
                {error}
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <label className="block text-[var(--text-caption-size)] text-muted-foreground" htmlFor="illustration-prompt">
              Prompt
            </label>
            <textarea
              id="illustration-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              maxLength={4_000}
              placeholder="A lighthouse in a storm, ink and wash, warm lantern light…"
              className="w-full resize-none rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] px-3 py-2 text-[var(--text-body-size)] leading-[var(--text-body-leading)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              data-testid="illustration-prompt"
            />
            <label className="block text-[var(--text-caption-size)] text-muted-foreground" htmlFor="illustration-size">
              Shape
            </label>
            <select
              id="illustration-size"
              value={size}
              onChange={(event) => setSize(event.target.value as ImageSize)}
              className="w-full rounded-[var(--corner-md)] border border-[var(--input)] bg-[var(--card)] px-2 py-2 text-[var(--text-subheadline-size)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {SIZES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {images.length > 0 ? (
              <div>
                <p className="mb-1 text-[var(--text-caption-size)] text-muted-foreground">Saved images</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {images.slice(0, 8).map((image) => (
                    <li key={image.id}>
                      <button
                        type="button"
                        onClick={() => void showImage(image)}
                        className={`w-full rounded-[var(--corner-sm)] px-2 py-1 text-left text-[var(--text-caption-size)] transition-colors hover:bg-[var(--accent)] ${
                          selected?.id === image.id ? "bg-[var(--accent)]" : ""
                        }`}
                        title={image.prompt}
                      >
                        <span className="line-clamp-1">{image.prompt || image.fileName}</span>
                        <span className="text-muted-foreground">
                          {image.chapterId === chapter?.id ? "Attached · " : ""}
                          {new Date(image.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
