# Feature Specification: AI Book Studio v1

**Feature Branch**: `002-studio-v1`

**Status**: Draft

**Input**: User description: "White-room spec the whole thing… adopt a well-known SDK harness instead of our own agent harness… port from old version to new version… introduce all the feedback items CLAUDE had collected related to voice, images etc."

## Overview

AI Book Studio is a quiet desktop writing studio for one author and one book at a time. It keeps the
manuscript as ordinary files the author owns, helps them plan and write with an agent that edits
through tools, illustrates the book, reads it aloud, and exports it for publication — without an
account, a server, or custody of the author's work.

This specification replaces the earlier prototype's product definition. It is the
white-room statement of what version 1 must do, written from the author's side of the screen. The
earlier studio's defect log (F-001…F-050) is treated as evidence about what authors need; every
item is dispositioned in `docs/FEEDBACK-DISPOSITION.md`, and the requirements below already assume
those lessons.

## Clarifications

No open clarifications. Where the inherited product left a decision unresolved, this specification
decides it and records the choice under Assumptions, so that planning can proceed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write in a manuscript that is really mine (Priority: P1)

An author opens the studio for the first time, points it at a folder (in iCloud Drive, Google Drive,
Dropbox, or anywhere on disk), creates a book, and writes. The chapter appears in a rail, the page is
solid and calm, and the save state is always visible. If they open the same folder on another
machine, the book is there. If they open a chapter in another editor and change it, the studio keeps
both versions instead of choosing silently.

**Why this priority**: Without a trustworthy place to type, nothing else matters. This story alone is
a usable Markdown writing app and is the foundation every later story edits.

**Independent Test**: Create a library in a temp folder, write two chapters, quit, reopen the folder
on a second profile; both chapters and the save state survive, and an out-of-band edit produces a
visible conflict rather than lost text.

**Acceptance Scenarios**:

1. **Given** no library has been chosen, **When** the studio starts, **Then** it offers one action —
   choose a folder — and explains in one sentence where books will live.
2. **Given** a library is open, **When** the author types in a chapter, **Then** the save state moves
   from "Saving" to "Saved" within two seconds and the file on disk contains the new text.
3. **Given** a chapter was changed on disk while the studio held older text, **When** the author
   saves, **Then** the studio writes the author's version to a conflict copy, keeps the disk version
   intact, and offers to show the saved copy or load the disk version.
4. **Given** the author quits with unsaved typing, **When** the app relaunches, **Then** the typing is
   present, not lost.
5. **Given** a chapter is deleted, **When** the author confirms, **Then** the file leaves the book and
   is recoverable from the library's trash.

---

### User Story 2 - Plan the book before and while writing (Priority: P1)

The author describes the book once — idea, genre, audience, tone, length, influences — and keeps
working on it later in a Story Bible tab beside the manuscript: premise, outline, cast, world notes,
saved memories, and per-chapter intentions. The agent reads the same bible, so advice and drafts stay
consistent with the book the author is actually writing.

**Why this priority**: The inherited product split setup from drafting and then made setup
unreachable; authors returned to change a character and could not. A returnable bible is the minimum
for coherent long-form work.

**Independent Test**: Change a character's motivation after ten chapters and ask the agent to revise
a scene; the revision reflects the new motivation without re-running setup.

**Acceptance Scenarios**:

1. **Given** a new book, **When** the author finishes the minimum fields (title, idea, genre), **Then**
   they can start writing immediately and nothing blocks them on optional fields.
2. **Given** a drafting book, **When** the author opens Story Bible, **Then** premise, outline, cast
   and memories are editable in place and save like the manuscript.
3. **Given** a character exists, **When** the author removes them, **Then** the studio asks for
   confirmation and says what will happen to references in the outline.
4. **Given** the author writes a note they want remembered ("the river floods in spring"), **When**
   they save it as a memory, **Then** the agent can rely on it in later turns and the author can edit
   or remove it.

---

### User Story 3 - Write with an agent that edits the manuscript (Priority: P1)

The author asks for a scene, a revision, a continuity check, or a change to structure. The agent reads
the relevant chapters, proposes prose, and makes changes through named editing tools. The author sees
what changed, can undo the whole turn as one step, and is never locked out of their own text.

