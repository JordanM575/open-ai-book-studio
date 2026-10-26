/**
 * The ambient agent's contract.
 *
 * The studio's agent is a chat box: you type, it replies, it edits. The ambient version is smaller
 * and quieter. It knows where you are in the book, what it last did, what it would do next, and
 * what it could say out loud. It says it without being asked, and it offers to read the prose
 * rather than printing it.
 *
 * This module is the whole of it, and it is pure: it turns plain facts into a small object and
 * nothing else. The desktop's minimal panel, the glasses' page and a future phone app all render
 * the same object, so they cannot drift apart.
 */

/** The book, as far as the ambient agent cares. */
export interface AmbientBook {
  id: string;
  title: string;
  stage: string;
}

/** One chapter, as far as the ambient agent cares. */
export interface AmbientChapter {
  id: string;
  title: string;
  order: number;
  wordCount: number;
}

/** What the agent last changed, and when. */
export interface AmbientChange {
  /** A short phrase: "tightened the opening of Chapter Two". */
  what: string;
  at: string;
}

/** The things the author can do, in the studio's own verbs. */
export type AmbientActionId =
  | "read_aloud"
  | "keep_going"
  | "stop"
  | "next_chapter"
  | "undo"
  | "where_am_i";

export interface AmbientAction {
  id: AmbientActionId;
  /** The word on the button. */
  label: string;
  /** What the assistant says when it is asked for this. */
  spoken: string;
  /** False when the action is not possible right now. */
  available: boolean;
  /** Why it is not possible, when it is not. */
  why?: string;
}

/** Everything the ambient agent knows about a book, in the small number of words it can say. */
export interface AmbientStatus {
  book: AmbientBook;
  /** The chapter the author is in, or the last one the agent touched. */
  chapter: AmbientChapter | null;
  progress: {
    chapters: number;
    words: number;
    /** The order of the last chapter, which is how far through the book is. */
    lastOrder: number;
  };
  /** What the agent last changed, or null when it has not changed anything yet. */
  lastChange: AmbientChange | null;
  /** The agent's own last words, when it has said any in this book. */
  lastSaid: string | null;
  /** True while a turn is running. */
  working: boolean;
  /** What the author can do. */
  actions: AmbientAction[];
  /** The one line the agent would say. */
  say: string;
}

export interface AmbientInput {
  book: AmbientBook;
  chapters: AmbientChapter[];
  /** The chapter the author is looking at. */
  activeChapterId?: string | null;
  lastChange?: AmbientChange | null;
  lastSaid?: string | null;
  working?: boolean;
  canUndo?: boolean;
  /** Whether a model is chosen, so the agent could be asked to keep going. */
  canKeepGoing?: boolean;
  /** When the status was computed, so the "twelve minutes ago" is honest. */
  now?: Date;
}

/**
 * The ambient status of a book.
 *
 * It is computed from facts, not from a conversation, so it is available whether the author has
 * opened the chat panel or not. That is the point: the agent knows the state of the book without
 * being asked.
 */
export function ambientStatus(input: AmbientInput): AmbientStatus {
  const chapters = [...input.chapters].sort((left, right) => left.order - right.order);
  const words = chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const active = input.activeChapterId
    ? chapters.find((chapter) => chapter.id === input.activeChapterId) ?? null
    : null;
  const chapter = active ?? chapters[chapters.length - 1] ?? null;
  const working = input.working === true;

  const actions: AmbientAction[] = [
    {
      id: "read_aloud",
      label: "Read aloud",
      spoken: "read the chapter to me",
      available: chapter !== null,
      ...(chapter ? {} : { why: "There is no chapter to read yet." })
    },
    {
      id: "keep_going",
      label: "Keep going",
      spoken: "keep going",
      available: !working && input.canKeepGoing === true,
      ...(working
        ? { why: "The agent is already working." }
        : input.canKeepGoing === true
          ? {}
          : { why: "Choose a model for this book first." })
    },
    {
      id: "stop",
      label: "Stop",
      spoken: "stop",
      available: working,
      ...(working ? {} : { why: "The agent is not working." })
    },
    {
      id: "next_chapter",
      label: "Next chapter",
      spoken: "read the next chapter",
      available: chapters.length > 1,
      ...(chapters.length > 1 ? {} : { why: "There is only one chapter." })
    },
    {
      id: "undo",
      label: "Undo",
      spoken: "undo that",
      available: input.canUndo === true,
      ...(input.canUndo === true ? {} : { why: "There is nothing to undo." })
    },
    {
      id: "where_am_i",
      label: "Where am I?",
      spoken: "where am I",
      available: true
    }
  ];

  const status: AmbientStatus = {
    book: input.book,
    chapter,
    progress: {
      chapters: chapters.length,
      words,
      lastOrder: chapters[chapters.length - 1]?.order ?? 0
    },
    lastChange: input.lastChange ?? null,
    lastSaid: input.lastSaid ?? null,
    working,
    actions,
    say: ""
  };
  status.say = ambientLine(status, input.now ?? new Date());
  return status;
}

/**
 * The one line the agent says.
 *
 * It is written to be heard, not read: short clauses, no punctuation the voice stumbles on, and
 * one offer at the end.
 */
export function ambientLine(status: AmbientStatus, now: Date = new Date()): string {
  const title = status.book.title || "your book";
  const parts: string[] = [];

  if (status.working) {
    parts.push(`I'm working on ${status.chapter ? status.chapter.title : title} right now.`);
  } else if (status.chapter) {
    parts.push(`You're in ${chapterPhrase(status.chapter)} of ${title}.`);
  } else {
    parts.push(`${title} is open and empty.`);
  }

  if (status.progress.chapters > 0) {
    parts.push(
      `${count(status.progress.chapters, "chapter")}, ${count(status.progress.words, "word")} so far.`
    );
  }

  if (status.lastChange) {
    const when = relativeTime(status.lastChange.at, now);
    parts.push(`Last change, ${when}: ${status.lastChange.what}.`);
  }

  const readAloud = status.actions.find((action) => action.id === "read_aloud");
  if (readAloud?.available && status.chapter && status.chapter.wordCount > 0) {
    parts.push("Shall I read it to you?");
  }

  return parts.join(" ");
}

/** "Chapter Two" for a numbered chapter, and the title when it has one. */
function chapterPhrase(chapter: AmbientChapter): string {
  const number = ordinal(chapter.order);
  return chapter.title ? `${number}, ${chapter.title}` : number;
}

/** "Chapter One" for the first, "Chapter Two" for the second. */
export function ordinal(value: number): string {
  const words = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve"
  ];
  if (value >= 0 && value < words.length) return `Chapter ${words[value]}`;
  return `Chapter ${value}`;
}

/** "1 chapter", "2 chapters", "340 words". */
export function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * "just now", "twelve minutes ago", "yesterday".
 *
 * It is said, not shown, so it is written the way a person would say it.
 */
export function relativeTime(at: string, now: Date = new Date()): string {
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return "a moment ago";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${spokenNumber(minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${spokenNumber(hours)} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${spokenNumber(days)} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${spokenNumber(months)} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${spokenNumber(years)} year${years === 1 ? "" : "s"} ago`;
}

/** Small numbers, the way they are said. */
export function spokenNumber(value: number): string {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty"
  ];
  if (value >= 0 && value < words.length) return words[value]!;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    const tensWords = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    const ten = tensWords[tens] ?? "";
    if (ones === 0) return ten;
    return `${ten}-${words[ones]}`;
  }
  return String(value);
}
