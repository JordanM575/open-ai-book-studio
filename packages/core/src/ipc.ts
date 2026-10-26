import type {
  BookDetail,
  BookMeta,
  BookSummary,
  Chapter,
  ChapterConflict,
  ReorderChapterResult,
  ReorderDirection,
  SearchHit,
  SaveChapterResult
} from "./schema";
import type { Catalogue } from "./providers/models";
import type { ImageSize } from "./providers/images";
import type { ImageRecord } from "./images/schema";
import type { SegmentationResult } from "./images/segmentation";
import type { ImageList } from "./images/store";
import type { ConnectionSummary, CredentialStatus, ProviderDescription, ProviderId } from "./providers/types";
import type { UsageSummary } from "./providers/usage";
import type { VoiceTranscript } from "./providers/speech";
import type { AgentEvent, AgentTurnInput, AgentTurnStarted } from "./agent";
import type { AgentThread } from "./agent/messages";
import type { ThreadSummary } from "./agent/threads";
import type { StorageSummary } from "./library/storage";
import type { BuildMetadata } from "./build";

export type { AgentEvent, AgentTurnInput, AgentTurnStarted };
export type { AgentThread, ThreadSummary };

import type { LegacyImportReport } from "./legacy";

export const IPC = {
  app: {
    info: "app:info"
  },
  library: {
    choose: "library:choose",
    open: "library:open",
    current: "library:current",
    reveal: "library:reveal",
    importLegacy: "library:importLegacy",
    exportArchive: "library:exportArchive",
    importArchive: "library:importArchive"
  },
  books: {
    list: "books:list",
    create: "books:create",
    update: "books:update",
    delete: "books:delete",
    open: "books:open",
    exportDocx: "books:exportDocx",
    search: "books:search"
  },
  chapters: {
    create: "chapters:create",
    save: "chapters:save",
    updateMeta: "chapters:updateMeta",
    reorder: "chapters:reorder",
    move: "chapters:move",
    delete: "chapters:delete"
  },
  conflicts: {
    list: "conflicts:list",
    reveal: "conflicts:reveal"
  },
  drafts: {
    set: "drafts:set",
    clear: "drafts:clear"
  },
  providers: {
    list: "providers:list",
    models: "providers:models"
  },
  connections: {
    list: "connections:list",
    available: "connections:available",
    status: "connections:status",
    addKey: "connections:addKey",
    startOpenRouter: "connections:startOpenRouter",
    cancelOpenRouter: "connections:cancelOpenRouter",
    remove: "connections:remove",
    test: "connections:test"
  },
  usage: {
    summary: "usage:summary"
  },
  voice: {
    connections: "voice:connections",
    transcribe: "voice:transcribe"
  },
  images: {
    list: "images:list",
    read: "images:read",
    generate: "images:generate",
    attach: "images:attach",
    remove: "images:remove",
    saveCutout: "images:saveCutout",
    attachCharacter: "images:attachCharacter"
  },
  segmentation: {
    segment: "segmentation:segment"
  },
  agent: {
    start: "agent:start",
    stop: "agent:stop",
    undoLast: "agent:undoLast",
    approve: "agent:approve",
    threads: {
      list: "agent:threads:list",
      read: "agent:threads:read",
      rename: "agent:threads:rename",
      remove: "agent:threads:remove",
      fork: "agent:threads:fork"
    }
  }
} as const;

/** Main process to renderer. Not invoked; the preload bridge subscribes. */
export const AGENT_EVENT_CHANNEL = "agent:event";

/** Main process to renderer: a watched library path changed on disk. */
export const LIBRARY_EVENT_CHANNEL = "library:event";

export interface LibraryChangeEvent {
  /** Library-relative paths, already debounced into one batch. */
  paths: string[];
  at: string;
}

export interface LibraryInfo {
  root: string;
  deviceId: string;
  deviceName: string;
  /** Browser builds disclose durability; desktop folders omit it. */
  storage?: StorageSummary;
}

export interface StudioError {
  code: string;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: StudioError };

export interface DraftInput {
  bookId: string;
  chapterId: string;
  content: string;
  baseVersion: number;
  baseHash: string;
}

export interface SaveChapterInput {
  bookId: string;
  chapterId: string;
  content: string;
  baseVersion: number;
  baseHash: string;
}

export interface ChapterMetaPatch {
  title?: string;
  synopsis?: string;
  purpose?: string;
  notes?: string;
  arc?: "beginning" | "middle" | "end";
  order?: number;
  isPrologue?: boolean;
  color?: string | null;
}

/** The only bridge between the renderer and the filesystem. Nothing here takes a raw path. */
export interface ArchiveExportSummary {
  path: string;
  entryCount: number;
  expandedBytes: number;
}

export interface ArchiveImportSummary {
  library: LibraryInfo;
  bookCount: number;
}