**Why this priority**: The agent is the reason this is a studio rather than an editor. It must be
safe before it is clever.

**Independent Test**: Ask the agent to rewrite one paragraph; the paragraph changes, the reply names
the chapter in the author's terms, the turn appears as a single undo, and a checkpoint can restore the
chapter to its previous state after a reload.

**Acceptance Scenarios**:

1. **Given** a chapter is open, **When** the author asks for a specific revision, **Then** the change
   lands in the chapter through a tool, the reply is short and free of identifiers, and the chat shows
   a friendly summary rather than raw tool payloads.
2. **Given** the agent is running, **When** the author types, **Then** the studio shows that the agent
   is editing, lets the author stop it, and reconciles the author's own edits rather than overwriting
   them.
3. **Given** an agent turn changed three chapters, **When** the author chooses undo, **Then** all three
   return to their pre-turn state as one action.
4. **Given** the author asks to delete a chapter or overwrite a whole chapter, **When** the agent
   proposes it, **Then** the studio asks the author first and the action is recorded in the turn.
5. **Given** the agent cannot do something (no tool, refused content, model without tool support),
   **When** it replies, **Then** it says plainly what it did instead and what the author can change.
6. **Given** a long conversation, **When** context grows, **Then** the studio shows honest usage and
   cost, sends only the paragraphs a change needs, and never reports $0.00 for an unknown price.

---

### User Story 4 - Bring an existing manuscript in (Priority: P2)

The author has a finished or half-finished book in Word, in another app, or in the earlier app's
export. They import it, see a preview of how chapters will split, confirm, and get a book whose
chapter files match the new format. The earlier export's cast, memories, cover, images and settings come
across where they can, and a report says what did not.

**Why this priority**: Existing authors are the first audience; a studio that cannot accept their work
is a demo. It is P2 because the writing loop must exist first.

**Independent Test**: Import a Word manuscript with headings and an earlier JSON export; both produce
books that open, save and export, and the migration report lists every mapped and skipped item.

**Acceptance Scenarios**:

1. **Given** a .docx with heading-based chapters, **When** the author imports it, **Then** they see the
   proposed splits, can merge or split further, and confirm before anything is written.
2. **Given** a legacy export, **When** the author imports it, **Then** every book becomes a folder,
   every chapter becomes a Markdown file, and cast, memories, settings and images are carried across.
3. **Given** a migration is run twice on the same export, **When** it finishes, **Then** the second run
   changes nothing and reports the books it recognised.
4. **Given** an item cannot be migrated, **When** the run finishes, **Then** the report names it and the
   original export remains untouched.
5. **Given** an author pastes a long chapter, **When** it lands in the editor, **Then** smart quotes,
   spacing and paragraph breaks are normalised without destroying verse or deliberate line breaks.

---

### User Story 5 - Read and listen (Priority: P2)

The author can have the studio read the manuscript aloud while they follow the page, using the
system's voices by default and an optional premium voice if they add a key. They can also dictate into
the page. Reading position follows the text, works offline with system voices, and never sends prose
anywhere without the author's explicit choice of a cloud voice.

**Why this priority**: Voice is a core part of how this author works, and the inherited product had it
in two disconnected halves (browser read-aloud, premium read-aloud) with dictation missing from the
new design.

**Independent Test**: With no network, read a chapter with a system voice and dictate a sentence;
then add a premium voice key and confirm the same chapter can use it, with the key never leaving the
machine except to the voice provider.

**Acceptance Scenarios**:

1. **Given** a chapter is open, **When** the author starts reading, **Then** the current paragraph is
   highlighted and follows the voice, and stopping resumes from that paragraph.
2. **Given** no premium key, **When** the author opens voice settings, **Then** system voices are
   offered first and the premium option explains what a key enables and where it is stored.
3. **Given** a premium key is saved, **When** the studio restarts, **Then** the key is still available
   for use and is not stored in the book folder or in plain text.
4. **Given** the author dictates, **When** speech ends, **Then** the text appears at the cursor with
   punctuation and without overwriting the selection.
5. **Given** a voice request fails, **When** the error returns, **Then** the author sees what failed and
   can switch to a system voice without losing their place.

---

