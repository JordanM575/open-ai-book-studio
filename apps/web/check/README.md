# Browser storage check

A small harness for the real browser storage adapters. It creates a library in OPFS, writes and
reopens a book, forces a stale-save conflict, exports and imports the archive, exercises the
IndexedDB handle store, checks picker cancellation, keeps a denied folder pending without switching
tiers, proves two-tab writes serialize through Web Locks, and verifies an OPFS library across a full
page navigation on `restart.html`. It never touches an author library and removes its temporary libraries.

```bash
cd apps/web
bun run build:check
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/>. The page sets `document.body.dataset.result` to `pass` or `fail`
and lists each check. `localhost` is a secure context, which OPFS and the storage APIs require.

The native folder picker cannot be automated here because it is a user-initiated dialog; it is
covered by the manual pass in spec 010's quickstart and the Playwright matrix in spec 012. The
`restart.html` page writes a library, reloads itself, and verifies the saved chapter.

## Shared UI gallery

The shared components have their own check page:

```bash
bun run gallery:build
python3 -m http.server 4176 --bind 127.0.0.1 -d apps/web/check/gallery-dist
```

Open <http://127.0.0.1:4176/gallery.html?theme=light> or `?theme=dark`. It renders `Button`,
`Brand`, `Notice` and `Dialog` from `packages/ui`, shows both storage disclosures, and lets you open
the dialog and the notice. The desktop renderer re-exports the same components.

Measured on 2026-10-25 with `webcheck` at 1280×800, 744×1133 and 393×852 in both themes: no
horizontal overflow, 9 controls with none under 44 px, and the dialog opens. The phone view scrolls
vertically as expected.
