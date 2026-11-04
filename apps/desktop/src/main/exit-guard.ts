import { plainSaveReason } from "@ai-book-studio/core/library/errors";
import type { FlushTarget } from "./drafts";
import type { UnsavedDraft } from "./studio";

export type ExitKind = "close" | "quit";

/** The question the author answers when words could not be saved. Button 0 always stays. */
export interface ExitQuestion {
  type: "warning";
  message: string;
  detail: string;
  buttons: [stay: string, leave: string];
  defaultId: 0;
  cancelId: 0;
}

/** What is said before a close or quit with unsaved words, in the studio's plain second person. */
export function exitQuestion(kind: ExitKind, unsaved: UnsavedDraft[]): ExitQuestion {
  const chapters = new Set(unsaved.map(({ draft }) => `${draft.bookId}:${draft.chapterId}`)).size;
  const where = chapters === 1 ? "1 chapter" : `${chapters} chapters`;
  const lost = unsaved.some((entry) => entry.keptId === null);
  const reason = plainSaveReason(unsaved[0]?.reason ?? "").trim();
  const quit = kind === "quit";
  const after = lost
    ? `The studio could not keep them for recovery either, so ${quit ? "quitting" : "closing the window"} now loses them.`
    : `If you ${quit ? "quit" : "close the window"}, the studio keeps them on this computer, outside your library, and offers them again the next time you open the book.`;
  return {
    type: "warning",
    message: "Your latest words are not saved",
    detail: `The studio could not save your changes in ${where} to your library.${reason ? ` ${reason}` : ""}\n\n${after} If you keep ${quit ? "the studio" : "the window"} open, it keeps trying to save them.`,
    buttons: quit
      ? ["Keep the studio open", lost ? "Quit and lose the words" : "Quit and keep the words"]
      : ["Keep the window open", lost ? "Close and lose the words" : "Close and keep the words"],
    defaultId: 0,
    cancelId: 0
  };
}

/**
 * The last step before a close or quit. Every draft is saved if it can be; what the library refuses is
 * kept in the profile's recovery store, and then the author decides: stay, or leave with the words kept.
 * A hidden run has no one to ask, so it logs what it would have asked and leaves, as the background
 * notifier logs its notifications.
 */
export class ExitGuard {
  private pending: Promise<"stay" | "leave"> | null = null;

  constructor(
    private readonly studio: {
      flushDrafts(window: FlushTarget | null): Promise<UnsavedDraft[]>;
      letGo(unsaved: UnsavedDraft[]): void;
    },
    private readonly options: {
      /** Whether this launch's window is never shown (`launchMode`). */
      headless: boolean;
      /** Shows the question and resolves with the index of the button pressed. */
      ask: (question: ExitQuestion) => Promise<number>;
    }
  ) {}

  /**
   * A close and a quit can arrive together, such as Cmd+Q while the close question is open. The
   * second shares the first one's flush and answer, so the author is asked once and no draft is
   * saved, or kept, twice at the same time.
   */
  check(window: FlushTarget | null, kind: ExitKind): Promise<"stay" | "leave"> {
    this.pending ??= this.decide(window, kind).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async decide(window: FlushTarget | null, kind: ExitKind): Promise<"stay" | "leave"> {
    const unsaved = await this.studio.flushDrafts(window);
    if (unsaved.length === 0) return "leave";
    if (this.options.headless) {
      // The counts and the reason only: never the words themselves.
      console.log(
        `[recovery] would ask ${JSON.stringify({
          kind,
          unsaved: unsaved.length,
          kept: unsaved.filter((entry) => entry.keptId !== null).length,
          reason: unsaved[0]?.reason ?? ""
        })}`
      );
    } else if ((await this.options.ask(exitQuestion(kind, unsaved))) === 0) {
      return "stay";
    }
    this.studio.letGo(unsaved);
    return "leave";
  }
}