### User Story 6 - Illustrate the book (Priority: P2)

The author sets one style for the book, asks for a cover and an illustration for each chapter or poem,
sees the cost of a batch before running it, and regenerates or replaces any picture. Pictures live as
image files in the book folder, appear where the author expects, and can be saved all at once for a
publisher that wants images separate from the manuscript.

**Why this priority**: For the poetry book this product was born from, illustrations are part of the
book, not decoration. It follows the writing loop because it depends on finished text.

**Independent Test**: With a five-chapter book, set a style, generate a batch with a shown cost, refuse
one image, regenerate it, replace another with a file from disk, and export every image as JPEG.

**Acceptance Scenarios**:

1. **Given** a book with no style, **When** the author opens illustrations, **Then** the studio asks for
   one style sentence and shows which chapters have no picture.
2. **Given** a batch is about to run, **When** the author reviews it, **Then** the number of images, the
   model, and the estimated cost are shown, and nothing is generated until they confirm.
3. **Given** a provider refuses a prompt, **When** the error returns, **Then** the studio says the
   request was refused by policy, keeps the chapter text, and offers another model or a rewritten prompt.
4. **Given** an image exists, **When** the author replaces or regenerates it, **Then** the old file is
   kept until the new one is written and the book's image budget is updated.
5. **Given** the author exports images, **When** the export finishes, **Then** every picture is a
   correctly named JPEG in a folder beside the manuscript, and the word-processor export places each
   picture on its own page where the book's layout allows.
6. **Given** the book reaches its image budget, **When** the author asks for more, **Then** the studio
   explains the limit and offers to raise it.

---

### User Story 7 - Export for publication (Priority: P2)

The author exports the book as a Word document, a PDF, an EPUB, or a folder of Markdown, with the
manuscript settings a print publisher expects (trim size logic, font, size, indent, spacing, chapter
title alignment, table of contents). Front matter and back matter — title page, dedication,
disclaimer, about the author — travel with the book. Export never mutates the manuscript.

**Why this priority**: The product exists to produce a publishable book. P2 because the writing and
illustration loops must settle first.

**Independent Test**: Export a book with front matter, three chapters and two pictures; open the DOCX
in a word processor and confirm chapter breaks, indents, title alignment, TOC and image pages, with
the manuscript unchanged afterwards.

**Acceptance Scenarios**:

1. **Given** a finished book, **When** the author exports, **Then** they choose a format and a
   destination, and the studio reports the file it wrote.
2. **Given** manuscript settings, **When** the book is exported, **Then** the settings affect only the
   exported file and the chapter files stay Markdown.
3. **Given** front or back matter fields are filled, **When** the book is exported, **Then** those
   sections appear in the order the author set, with standard disclaimer templates available.
4. **Given** a book with images, **When** it is exported to Word, **Then** each image page appears as
   its own page and the image files are also exported separately.
5. **Given** an export fails partway, **When** the error returns, **Then** no half-written file is left
   in place of a previous export.

---

### User Story 8 - Keep devices in step without a cloud account (Priority: P3)

The author keeps the library in a folder their sync provider already watches. Two machines edit
different chapters and the files converge. When the same chapter is edited in both places, the author
sees a conflict they can resolve, with both texts preserved and attributed to a device.

**Why this priority**: Sync is the hardest promise and the least necessary for a single-machine author.
The design must make it honest rather than perfect.

**Independent Test**: Simulate two devices writing the same chapter with different base versions; both
texts survive, the conflict is listed, and resolving it produces one file with the chosen text.

**Acceptance Scenarios**:

1. **Given** a library in a synced folder, **When** another device writes a chapter, **Then** the studio
   notices on next open and shows the newer version without discarding local work.
2. **Given** a provider creates a "conflicted copy" file, **When** the library is opened, **Then** the
   studio lists it as a conflict and offers to compare or keep the provider's copy.
3. **Given** a chapter file is missing or unreadable, **When** the book loads, **Then** the book still
   opens, the damaged item is reported, and no other chapter is touched.
4. **Given** a conflict is resolved, **When** the author confirms, **Then** the chosen text is written
   once and the other version is retained until the author discards it.

---

### User Story 9 - Trust the studio with a book (Priority: P3)

