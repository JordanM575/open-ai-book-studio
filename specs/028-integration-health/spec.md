# Integration health: what each location and provider is doing, and when to warn

**Status:** Planned (2026-10-26)
**Number:** 028
**Depends on:** [016](../016-sync/spec.md) for locations, placeholders and conflicts; [011](../011-model-access/spec.md) for provider connections; [017](../017-voice-and-background/spec.md) for voice connections.

## The question

Before an author relies on a folder or a provider, can the studio say what is happening? Today a
folder can be partly "not downloaded", a key can be rejected, and a voice service can be missing.
Each is reported only where the error happened, in a sentence that does not say what to do.

## What the author sees

- **Locations.** Settings and the library list show one health line per location: local folder,
  iCloud Drive folder, Google Drive folder. The states are *Ready*, *Not downloaded* (with a count),
  *Offline*, *Permission needed*, *Conflicts* (with a count) and *Checking*.
- **Providers and voices.** Each connection shows *Connected*, *Not set up*, *Key rejected*,
  *Limited* (rate or quota), *Unavailable* and the time of the last check.
- **Warnings.** Every warning says what is happening in plain words, what the studio will do next,
  and what the author can do. An example: "Three chapters are still in iCloud. Open them to download
  them, or the studio will ask before it saves over them."

## Requirements

- **FR-001** Each location has one health state, derived from the folder at the time of the check. It
  is never stored as a fact, so a stale state cannot outlive the folder it describes.
- **FR-002** A warning has a severity: *info*, *warning* or *danger*. A *danger* warning means that
  data could be lost. It stays until the author acknowledges it and never times out.
- **FR-003** A danger warning blocks the action it concerns. Saving over a chapter that is still a
  placeholder is disabled until the author chooses to keep the disk version, keep their own, or open
  both. 016 FR-006 is the rule; this spec only makes the block visible.
- **FR-004** Health checks read metadata only: existence, size, placeholder status and the conflict
  files that are present. They never write to the folder and never open a chapter for editing.
- **FR-005** A provider failure shows the provider's own message with its key redacted, never the key,
  and never a raw stack trace. A rejected key links to the place where it is replaced.
- **FR-006** Every warning uses the one notice component, with an icon, sentence-case copy, and at most
  two actions, the first being the safe one.

## Acceptance

- **A** Fixture folders for each location state produce the expected state, copy and action. These are
  unit tests on the pure derivation in `packages/core`, with no UI.
- **B** A danger warning cannot be dismissed by a timer, and the save it concerns stays disabled until
  acknowledged. A desktop test drives the real component.
- **C** A provider error that contains a key prints no key. The redaction test covers all five
  connection states.
- **D** Read-only probes of the real iCloud Drive and Google Drive folders on the author's Mac are
  recorded in `docs/research/`. They read names and placeholder status and write nothing. Writes need
  the author's approval, and the two-device pass stays with 016 FR-022.

## Non-goals

- No sync engine, no cloud API, no background network call. Cloud APIs wait for the decision in 016
  (D-122).
- No new save path. Health reads the same files the save protocol already writes.
- No warning for a state the author cannot act on.
