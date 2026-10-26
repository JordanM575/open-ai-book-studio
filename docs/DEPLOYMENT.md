# Builds, environments and promotion

**Spec:** [013](../specs/013-builds-and-deployment/spec.md) · **Decision:** D-106, ADR 0010.

One commit produces a desktop application and a static web bundle. Both report the same version, commit
and schema version. Staging and the public demo serve immutable artifacts; promotion moves the artifact,
never a rebuild.

## One source of truth

| Value | Source |
| --- | --- |
| Version | `package.json` at the repository root |
| Commit | `GIT_COMMIT` when the build system supplies it, otherwise `git rev-parse --short=12 HEAD` |
| Schema | `packages/core/src/schema.ts` (`SCHEMA_VERSION`) |
| Target | `BUILD_TARGET=desktop`, `web`, or `all` (default) |

```bash
bun run build:info          # human-readable
bun run build:info --json   # machine-readable
```

`build:info` fails when the root, desktop, web and mobile `package.json` versions disagree. The root
version is the source; the workspace copies exist because each package needs one.

## Environments

| Stage | What runs | Storage | Required gates |
| --- | --- | --- | --- |
| Local | `bun run dev`, `bun run dev:web` | Developer profile and fixtures | `bun run typecheck`, `bun test` |
| Staging | Unsigned desktop package and the static web bundle | Staging host and a throwaway library | `bun run verify`, `bun run smoke`, `node scripts/web-smoke.mjs`, `bun run package:dir` launch check |
| Public demo | The exact staging artifacts, promoted | Static host; browser storage with the disclosure visible | Staging gates plus the manual checklist |

The public demo must use synthetic or author-approved content only. Never open the author's real library
or profile from an automated run.

## Artifact names

| Artifact | Name | Produced by |
| --- | --- | --- |
| Desktop macOS | `AI Book Studio-<version>-mac-<arch>.dmg` / `.zip` | `bun run dist`, or `bun run package:dir` for the unpacked app |
| Desktop Windows | `AI Book Studio-<version>-win-<arch>.exe` | `bun run dist` on Windows or CI |
| Desktop Linux | `AI Book Studio-<version>-linux-<arch>.AppImage` | `bun run dist` on Linux or CI |
| Web bundle | `apps/web/dist/` | `bun run build:web` |
| Web archive | `ai-book-studio-web-<version>-<commit>.tar.gz` | Archive `apps/web/dist/` after the build |

`apps/desktop/electron-builder.yml` sets `artifactName` so the version and platform are in every file
name. Keep the previous staging and public artifact directories addressable; a rollback is a link
change, not a rebuild.

## Promotion runbook

1. `git status --short` is clean and the branch is the intended release branch.
2. `bun run build:info` confirms the version and commit, and every workspace package agrees.
3. `bun run verify` passes (typecheck, tests, desktop bundle, web bundle).
4. `bun run smoke` passes against the fresh desktop build.
5. `node scripts/web-smoke.mjs` passes against the fresh web build.
6. `bun run smoke:packaged`; this builds the unpacked app and runs the hidden suite against the
   packaged binary with a throwaway profile and fixture library (16/16). It does not show a window.
7. Archive `apps/web/dist/` as `ai-book-studio-web-<version>-<commit>.tar.gz`; checksum the desktop and
   web artifacts.
8. Promote the exact artifacts to staging. Do not rebuild between staging and the public demo.
9. Record commit, version, checksums, unsigned status, capability differences and the gates that ran.

## Rollback runbook

1. Keep the previous staging and public artifact directories (or object versions) available.
2. Re-point the static host and the desktop download to the previous artifact.
3. Run `bun run build:info` in the repository and compare it with the version/commit shown by the
   rolled-back build.
4. Re-run `node scripts/web-smoke.mjs` against the previous web artifact.
5. Record the rollback in the release notes; do not delete the failed artifact until the cause is fixed.

The target is under five minutes. No rebuild is allowed to be on the critical path.

## Manual checklist

- Desktop launches to the welcome screen, not a blank window.
- A fixture book opens; typing saves; the save state says Saved.
- The agent panel opens; without a provider it explains the connection requirement.
- The web welcome offers browser storage and a folder; browser storage opens; a chapter saves and reopens.
- Settings discloses the storage tier, persistence and the browser warning.
- No request goes to a studio-owned host.
- The unsigned desktop build says it is unsigned; release notes repeat that.

## CI

`.gitea/workflows/verify.yml` runs install, version agreement, typecheck, tests, desktop bundle and web
bundle. **No Gitea runner is registered yet**, so the workflow is ready but has no run history. Local
`bun run verify` remains the source of truth, and the README must not claim a passing CI badge until a
run exists. Hidden Electron smoke is local or packaged-build only because it needs a display.

## Honesty rules

- The web build is static assets; it has no account, database or server-side library.
- Browser storage can be cleared; the app says so and offers an archive export.
- An unsigned macOS package is labelled unsigned and shared only with informed testers.
- Capability differences between desktop and web come from `packages/core/src/build.ts`, not scattered
  conditionals. Settings → About reads the same table.
- Build logs, release notes and artifacts never contain credentials, environment files or manuscript
  text.
