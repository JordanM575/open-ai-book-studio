# Meta Global AI Developer Hackathon 2026

The submission folder for the Meta Global AI Developer Hackathon, October 26 – November 4, 2026.

| | |
| --- | --- |
| Event | Meta Global AI Developer Hackathon |
| Format | Virtual, worldwide |
| Window | October 26, 12:00 PM – November 4, 9:00 PM ET |
| Track | Indie Developer |
| Theme | Build for Your World |
| Prize pool | $1,000,000 across the two tracks |
| Project | AI Book Studio — Meta Edition |
| Status | Built during the event; the public repository is `JordanM575/open-ai-book-studio` |

## Read in this order

1. [`EVENT.md`](EVENT.md) — dates, tracks, themes, partners, eligibility and submission links.
2. [`SUBMISSION.md`](SUBMISSION.md) — the form fields, what existed before the event, what was built
   during it, the verification evidence and the final checklist.

## The short version

- A fresh local-first implementation of an earlier cloud/web writing idea, developed with Spec Kit.
  The idea, designs and specifications predated the event; the dated implementation baseline is
  disclosed separately from the rewrite and event additions in `SUBMISSION.md`.
- Add Meta's models where they change the product: Muse Spark for planning and prose, Muse Voice
  Transcribe for dictation, and Muse Image for chapter illustrations. SAM 3.1 cutouts were built and
  then retired (D-158). Meta's open weights were not used.
- Let the agent finish a turn after the window closes and notify the author. Expose the same library
  to other agents through a standalone CLI and MCP server with a loopback-only backend and a per-run
  token; no hosted library and no account.
- The public history starts with one labelled baseline commit, the tree at the October 26 cut
  (`meta-base-2026-10-26`), followed by every event commit in order.
- Apache-2.0 is the project licence.

## Decisions

1. **Track and team:** Indie Developer, solo.
2. **Repository shape:** one labelled baseline commit at the October 26 cut, then the event commits,
   published as `JordanM575/open-ai-book-studio`.
3. **Meta access:** the Meta Model API directly, through the author's own connection. Meta's open
   weights were not used.
4. **Demo story:** a short original sample written for the demo, `samples/the-salt-road` (CC0).
5. **Submission visibility:** a public repository.

## Rules that still apply

- Do not create Meta credentials in the repository. Keys go in the OS keychain, never in a file.
- The film and the packet name only event work as event work; everything from before the cut is
  labelled "Built before the event".