The author can see what the studio stores, where it stores it, and what leaves the machine. The
OpenRouter key is kept in the operating system's protected storage, never in the book folder, and
never logged. There is no telemetry. Destructive actions ask first, and everything removed is
recoverable for a reasonable period.

**Why this priority**: Trust is a precondition for adoption, but it is delivered by consistent
behaviour across the other stories rather than by a screen of its own.

**Independent Test**: Inspect the library folder and app settings after a week of use: no key material,
no analytics identifiers, deletions in trash, and a settings screen that states each fact truthfully.

**Acceptance Scenarios**:

1. **Given** a key is saved, **When** the author inspects the library folder, **Then** no key material
   is present anywhere in it.
2. **Given** the author opens Settings, **When** they read the privacy section, **Then** every claim
   matches observable behaviour (network calls, stored files, deletion).
3. **Given** the author chooses "remove key", **When** they confirm, **Then** the key is deleted from
   protected storage and the studio can no longer call a model until a new key is added.
4. **Given** the studio is offline, **When** the author writes, plans and exports, **Then** everything
   except agent and cloud-voice features works.

---

### User Story 10 - Use the studio in a browser (Priority: P3)

The author opens the studio in a browser on a machine where they cannot install an application. In a
Chromium-based browser they pick a real folder and work with the same files as the desktop app. In
Safari or Firefox the library lives in the browser's own storage, and the author can export it as an
archive to keep or move.

**Why this priority**: The desktop build is the reference and the only one with every guarantee. A
browser build widens access, but it must never pretend to be as durable as the desktop.

**Independent Test**: In Chromium, open a folder, edit a chapter, restart the browser and reopen the
library: the edit is there and the file on disk changed. In Firefox, do the same in browser storage,
export the archive, and import it into the desktop app with identical text.

**Acceptance Scenarios**:

1. **Given** a Chromium-based browser, **When** the author chooses a folder, **Then** the studio writes
   the same `book.json` and chapter files as the desktop build, and the choice survives a restart once
   permission is granted again.
2. **Given** a browser without folder access, **When** the author opens the studio, **Then** the library
   is created in the browser's own storage, the interface says so plainly, and exporting an archive is
   offered next to every warning about clearing site data.
3. **Given** the author closes a tab with unsaved typing, **When** the tab is hidden or closed, **Then**
   the studio attempts a final save and, on the next open, reports anything it could not save.
4. **Given** an archive exported from a browser build, **When** it is imported into the desktop app,
   **Then** books, chapters, ids and planning data are identical.

---

### Edge Cases

- Library folder lives on an external disk that is unplugged mid-save.
- A browser denies or revokes permission to the chosen folder, or the author clears site data.
- Two browser tabs open the same library at once.
- Two copies of the studio open the same library at once.
- A chapter file has no front matter, unknown front-matter keys, or YAML that will not parse.
- A book was written by a newer version of the studio (schema ahead of this build).
- The library contains hundreds of books, or one book with 250,000 words and 120 chapters.
- A sync provider creates duplicate files, conflicted copies, or a placeholder that is not yet
  downloaded.
- A chapter is edited outside the studio while the agent is mid-turn.
- The agent's model changes mid-book, or a model stops supporting tools.
- The provider returns a rate limit, a refusal, a truncated stream, or a price the studio cannot read.
- The author's disk is full or read-only.
- An image generation is paid for but the app quits before the file is written.
- The author closes the window with a premium voice or agent request in flight.
- A legacy export is malformed, enormous, or from a different application.
- The author runs an export into the library folder itself.

## Requirements *(mandatory)*

### Library and files

- **FR-001**: The studio MUST keep each book as a folder of human-readable files, with one file per
  chapter and a book-level file for planning data, and MUST NOT require a database to read a book.
- **FR-002**: The studio MUST let the author choose the library folder, remember it, and change it
  without moving or deleting any book.
- **FR-003**: The studio MUST show, for every book, its title, description, chapter count, word count
  and stage, and MUST open a book without loading every chapter's full text into the interface at once.
- **FR-004**: The studio MUST write files atomically, so an interrupted write never leaves a truncated
  chapter or book file.
- **FR-005**: The studio MUST NOT overwrite a file that changed since it was read; it MUST preserve the
  author's version as a conflict copy and keep the disk version intact.
