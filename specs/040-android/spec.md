# Android product target

**Status:** Draft / Planned — no Android support or release claimed
**Number:** 040
**Requirement:** REQ-ANDROID-001; REQ-SURFACE-001
**Depends on:** 010 storage ports; 013 capability/build records; 014 shared mobile UI;
016 conflict/trust contracts; 029 import refusals; 011 provider access. 017/038 apply only to voice.
**Completion lane:** L18; not a desktop release prerequisite.

## Why and user stories

Responsive web or iOS Simulator evidence does not prove Android support. An author needs to know
which Android capabilities work, where files live, whether they survive process death, and how to
recover or export them without surrendering custody to an app-owned service.

1. Open or create a library through an approved Android storage adapter and reopen saved text.
2. Resume after permission loss, process death or concurrent folder edits without overwriting prose.
3. Import/export only supported formats and use provider/voice features only after their Android
   credential, permission and access checks pass.

## Requirements

- **FR-001** A versioned target matrix MUST name Android/API levels, shell/build identity, tested
  device classes and per-capability status: storage, picker, credentials, editor, import/export,
  providers, voice and sync. Untested/unsupported MUST NOT be shown as supported.
- **FR-002** Storage MUST use the shared port and one authorized platform writer, preserving atomic
  publication, baseVersion/baseHash checks and recoverable conflicts/trash. Renderer code MUST NOT
  gain direct filesystem access. If an adapter cannot meet the accepted save contract, it MUST refuse
  writes; weaker guarantees need an explicit reviewed contract, not a silent emulation.
- **FR-003** Before capture or writing, unavailable pickers, revoked grants, placeholders, locked
  files or unsupported formats MUST cause a specific refusal. Failed saves and lifecycle interruption
  MUST preserve the last saved text and any acknowledged recoverable draft without fake success.
- **FR-004** The accepted storage design MUST explain backup, export, uninstall and app-private
  storage loss. A library MUST remain recoverable as ordinary files; no hidden authoritative database
  or automatic synchronization is introduced.
- **FR-005** Android credentials MUST stay behind the privileged adapter using approved protected
  storage. Unavailable protection MUST refuse persistence, never fall back to plaintext. Secrets MUST
  NOT enter renderer reads, library files, logs, exports or build artifacts.
- **FR-006** Provider requests MUST honor 011/022 consent, capabilities and actual-model attribution.
  Voice MUST be separately capability-gated before microphone permission/capture, disclose recording
  and stop, and preserve a textual fallback. No always-on listening is authorized.
- **FR-007** Import/export MUST use 029/035's validated scope, immutable snapshots and failure-safe
  publication. Unsupported actions MUST be refused before content capture or partial output.
- **FR-008** Native signing, store distribution and real-device claims MUST use separately approved
  access and exact-artifact evidence. No Play listing link until available. Updates MUST preserve
  library/profile data and safely refuse incompatible schemas.
- **FR-009** Keyboard, touch, screen-reader, rotation, light/dark and reduced-motion/transparency
  journeys MUST be verified for every claimed device class.

## Acceptance scenarios

1. On the agreed Android matrix, create/edit/reopen synthetic text; independently inspect exported
   ordinary files. Verify version/hash conflict with a second fixture writer, not a production folder.
2. Inject failed/partial writes, revoked picker grants, process death during save and background/return:
   previous files remain intact, recoverable drafts/conflicts are explained and no false saved state appears.
3. Unavailable protected storage refuses credentials. Redaction tests observe no secret in renderer,
   log, library or export. An unsupported voice/import/provider action creates no capture/request/write.
4. Approved real-device installation/update preserves fixture library/profile; record artifact hash,
   OS/device and limitations. Emulator evidence alone cannot close real-device release tasks.
5. Verify accessibility/rotation/theme and explicit offline/permission-denied recovery in the built app.

## Non-goals

Automatic cloud sync, a hosted manuscript copy, LAN backend exposure, iOS parity by assertion,
remote glasses transport, a new provider account system, or an unapproved signing/store action.

## Open decisions

Record accepted architecture in docs/DECISIONS.md and an ADR before dependent implementation.

| ID | Question / evidence | Blocks |
| --- | --- | --- |
| U-040-01 | Shell, Android/API/device support matrix and shared mobile ownership; compare feasible targets without assuming D-117's iOS choice covers Android. | T002, T003 |
| U-040-02 | Picker/storage adapter, grant lifetime, atomic replacement, external-writer limits and uninstall/export recovery; fault-test actual provider behavior. | T003, T004 |
| U-040-03 | Protected credential adapter and provider/voice access matrix; prove refusal and redaction. | T005 |
| U-040-04 | Signing, distribution, update/rollback and release ownership; reconcile D-115 scope and explicit access/consent. | T007 only |
