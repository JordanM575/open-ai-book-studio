/**
 * electron-builder `afterPack` hook: harden the packaged Electron binary with fuses.
 *
 * Only vectors that cannot change app behavior are flipped. Cookie encryption stays off because
 * the OAuth popup session has no reviewed keychain story yet; asar integrity validation stays
 * off because the builder emits no integrity hash (enabling it would refuse to launch); the
 * file-protocol privilege fuse stays at its default because the packaged renderer loads over
 * file://. See spec 012 T015.
 */
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(import.meta.dirname, "..", "apps", "desktop", "package.json"));
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

export default async function afterPack(context) {
  const { appOutDir, packager } = context;
  const direct = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  let appPath = direct;
  try {
    await readdir(direct);
  } catch {
    const entries = await readdir(appOutDir);
    const found = entries.find((entry) => entry.endsWith(".app"));
    if (!found) throw new Error(`flip-fuses: no .app in ${appOutDir}`);
    appPath = join(appOutDir, found);
  }
  const resetAdHocDarwinSignature = process.platform === "darwin";
  await flipFuses(appPath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    resetAdHocDarwinSignature,
    // Hardened: the packaged app is never a Node runtime and never inspects itself.
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Explicit defaults, unchanged: cookie encryption waits on a reviewed keychain story, asar
    // integrity validation needs a builder-emitted hash that does not exist yet, the file-protocol
    // privilege keeps the packaged renderer loading, and the snapshot/wasm defaults stand.
    [FuseV1Options.EnableCookieEncryption]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.WasmTrapHandlers]: true
  });
  console.log(`[flip-fuses] hardened ${appPath}`);
}
