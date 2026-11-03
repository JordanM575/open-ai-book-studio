# Research: lifecycle support matrix (D-173)

**Task:** 009 T024 · **Status:** research recorded, decision not accepted — nothing is installed here.
**Evidence:** `apps/desktop/tests/lifecycle-matrix-premises.test.ts` (2 pass: version-free
profile identity keys, one settings-file rule on synthetic macOS/Windows/Linux roots);
`apps/desktop/electron-builder.yml` (declared targets); 013 Q&A + FR-013/FR-023 (macOS
release-blocking, win/linux configured); `apps/desktop/src/main/index.ts:51`
(`STUDIO_USER_DATA` override); `settingsFilePath` (T023). Electron userData conventions,
installer behaviors and OS floors below are a documentation survey with that limitation
stated — no native install, uninstall or quarantine flow was executed locally.

## Declared targets (repo facts)

| Target | Package | Arch | Standing |
| --- | --- | --- | --- |
| macOS | dmg, zip | arm64, x64 (no arch restriction in builder config) | Release-blocking (013) |
| Windows | nsis, assisted, custom directory allowed | x64 (nsis default) | Configured, not release-blocking |
| Linux | AppImage | x64 (AppImage default) | Configured, not release-blocking |

CI verifies on ubuntu only; Windows and macOS packaging is declared in the builder config
and 013 but is not exercised by the checked-in gates. The matrix claims them as
built-not-verified until a gate builds them.

## Native install and uninstall (survey)

- macOS dmg: mount, drag to /Applications, eject. Uninstall is trashing the `.app`;
  the profile stays — cleanup choices belong to T025, not to the uninstaller.
- macOS zip: unzip, place by hand; same uninstall and profile behavior as dmg.
- Windows nsis: assisted wizard with a custom directory; the uninstaller entry removes
  the app while the roaming profile typically stays (to confirm at acceptance).
- Linux AppImage: `chmod +x`, run in place; uninstall is deleting the file; no system
  integration by default.
- First launch of an unsigned download needs the platform override (Gatekeeper on macOS
  per D-172); the tester instructions must disclose it. Nothing here needs a signature.

## OS floors (survey, confirm at acceptance)

Floors follow the upstream requirements for the pinned Electron major (45.0.0 installed).
No floor is asserted here from memory: the Needed item records confirming the exact
macOS/Windows/Linux minimums from the upstream docs and the CI runners before any
support claim. Policy proposal: the app supports what upstream Electron 45 supports, no
wider and no narrower.

## Per-user profile location (code facts + conventions)

- The profile root is Electron's per-app `userData`: by convention
  `~/Library/Application Support/AI Book Studio` (macOS),
  `%APPDATA%/AI Book Studio` (Windows),
  `~/.config/AI Book Studio` (Linux).
- It is stable by construction: `productName` and `appId` carry no version (premise
  test — renaming or versioning either orphans every profile), one `studio.json` rule
  holds on every root (premise test), and `STUDIO_USER_DATA` relocates it for tests and
  power users.
- Contents today: `studio.json` (settings) and `credentials.json` (protected storage).
  Both stay on uninstall; T025 owns any cleanup offer.
- Discovery: the author finds the location in Settings (T027 implements showing it
  there, separate from library identity). No other surface needs to print it.

## Alternatives considered

- macOS-only support (rejected): the builder config, 013 and the artifact matrix
  already declare three targets; narrowing now would strand configured work. macOS stays
  the only release-blocking target.
- Per-version profile directories (rejected): they would break the continuity T023
  proves and that compatible upgrades rely on. The version-free root is load-bearing.
- Deciding uninstall cleanup here (rejected as scope creep): T025 owns it, with T028
  reusing the matrix row.

## Recommendation

Accept the matrix: three declared targets with the methods and profile paths above,
macOS release-blocking, win/linux best-effort until a gate builds them, floors per
upstream Electron 45 confirmed at acceptance, Settings as the discovery surface, profile
stays on uninstall. T027/T030 build the local paths against this matrix; T025 decides
cleanup; T028 reuses the row for diagnostics.

## What this unblocks when accepted

T027 (local upgrade path incl. showing the location), T028 (diagnostics matrix row),
T030 (local install acceptance); T025 still needs its own cleanup decision. None of them
may publish, download for the author, or use credentials.