export interface StudioApi {
  app: {
    info(): Promise<Result<BuildMetadata>>;
  };
  library: {
    choose(): Promise<Result<LibraryInfo | null>>;
    open(folder: string): Promise<Result<LibraryInfo>>;
    current(): Promise<Result<LibraryInfo | null>>;
    reveal(): Promise<Result<null>>;
    importLegacy(): Promise<Result<LegacyImportReport | null>>;
    exportArchive(): Promise<Result<ArchiveExportSummary | null>>;
    importArchive(): Promise<Result<ArchiveImportSummary | null>>;
    /** Notifies when a book or trash file changed outside the studio. Returns an unsubscribe. */
    onChange(callback: (event: LibraryChangeEvent) => void): () => void;
  };
  books: {
    list(): Promise<Result<BookSummary[]>>;
    create(input: { title: string; description?: string }): Promise<Result<BookMeta>>;
    update(bookId: string, patch: Partial<BookMeta>): Promise<Result<BookMeta>>;
    delete(bookId: string): Promise<Result<{ trashedAt: string }>>;
    open(bookId: string): Promise<Result<BookDetail>>;
    exportDocx(bookId: string): Promise<Result<string | null>>;
    search(bookId: string, query: string): Promise<Result<SearchHit[]>>;
  };
  chapters: {
    create(bookId: string, input: { title?: string }): Promise<Result<Chapter>>;
    save(input: SaveChapterInput): Promise<Result<SaveChapterResult>>;
    updateMeta(bookId: string, chapterId: string, patch: ChapterMetaPatch, expected: { baseVersion: number; baseHash: string }): Promise<Result<SaveChapterResult>>;
    reorder(bookId: string, chapterId: string, direction: ReorderDirection): Promise<Result<ReorderChapterResult>>;
    /** Move one chapter to a position in the current order (the drag path). */
    move(bookId: string, chapterId: string, targetIndex: number): Promise<Result<ReorderChapterResult>>;
    delete(bookId: string, chapterId: string): Promise<Result<null>>;
  };
  conflicts: {
    list(bookId: string): Promise<Result<ChapterConflict[]>>;
    reveal(bookId: string, savedAs: string): Promise<Result<null>>;
  };
  drafts: {
    set(input: DraftInput): Promise<Result<null>>;
    clear(bookId: string, chapterId: string): Promise<Result<null>>;
  };
  providers: {
    list(): Promise<Result<ProviderDescription[]>>;
    models(connectionId: string): Promise<Result<Catalogue>>;
  };
  connections: {
    list(): Promise<Result<ConnectionSummary[]>>;
    /** False when the operating system's protected storage cannot encrypt a secret. */
    available(): Promise<Result<boolean>>;
    /** Non-secret health check: protected storage, backend label, connection count. */
    status(): Promise<Result<CredentialStatus>>;
    /** Validate a key with the provider before saving it. Rejected keys are never stored. */
    addKey(input: { provider: ProviderId; secret: string; label?: string; baseUrl?: string }): Promise<Result<ConnectionSummary>>;
    /** Opens the system browser and resolves when the author finishes signing in. */
    startOpenRouter(): Promise<Result<ConnectionSummary>>;
    cancelOpenRouter(): Promise<Result<null>>;
    remove(connectionId: string): Promise<Result<null>>;
    test(connectionId: string): Promise<Result<{ message: string }>>;
  };
  usage: {
    summary(bookId: string): Promise<Result<UsageSummary>>;
  };
  voice: {
    /** Connections that can accept audio. Empty means dictation is not configured. */
    connections(): Promise<Result<ConnectionSummary[]>>;
    transcribe(input: {
      connectionId?: string;
      /** Mono 16-bit PCM WAV at 16 kHz or 24 kHz. The main process validates it. */
      audio: ArrayBuffer;
      languageBias?: string[];
      keywords?: string[];
    }): Promise<Result<VoiceTranscript>>;
  };
  images: {
    list(bookId: string): Promise<Result<ImageList>>;
    /** The record plus a data URL for a preview. No secret or host path is included. */
    read(bookId: string, imageId: string): Promise<Result<{ record: ImageRecord; dataUrl: string } | null>>;
    generate(input: {
      bookId: string;
      chapterId?: string;
      connectionId?: string;
      prompt: string;
      size?: ImageSize;
    }): Promise<Result<ImageRecord>>;
    attach(bookId: string, imageId: string, chapterId: string): Promise<Result<ImageRecord>>;
    remove(bookId: string, imageId: string): Promise<Result<null>>;
    saveCutout(input: {
      bookId: string;
      sourceImageId: string;
      bytes: ArrayBuffer;
      prompt: string;
      confidence?: number | null;
      characterId?: string | null;
    }): Promise<Result<ImageRecord>>;
    attachCharacter(bookId: string, imageId: string, characterId: string): Promise<Result<ImageRecord>>;
  };
  segmentation: {
    segment(input: {
      bookId: string;
      imageId: string;
      connectionId?: string;
      prompt: string;
    }): Promise<Result<SegmentationResult>>;
  };
  agent: {
    start(input: AgentTurnInput): Promise<Result<AgentTurnStarted>>;
    stop(turnId: string): Promise<Result<null>>;
    undoLast(bookId: string): Promise<Result<{ restored: number; skipped: number }>>;
    approve(turnId: string, approvalId: string, approved: boolean): Promise<Result<null>>;
    threads: {
      list(bookId: string): Promise<Result<ThreadSummary[]>>;
      read(bookId: string, threadId: string): Promise<Result<AgentThread | null>>;
      rename(bookId: string, threadId: string, title: string): Promise<Result<AgentThread>>;
      remove(bookId: string, threadId: string): Promise<Result<null>>;
      fork(bookId: string, threadId: string, turnId: string): Promise<Result<AgentThread>>;
    };
    onEvent(callback: (event: AgentEvent) => void): () => void;
  };
  menu: {
    onOpenLibrary(callback: () => void): () => void;
  };
  platform: string;
}