- **FR-006**: The studio MUST move deleted chapters and books to a recoverable trash inside the library
  and MUST ask before deleting.
- **FR-007**: The studio MUST tolerate missing, unreadable or foreign files inside a book, reporting
  them without preventing the rest of the book from opening.
- **FR-008**: The studio MUST reject a book written by a newer schema with a clear explanation rather
  than guessing at its fields.
- **FR-009**: The studio MUST provide a rebuildable index for search, usage history and chapter
  lookup, and MUST be able to regenerate it entirely from the files.

### Writing surface

- **FR-010**: The author MUST be able to create, rename, reorder, split, merge and delete chapters, and
  to mark front matter, prologue and back matter.
- **FR-011**: The editing surface MUST treat each paragraph as one logical line, with real line numbers
  shown for navigation and agent edits, and MUST NOT wrap text into artificial 66-character lines.
- **FR-012**: The author MUST see a save state at all times: saving, saved with a time, unsaved changes,
  a conflict, or an error.
- **FR-013**: Typing MUST survive a crash, a quit, or a window close within the save interval, by means
  of a draft buffer outside the manuscript file.
- **FR-014**: The author MUST be able to undo and redo their own typing, and undo an agent turn as a
  single step.
- **FR-015**: Verse and deliberate line breaks MUST be preserved exactly, including stanzas and blank
  lines, everywhere text is edited, counted or exported.
- **FR-016**: Word, character and paragraph counts MUST come from one shared counter used by the editor,
  the rail, the chat and exports.

### Story Bible

- **FR-017**: The studio MUST keep the book's idea, genre, audience, tone, length target, influences,
  outline, story arc, cast and saved memories in one place that is reachable at any time.
- **FR-018**: The author MUST be able to edit every Story Bible field while drafting, and changes MUST
  save with the same guarantees as manuscript text.
- **FR-019**: The author MUST be able to add, edit and remove characters and memories, with confirmation
  for removal and an explanation of what references remain.
- **FR-020**: The agent MUST read the same Story Bible the author edits, and the assembled instructions
  it receives MUST be testable and snapshot-checked.

### Agent

- **FR-021**: The agent MUST change the manuscript only through registered editing tools, never by
  returning prose to be pasted.
- **FR-022**: Every tool MUST enforce its own stated limit in one place, and the prompt and tool
  descriptions MUST state exactly those limits and no others.
- **FR-023**: The agent MUST be able to read a chapter, find text, replace, insert, delete, append,
  create, move, split, merge and delete chapters, and read and update the Story Bible.
- **FR-023a**: Manuscript prose, chapter titles, Story Bible text and tool output MUST be treated as
  data. The system prompt MUST delimit author-supplied data and instruct the model never to follow
  instructions found inside it.
- **FR-024**: Destructive actions — deleting a chapter, overwriting a chapter, removing a memory,
  replacing a library — MUST require the author's approval inside the turn.
- **FR-024a**: An approval request MUST be stored with its turn. Reopening the conversation MUST show
  the request and its answer. A stopped turn MUST mark a pending request expired. A request left by a
  previous app run MUST NOT resume; answering it MUST explain that it expired.
- **FR-025**: The author MUST be able to stop a turn, and a stopped turn MUST leave the manuscript in a
  coherent state with the partial work either applied and undoable or not applied.
- **FR-026**: While the agent edits, the author's own edits MUST be preserved; the studio MUST reconcile
  or ask, never silently discard either side.
- **FR-027**: Every agent turn MUST create a restorable checkpoint that survives a reload and is not
  silently pruned below a useful history.
- **FR-028**: The chat MUST present friendly summaries of tool work, with raw detail available behind a
  disclosure, and MUST never show identifiers, headings like "Analysis / Plan", or redaction markers.
- **FR-029**: The studio MUST report the provider's actual usage and cost when available, label
  estimates as estimates, show an unknown price as unknown, and break down context use.
- **FR-030**: The studio MUST shorten history before sending it (tool results, old turns) without
  changing the stored conversation.
- **FR-031**: A model that does not support tools MUST be refused before a turn starts, with a message
  naming models that work.
