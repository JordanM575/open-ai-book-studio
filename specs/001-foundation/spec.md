# 001 — Foundation: library, file format, editor

**Status:** Implemented · **Date:** 2026-10-24 · **Supersedes:** the earlier prototype's specs 001–012
(as a whole approach, not individually)

## Why

The previous app kept an entire library in one `localStorage` value, written whole on every save, and
needed a server to talk to a model. That design lost work, could not sync, and could not become a
product. This spec establishes the smallest thing that is genuinely better: a folder of plain files,
owned by the author, edited by a quiet desktop app that never overwrites another writer.

This is the foundation everything else stands on. There is no agent here, no export, no sync
provider — only the files, the library, the editor, and the guarantees about them.

## Who

An author with a book in progress who may write on more than one machine and who wants their prose to
outlive any app. They are not expected to know what a schema is.

## User stories

1. As an author, I choose a folder once and see every book inside it, so I can keep a whole series in
   one place.
2. As an author, I create a book and open it, so I can start writing within a minute of launching.
3. As an author, I write in a calm page that saves as I type, so I never think about saving.
4. As an author, I add, open and delete chapters from a rail, so I can move around a long book.
5. As an author writing on two machines, I am told when a file changed elsewhere and my text is kept
   as a copy, so I never lose a page to a sync client.
6. As an author, I can show the folder in Finder and read the same book with any text editor, so I
   trust that it is mine.
7. As an author whose app crashed mid-sentence, I find my last few words already on disk when I
   reopen.

## Functional requirements

- **FR-001** The app opens with a welcome screen when no library is remembered, and offers to choose a
  folder.
- **FR-002** The chosen folder is remembered across launches; if it is unavailable at startup the app
  shows the welcome screen with an explanation instead of failing to start.
- **FR-003** The library lists every valid book with title, description, chapter count, word count and
  stage, most recently updated first; a damaged `book.json` is skipped and does not prevent the rest
  from loading.
- **FR-004** The author can create a book with a title and optional description; it is created with an
  empty chapter list and opens immediately.
- **FR-005** A book is stored as `books/<bookId>/book.json` plus `chapters/NNNN-slug.md`, with
  `book.json` carrying concept, outline, cast, memories and manuscript settings.
- **FR-006** Each chapter file is YAML front matter (identity, order, metadata, version, timestamps)
  followed by Markdown prose; the prose is stored verbatim apart from line-ending normalisation and
  trailing-newline trimming.
- **FR-007** A chapter file without front matter still opens: its identity is derived deterministically
  from the filename and healed on the next save.
- **FR-008** Typing is saved after a short idle period, on blur, on Cmd/Ctrl+S, when switching chapters
  and when the window closes; the save state is always visible.
- **FR-009** Saves are idempotent: writing identical text does not increment the version.
- **FR-010** A save is refused, and the author's text preserved as a conflict copy, when the file on
  disk has a higher version or different content hash than the one the editor loaded.
- **FR-011** The interface explains a conflict, offers to reveal the saved copy, and offers to load the
  version on disk.
- **FR-012** Deleted chapters move to `.studio/trash/<bookId>/` and are recoverable by hand.
- **FR-013** Unfinished keystrokes are buffered by the main process and flushed through the normal save
  path before the app quits or the window closes.
- **FR-014** Files are written atomically: a temporary sibling file is flushed and renamed into place.
- **FR-015** A library written by a newer schema version is refused with an instruction to update the
  app, never partially read.
- **FR-016** `library.json` is a derived catalog; deleting it loses nothing.
- **FR-017** The renderer has no filesystem access; it reaches the main process only through the
  documented `window.studio` surface, and every channel validates its input.
- **FR-018** The interface follows the Liquid Glass design tokens and the copy rules in
  `docs/DESIGN.md`, including dark mode, reduced transparency, reduced motion and keyboard focus.

## Acceptance criteria

- `pnpm typecheck` passes for both TypeScript projects.
- `pnpm test` covers round-trip, idempotent save, both conflict reasons, trash deletion, damaged book
  skipping, newer-schema refusal, no-front-matter prose and path escape rejection.
- `pnpm smoke` builds the app and verifies, in a hidden window: preload surface, library listing,
  opening a book, typing, and autosave reaching disk with an incremented version.
- A library folder can be read, edited and re-opened with a text editor and the app without loss.
- Killing the app while typing loses at most the debounce window (≤ 700 ms), not the session.

## Non-goals

- AI drafting, the writing agent, prompts, models, token accounting (spec 003).
- Onboarding wizard, Story Bible UI, character and memory editing (spec 002).
- Library-wide search, conversations, usage history (spec 004).
- Export to DOCX/PDF/EPUB and print layout (spec 005).
- Real-time collaboration, hosted sync, mobile apps.
- Importing the previous app's `localStorage` export (deliberately deferred; the old repository keeps
  the importer).
- Code signing, notarisation, auto-update (spec 007).
