import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ArcValue, BookMeta, Character, Memory, StoryArc } from "@ai-book-studio/core/schema";
import { Button } from "@ai-book-studio/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@ai-book-studio/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-book-studio/ui/components/collapsible";
import { NativeSelect, NativeSelectOption } from "@ai-book-studio/ui/components/native-select";
import { editBook, keptCopyText, must } from "../lib/utils";

interface Props {
  open: boolean;
  book: BookMeta;
  onClose: () => void;
  onSaved: (book: BookMeta) => void;
  /** A copy of the author's version was kept, so the workspace lists the book's conflict copies again. */
  onConflictCopy?: () => void;
  onNotice: (error: unknown) => void;
}

/** How the conflict note names a field another writer changed too. */
const FIELD_NAMES: Record<string, string> = {
  title: "the title",
  description: "the description",
  genres: "the genres",
  influences: "the influences",
  outline: "the outline",
  storyArc: "the story arc",
  characters: "the cast",
  memories: "the memories"
};

const EMPTY_ARC: StoryArc = {
  beginning: { overview: "", keyMoments: "", openQuestions: "" },
  middle: { overview: "", keyMoments: "", openQuestions: "" },
  end: { overview: "", keyMoments: "", openQuestions: "" }
};

export function StoryBibleDialog({ open, book, onClose, onSaved, onConflictCopy, onNotice }: Props) {
  const [title, setTitle] = useState(book.title);
  const [description, setDescription] = useState(book.description);
  const [genres, setGenres] = useState(book.genres.join(", "));
  const [influences, setInfluences] = useState(book.influences.join(", "));
  const [outline, setOutline] = useState(book.outline);
  const [arc, setArc] = useState<StoryArc>(book.storyArc ?? EMPTY_ARC);
  const [characters, setCharacters] = useState<Character[]>(book.characters);
  const [memories, setMemories] = useState<Memory[]>(book.memories);
  const [saving, setSaving] = useState(false);
  /** Where the author's version went when another writer had changed the same fields. */
  const [copy, setCopy] = useState<{ savedAs: string; fields: string[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setCopy(null);
      return;
    }
    setTitle(book.title);
    setDescription(book.description);
    setGenres(book.genres.join(", "));
    setInfluences(book.influences.join(", "));
    setOutline(book.outline);
    setArc(book.storyArc ?? EMPTY_ARC);
    setCharacters(book.characters);
    setMemories(book.memories);
    setSaving(false);
  }, [book, open]);

  const save = async (): Promise<void> => {
    if (saving || !title.trim()) return;
    setSaving(true);
    try {
      // Only what the author changed is sent, with what it was when the dialog opened, and merged onto
      // the file as it is now: another device or the agent may have written it since. Only what the
      // author touched is tidied; anything else goes back exactly as it was read, so it is no change.
      const result = await editBook(book, {
        title: title === book.title ? title : title.trim(),
        description: description === book.description ? description : description.trim(),
        genres: genres === book.genres.join(", ") ? book.genres : splitList(genres),
        influences: influences === book.influences.join(", ") ? book.influences : splitList(influences),
        outline,
        storyArc: arc,
        characters: characters.flatMap((character) => {
          if (book.characters.includes(character)) return [character];
          const name = character.name.trim();
          return name ? [{ ...character, name }] : [];
        }),
        memories: memories.flatMap((memory) => {
          if (book.memories.includes(memory)) return [memory];
          const text = memory.text.trim();
          return text ? [{ ...memory, text }] : [];
        })
      });
      onSaved(result.book);
      if (result.status === "saved") return onClose();
      // The book now shows the other writer's values; the note says where the author's went.
      setCopy(result);
      onConflictCopy?.();
      setSaving(false);
    } catch (error) {
      onNotice(error);
      setSaving(false);
    }
  };

  const setArcPart = (key: ArcValue, field: "overview" | "keyMoments" | "openQuestions", value: string): void => {
    setArc((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        title="Story Bible"
        description="The facts the studio and the writing agent should keep straight. Nothing here is shown to a reader."
        className="w-[calc(100vw-48px)] max-w-[680px]"
        footer={
          <>
            {copy ? (
              <div role="status" data-testid="story-bible-conflict" className="mb-3 flex items-start gap-3">
                <p className="min-w-0 flex-1 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)]">
                  {keptCopyText(sentence(copy.fields.map((field) => FIELD_NAMES[field] ?? "the details")))}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void must(window.studio.conflicts.reveal(book.id, copy.savedAs)).catch(onNotice)}
                >
                  Show the copy
                </Button>
              </div>
            ) : null}
            <DialogFooter className="mt-0">
              <Button variant="ghost" onClick={onClose}>
                {copy ? "Close" : "Cancel"}
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={saving || !title.trim()} data-testid="save-story-bible">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        }
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-(length:--text-subheadline-size) font-medium">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
                className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-(length:--text-subheadline-size) font-medium">What it is about</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={20000}
                className="w-full resize-none rounded-[var(--corner-md)] bg-card px-3 py-2 text-(length:--text-body-size) leading-[var(--text-body-leading)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-(length:--text-subheadline-size) font-medium">Genres</span>
                <input
                  value={genres}
                  onChange={(event) => setGenres(event.target.value)}
                  placeholder="Literary fiction, mystery"
                  className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-(length:--text-subheadline-size) font-medium">Influences</span>
                <input
                  value={influences}
                  onChange={(event) => setInfluences(event.target.value)}
                  placeholder="Ursula K. Le Guin"
                  className="h-9 w-full rounded-[var(--corner-md)] bg-card px-3 text-(length:--text-body-size) shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                />
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-(length:--text-callout-size) font-semibold">Outline</h3>
            <textarea
              value={outline}
              onChange={(event) => setOutline(event.target.value)}
              rows={5}
              maxLength={100000}
              placeholder="A crossing at low tide. Two sisters, one letter, and the town that remembers."
              className="w-full resize-y rounded-[var(--corner-md)] bg-card px-3 py-2 text-(length:--text-body-size) leading-[var(--text-body-leading)] shadow-[inset_0_0_0_1px_var(--input-border),var(--elevation-1)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-(length:--text-callout-size) font-semibold">Story arc</h3>
            <div className="space-y-2">
              {(["beginning", "middle", "end"] as const).map((key) => (
                <Collapsible key={key} className="rounded-[var(--corner-md)] bg-card px-3 py-2 shadow-[inset_0_0_0_1px_var(--border)]">
                  <CollapsibleTrigger className="group/arc flex w-full items-center gap-1.5 rounded-[var(--corner-sm)] text-left text-(length:--text-subheadline-size) font-medium capitalize">
                    <ChevronRight
                      size={14}
                      aria-hidden
                      className="shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-data-[state=open]/arc:rotate-90"
                    />
                    {key}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {(["overview", "keyMoments", "openQuestions"] as const).map((field) => (
                      <label key={field} className="block space-y-1">
                        <span className="text-(length:--text-caption-size) text-muted-foreground">
                          {field === "keyMoments" ? "Key moments" : field === "openQuestions" ? "Open questions" : "Overview"}
                        </span>
                        <textarea
                          value={arc[key][field]}
                          onChange={(event) => setArcPart(key, field, event.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-[var(--corner-sm)] bg-background px-2 py-1.5 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                        />
                      </label>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-(length:--text-callout-size) font-semibold">Characters</h3>
              <Button variant="ghost" size="sm" onClick={() => setCharacters((current) => [...current, blankCharacter()])}>
                <Plus size={14} />
                Add character
              </Button>
            </div>
            {characters.length === 0 ? (
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">No one yet. Add the people the agent should remember.</p>
            ) : (
              <div className="space-y-2">
                {characters.map((character, index) => (
                  <div key={character.id} className="rounded-[var(--corner-md)] bg-card p-3 shadow-[inset_0_0_0_1px_var(--border)]">
                    <div className="flex items-start gap-2">
                      <input
                        value={character.name}
                        onChange={(event) => updateCharacter(index, { name: event.target.value }, setCharacters)}
                        placeholder="Name"
                        className="h-8 min-w-0 flex-1 rounded-[var(--corner-sm)] bg-background px-2 text-(length:--text-subheadline-size) font-medium shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                      />
                      <input
                        value={character.role}
                        onChange={(event) => updateCharacter(index, { role: event.target.value }, setCharacters)}
                        placeholder="Role"
                        className="h-8 w-40 rounded-[var(--corner-sm)] bg-background px-2 text-(length:--text-subheadline-size) shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${character.name || "character"}`}
                        onClick={() => setCharacters((current) => current.filter((_, at) => at !== index))}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <textarea
                      value={character.description}
                      onChange={(event) => updateCharacter(index, { description: event.target.value }, setCharacters)}
                      placeholder="Who they are, what they want, what they hide"
                      rows={2}
                      className="mt-2 w-full resize-none rounded-[var(--corner-sm)] bg-background px-2 py-1.5 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-(length:--text-callout-size) font-semibold">Memories</h3>
              <Button variant="ghost" size="sm" onClick={() => setMemories((current) => [...current, blankMemory()])}>
                <Plus size={14} />
                Add memory
              </Button>
            </div>
            {memories.length === 0 ? (
              <p className="text-(length:--text-subheadline-size) text-muted-foreground">
                Small facts worth remembering: a nickname, a promise, the weather on the day it happened.
              </p>
            ) : (
              <div className="space-y-2">
                {memories.map((memory, index) => (
                  <div key={memory.id} className="flex items-start gap-2">
                    <textarea
                      value={memory.text}
                      onChange={(event) => updateMemory(index, { text: event.target.value }, setMemories)}
                      rows={2}
                      maxLength={180}
                      className="min-w-0 flex-1 resize-none rounded-[var(--corner-sm)] bg-card px-2 py-1.5 text-(length:--text-subheadline-size) leading-[var(--text-subheadline-leading)] shadow-[inset_0_0_0_1px_var(--input-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--input-focus)]"
                    />
                    <NativeSelect
                      size="sm"
                      value={memory.importance}
                      onChange={(event) => updateMemory(index, { importance: event.target.value as Memory["importance"] }, setMemories)}
                      className="shrink-0"
                      aria-label="Importance"
                    >
                      <NativeSelectOption value="low">Low</NativeSelectOption>
                      <NativeSelectOption value="medium">Medium</NativeSelectOption>
                      <NativeSelectOption value="high">High</NativeSelectOption>
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove memory"
                      onClick={() => setMemories((current) => current.filter((_, at) => at !== index))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function blankCharacter(): Character {
  return { id: `char_${randomId()}`, name: "", role: "", description: "", motivations: "", notes: "" };
}

function blankMemory(): Memory {
  const now = new Date().toISOString();
  return { id: `mem_${randomId()}`, text: "", importance: "medium", createdAt: now, updatedAt: now };
}

/** "The outline", "The outline and the cast", "The title, the outline and the cast". */
function sentence(names: string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "the details");
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateCharacter(index: number, patch: Partial<Character>, set: Dispatch<SetStateAction<Character[]>>): void {
  set((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
}

function updateMemory(index: number, patch: Partial<Memory>, set: Dispatch<SetStateAction<Memory[]>>): void {
  set((current) => current.map((item, at) => (at === index ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)));
}