- **FR-032**: The base system prompt MUST stay under 4,000 tokens, with budget tests that fail the
  build when it grows beyond the limit.
- **FR-033**: The agent MUST answer in the author's terms: chapter numbers and titles from the sidebar,
  no tool names, no identifiers, no more than a short paragraph unless asked for analysis.
- **FR-034**: The agent MUST check a word or length constraint after a rewrite and report the saved
  count.

### Import and migration

- **FR-035**: The author MUST be able to import Word documents with chapter detection, a preview of the
  split, and a confirmation step before writing.
- **FR-036**: The author MUST be able to paste long text and have whitespace, smart quotes and paragraph
  breaks normalised without harming verse.
- **FR-037**: The studio MUST migrate the previous application's export into the new library format,
  one way, without modifying the export, and MUST produce a report of mapped and skipped items.
- **FR-038**: Migration MUST be idempotent: running it twice on the same export MUST NOT duplicate books
  or chapters.
- **FR-039**: Migration MUST carry across title, idea, outline, story arc, cast, memories, chapter text,
  manuscript settings, front and back matter, cover and images where present, preserving identifiers
  where the new format allows and generating stable new ones where it does not.

### Reading, voice and dictation

- **FR-040**: The author MUST be able to have any chapter read aloud, with the spoken paragraph visibly
  followed, pause/resume, speed control, and a choice of system voices that work offline.
- **FR-041**: The studio MAY offer a premium cloud voice when the author supplies a key; the key MUST be
  stored in protected storage, and the studio MUST state when prose is sent to that provider.
- **FR-042**: The author MUST be able to dictate into the manuscript, inserting at the cursor without
  destroying the selection, using on-device recognition by default.
- **FR-043**: A voice failure MUST leave the author in place, explain what failed, and offer a fallback
  voice.

### Images

- **FR-044**: The author MUST be able to set one illustration style per book and request a cover, a
  frontispiece, and one illustration per chapter or poem.
- **FR-045**: The studio MUST show the number of images, the model and the estimated cost before a batch
  runs, and MUST let the author cancel a batch in progress.
- **FR-046**: The author MUST be able to preview, regenerate, replace from disk, and remove any image;
  removing MUST NOT delete the file until confirmed.
- **FR-047**: Images MUST be stored as files in the book folder, with names that identify the chapter
  and purpose, and MUST NOT be stored as base64 inside the book file.
- **FR-048**: A content-policy refusal MUST be reported plainly, with the affected chapter kept and an
  offer of another model or a rewritten prompt.
- **FR-049**: The studio MUST enforce and explain a per-book image budget, and MUST never lose a paid
  image because a dialog closed or the app quit.
- **FR-050**: The author MUST be able to export all images as JPEGs in one action, separately from the
  manuscript.

### Export

- **FR-051**: The studio MUST export DOCX, PDF, EPUB and Markdown, and MUST report the destination of
  every file it writes.
- **FR-052**: Export MUST honour manuscript settings (font, size, indent, spacing, title alignment,
  chapter breaks, table of contents, page size) without changing chapter files.
- **FR-053**: Front matter and back matter MUST be editable, orderable, included in exports, and
  supplied with standard disclaimer templates.
- **FR-054**: Image pages MUST be placed in book order and, in paged formats, on their own page; a
  separate image folder MUST accompany the manuscript export.
- **FR-055**: A failed export MUST leave any previous export intact and clean up its partial output.
- **FR-056**: The studio MUST let the author export a whole library as a portable archive and import it
  back, for backup.

### Sync and devices

- **FR-057**: The studio MUST identify the device that wrote a version and record it with the version.
- **FR-058**: The studio MUST detect provider conflict files and version mismatches, and MUST present
  them as conflicts with both texts available.
- **FR-059**: Resolving a conflict MUST require an explicit choice and MUST retain the losing text until
  the author discards it.
- **FR-060**: The studio MUST NOT require an account, a server, or an internet connection for any
  writing, planning, importing or exporting activity.

### Trust, privacy and settings

- **FR-061**: The studio MUST NOT collect telemetry, analytics or usage data, and MUST NOT send prose
  anywhere without an explicit author action naming the destination.
