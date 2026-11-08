import { z } from "zod";
import type { BookDetail } from "../schema";
import { countWords } from "../words";
import { normalizeBody } from "../markdown";
import { chapterPath } from "../library/paths";
import { readHistoryEnvelope } from "../library/history";
import { bookIdSchema, hashSchema, revisionSchema } from "../planning/schema";
import {
  assertSidecarOwner, CheckedSidecar, envelopeFields, parseRequest, sameSource,
  type SidecarAttempt, type SidecarHost, type SidecarRead, type SidecarSave
} from "../planning/checked-sidecar";

export const goalSchema = z.looseObject({
  schemaVersion: z.literal(1), bookId: bookIdSchema, revision: revisionSchema, targetWords: revisionSchema.nullable()
});
export type Goal = z.infer<typeof goalSchema>;
export const goalSaveSchema = z.strictObject({
  ...envelopeFields,
  draft: z.strictObject({ kind: z.literal("set-goal"), targetWords: revisionSchema.nullable() })
});
export type GoalSaveRequest = z.infer<typeof goalSaveSchema>;

export interface GoalHost extends SidecarHost {
  /** Fresh complete enumeration inside withBook; raw bytes are independently verified below. Never a summary/draft/cache. */
  readSavedBook(bookId: string): Promise<BookDetail>;
}

export type GoalProgress =
  | { status: "complete"; bookId: string; targetWords: number | null; savedWords: number; remaining: number | null }
  | { status: "incomplete"; bookId: string; targetWords: number | null; unreadableChapters: number }
  | { status: "unavailable"; bookId: string; reason: "changed" | "unreadable" };

export class GoalService {
  private readonly sidecar: CheckedSidecar<Goal>;
  constructor(private readonly host: GoalHost) { this.sidecar = new CheckedSidecar(host, "goals", goalSchema); }

  read(bookId: string): Promise<SidecarRead<Goal>> { return this.sidecar.read(bookId); }

  save(input: unknown, attempt?: SidecarAttempt): Promise<SidecarSave<Goal>> {
    const request = parseRequest(goalSaveSchema, input);
    return this.sidecar.save(request, (base) => ({
      data: { ...(base ?? { schemaVersion: 1, bookId: request.bookId, revision: 1 }), targetWords: request.draft.targetWords },
      changed: (base?.targetWords ?? null) !== request.draft.targetWords
    }), attempt);
  }

  async progress(bookId: string): Promise<GoalProgress> {
    try {
      return await this.host.withBook(bookId, async () => {
        await assertSidecarOwner(this.host, bookId);
        const goal = await this.sidecar.readCurrent(bookId);
        const first = structuredClone(await this.host.readSavedBook(bookId));
        // Materialize before awaiting: even a host reusing a mutable object cannot mask a change.
        const fingerprint = savedFingerprint(first, bookId);
        const savedWords = first.chapters.reduce((total, chapter) => total + countWords(chapter.content), 0);
        const issues = first.chapterReadIssues.length;
        if (!await this.verifySavedSources(first, bookId)) return { status: "unavailable", bookId, reason: "unreadable" };
        const second = structuredClone(await this.host.readSavedBook(bookId));
        const after = await this.sidecar.readCurrent(bookId);
        await assertSidecarOwner(this.host, bookId);
        if (fingerprint !== savedFingerprint(second, bookId) || !sameSource(goal.source, after.source)) {
          return { status: "unavailable", bookId, reason: "changed" };
        }
        if (!await this.verifySavedSources(second, bookId)) return { status: "unavailable", bookId, reason: "unreadable" };
        const targetWords = goal.data?.targetWords ?? null;
        if (issues > 0) return { status: "incomplete", bookId, targetWords, unreadableChapters: issues };
        if (!Number.isSafeInteger(savedWords)) return { status: "unavailable", bookId, reason: "unreadable" };
        return { status: "complete", bookId, targetWords, savedWords, remaining: targetWords === null ? null : Math.max(0, targetWords - savedWords) };
      });
    } catch { return { status: "unavailable", bookId, reason: "unreadable" }; }
  }

  private async verifySavedSources(detail: BookDetail, bookId: string): Promise<boolean> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const chapter of detail.chapters) {
      const snapshot = await this.host.storage.readFile(chapterPath(bookId, chapter.path));
      if (!snapshot || snapshot.sha256 !== chapter.hash || await this.host.runtime.sha256(snapshot.bytes) !== chapter.hash) return false;
      const raw = decoder.decode(snapshot.bytes);
      let content: string;
      if (/^---[ \t]*\r?\n/.test(raw)) {
        const envelope = readHistoryEnvelope(raw);
        const meta = envelope.metadata;
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
        if ("bookId" in meta && meta.bookId !== bookId) return false;
        if (("id" in meta && meta.id !== chapter.id) || ("version" in meta && meta.version !== chapter.version)) return false;
        content = envelope.content;
      } else content = normalizeBody(raw);
      if (content !== chapter.content) return false;
    }
    return true;
  }
}

function savedFingerprint(detail: BookDetail, bookId: string): string {
  if (detail.book.id !== bookId || !Array.isArray(detail.chapterReadIssues)) throw new Error("Unverified book.");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const chapters = detail.chapters.map((chapter) => {
    if (!/^ch_[A-Za-z0-9-]{6,}$/.test(chapter.id) || ids.has(chapter.id) || paths.has(chapter.path) ||
        !Number.isSafeInteger(chapter.version) || chapter.version < 0 || !hashSchema.safeParse(chapter.hash).success ||
        typeof chapter.content !== "string") throw new Error("Unverified chapter.");
    ids.add(chapter.id);
    paths.add(chapter.path);
    return [chapter.id, chapter.path, chapter.version, chapter.hash, chapter.content];
  }).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);
  const issues = detail.chapterReadIssues.map((issue) => [issue.fileName, issue.order, issue.reason])
    .sort((a, b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);
  return JSON.stringify([detail.book.id, chapters, issues]);
}