- **FR-062**: The OpenRouter key and any voice-provider key MUST be stored in the operating system's
  protected storage, MUST never be written to the library, logs, crash reports or exports, and MUST be
  removable in one action.
- **FR-063**: Every privacy statement shown to the author MUST describe the behaviour of the build it
  ships in, and MUST be covered by a test that fails when storage or network behaviour changes.
- **FR-064**: Settings MUST cover library location, appearance, models and usage, voice, data and
  privacy, and about, and every item shown MUST work.
- **FR-065**: The author MUST be able to reveal any book folder in the operating system's file manager.

### Reliability and recovery

- **FR-066**: The studio MUST recover from a crash on launch without losing accepted text, and MUST
  report what it recovered.
- **FR-067**: Every error MUST leave the interface usable; a failed request MUST NOT leave a chat or an
  editor in a permanent busy state.
- **FR-068**: The studio MUST show a recoverable error screen, with a reload action, if the interface
  fails to render.
- **FR-069**: The studio MUST refuse to run a second writer against the same library from the same
  machine profile without warning.
- **FR-070**: The studio MUST be usable with a keyboard alone, with visible focus, and MUST respect the
  operating system's reduced-motion, reduced-transparency and contrast preferences.

### Browsers and platforms

- **FR-071**: The book format, the save protocol and the conflict rules MUST live in code shared by
  every build, so a book written by one build opens in another without conversion.
- **FR-072**: The web build MUST offer real-folder access where the browser supports the File System
  Access API, MUST write through the same atomic-replace discipline as the desktop build, and MUST
  remember the chosen folder across sessions subject to the browser's permission rules.
- **FR-073**: Browsers without folder access MUST store the library in origin-private storage with the
  same directory layout, MUST tell the author that the library belongs to this browser and this site,
  and MUST offer a library archive export at the point where clearing site data is discussed.
- **FR-074**: The web build MUST disclose its weaker guarantees in the interface: no guaranteed draft
  recovery after a tab is killed, best-effort final save on hide and unload, no operating-system
  keychain, and no system speech voices beyond what the browser provides.
- **FR-075**: The web build MUST call the model provider directly with the author's own key; there MUST
  be no proxy operated by us that sees the key or the prose.
- **FR-076**: The studio MUST be able to move a whole library between desktop, browser folder and
  browser storage through the portable archive, preserving book and chapter identities.

### Key Entities

- **Library**: the chosen folder; contains books, trash, device identity and a derived catalog.
- **Book**: identity, title, description, genre, audience, tone, influences, length target, stage,
  outline, story arc, cast, memories, manuscript settings, front and back matter, images.
- **Chapter**: identity, title, order, role (front matter, prologue, chapter, back matter), synopsis,
  purpose, version, timestamps, and Markdown text.
- **Character**: identity, name, role, description, motivations, notes, and optional portrait image.
- **Memory**: a short fact the author wants kept, with importance and timestamps.
- **Image**: identity, kind (cover, frontispiece, chapter), chapter reference, style, model, file name,
  dimensions, and cost.
- **Conversation and turn**: messages, tool calls, usage, cost, checkpoint reference, and approvals.
- **Checkpoint**: a restorable snapshot of one or more chapters (and their planning data) tied to a turn.
- **Conflict**: book, chapter, reason, the copy kept, the disk version, and the device that wrote it.
- **Device**: identity and display name, used to explain who wrote what.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new author can go from first launch to typing in under 90 seconds, with no account and
  no documentation.
- **SC-002**: 100% of accepted typing survives a forced quit at any moment during a session.
- **SC-003**: In a two-device conflict drill, no version of a chapter is lost in 100% of runs, and the
  conflict is visible within one launch of the second device.
- **SC-004**: Opening a 120-chapter, 250,000-word book shows the chapter list in under 2 seconds and the
  first chapter in under 3 seconds on the reference machine.
- **SC-005**: Every agent turn can be undone in one action, and the checkpoint survives a restart, in
  100% of tested turns.
- **SC-006**: The base agent prompt stays under 4,000 tokens, and the full request stays under 25% of
  the selected model's context for a typical edit.
- **SC-007**: Usage shown after a turn matches the provider's reported usage within 1% when the provider
  reports it, and is labelled unknown otherwise.
- **SC-008**: Migrating a representative legacy library preserves 100% of chapter text and reports every
  skipped item; a second run changes zero files.
- **SC-009**: A 40-illustration batch can be planned with a visible cost estimate and, when the author
  cancels halfway, no paid image is lost.
- **SC-010**: A DOCX export of a book with front matter, 10 chapters and 5 images opens in a common word
  processor with correct chapter breaks, indents, title alignment, table of contents and image pages.
- **SC-011**: Reading aloud works offline with system voices, and dictation inserts at the cursor without
  losing the selection in 100% of attempts.
- **SC-012**: No key material, telemetry identifier or analytics event is discoverable in the library
  folder or application logs across a 30-day use trial.
- **SC-013**: Fewer than 1 in 20 author-visible errors requires restarting the app.
- **SC-014**: The interface passes a keyboard-only pass of the primary journeys (welcome, create book,
  write, ask the agent, export) with visible focus at every step.
- **SC-015**: In a Chromium-based browser, an author can choose a folder, edit a chapter, restart the
  browser and see the edit on disk in 100% of attempts, with only a permission prompt between sessions.
- **SC-016**: A library archive exported from a browser build imports into the desktop build with
  identical chapter text, identities and planning data in 100% of runs.

## Assumptions

- **Audience and scope**: one author per library, no real-time collaboration, no accounts. Multiple
  books per library.
- **Platforms**: the Electron application is the reference build: macOS first (Apple silicon and Intel),
  Windows and Linux in the same version 1 line, with the same feature set except operating-system voice
  lists and protected storage details. A web build shares the interface and the book format: real-folder
  access in Chromium-based browsers, origin-private storage in Safari and Firefox, with the degraded
  guarantees stated in FR-074. ADR 0009 records the storage-port design.
- **Connectivity**: writing, planning, importing, exporting and system-voice reading work offline. The
  agent, premium voices and image generation need the network and a key the author supplies.
- **Model access**: the author brings their own OpenRouter key; the studio does not resell inference
  and does not proxy it through a service we operate.
- **Agent runtime**: the tool loop is provided by a maintained agent SDK (Vercel AI SDK 7 `ToolLoopAgent`
  with the OpenRouter provider), while the tools, limits and prompts remain ours. The decision and its
  rejected alternatives are recorded in ADR 0007, including why the experimental `@ai-sdk/harness`
  runtimes are deferred: they require a sandbox and a CLI process, so they cannot run in the browser,
  and they would bypass the save protocol the product depends on.
- **Applying agent edits**: edits apply as the turn runs, each turn is one undo, and destructive actions
  ask first. The inherited "Apply / Reject proposal card" is not adopted; reviewing is done by undoing
  a turn and reading the diff.
- **Line model**: paragraphs are lines. The 66-character virtual wrap from the inherited design is
  rejected; diffs and find/replace use real line numbers.
- **Illustration placement**: one image per chapter or poem, on its own page in paged exports; images
  are also always exported as separate files for publishers that require it.
- **No emoji in chrome**: the inherited copy used emoji in tours and warnings; version 1 uses the icon
  set and words.
- **Migration is one-way**: the old application keeps working with old files; the new studio never
  writes the old format. There is no downgrade path.
- **Search**: v1 provides search across the open book; a library-wide, cross-book search is in scope only
  as far as the rebuildable index makes it cheap.
- **Sync**: the author's sync provider is responsible for moving bytes; the studio is responsible for
  writing atomically, detecting conflicts, and never choosing silently.
- **Exports**: DOCX and PDF are the primary print paths; EPUB is a reflowable companion. Amazon KDP
  requirements are the reference for print settings.
- **Model access**: providers, sign-in flows, capability detection and usage accounting are specified
  in [011-model-access](../011-model-access/spec.md). This spec states what the agent does, not how a
  key is obtained.
- **Verification**: the test layers, fixtures, live checks and gates are specified in
  [012-automated-verification](../012-automated-verification/spec.md).
- **Builds**: the workspace shape, desktop and web build targets, environments and promotion are
  specified in [013-builds-and-deployment](../013-builds-and-deployment/spec.md).
- **Licence and name**: "AI Book Studio", fresh repository, no inherited branding, assets or commit
  history.
