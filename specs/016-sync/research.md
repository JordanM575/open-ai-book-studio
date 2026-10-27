# Research: sync providers and device lock

**Status:** Open; no provider probe has been run yet. This file records what must be verified before
spec 016 tasks can claim support.

## Questions

1. How do iCloud Drive and Google Drive present an evicted/online-only Markdown file to a plain file
   reader, and how does the studio materialize it without mistaking it for an empty chapter?
2. Can the desktop shell read and write those folders with `NSFileCoordinator` semantics, or does it need
   a native helper?
3. Can the iOS shell reach an iCloud Drive folder the author picked in Files, with access that survives
   relaunch?
4. Which LocalAuthentication and Keychain APIs are available from Electron main and from the Capacitor
   shell, and what exactly does each protect?
5. What conflict-copy names do iCloud and Google Drive create for Markdown files, and how should the drift
   report group them?

## What is known (to verify)

### iCloud Drive

- On macOS, iCloud Drive is a folder under `~/Library/Mobile Documents/com~apple~CloudDocs/`.
- Files can be evicted. The on-disk placeholder is typically accompanied by a hidden `.icloud` sidecar;
  the file may appear as a zero-byte placeholder to a naive reader.
- `NSURLUbiquitousItemDownloadingStatusKey` and `startDownloadingUbiquitousItem` are the documented way to
  inspect and request materialization.
- `NSFileCoordinator`/`NSFilePresenter` are the supported coordination layer for iCloud documents; a raw
  `fs.readFile` may see a stale or placeholder state.
- iCloud can create "conflicted copy" files when two devices edit the same document offline. Exact naming
  and whether it applies to plain `.md` files in a folder (as opposed to document packages) needs a probe.

### Google Drive

- The desktop app mounts Drive under `~/Library/CloudStorage/GoogleDrive-<account>/` on current macOS
  (older installs used `/Volumes/GoogleDrive`).
- Online-only files are placeholders. Whether a `.md` file is materialized on read, returns a placeholder,
  or errors needs a probe. Google Docs shortcuts (`.gdoc`) are not Markdown and must be ignored.
- Using the mounted folder avoids OAuth and keeps the no-account promise. Direct Drive API access would
  add an OAuth client and a cloud integration; it is deferred.

### iOS / Capacitor

- The app's Documents folder is not iCloud Drive. Reaching iCloud Drive requires the Files picker and
  iCloud Documents entitlements; access to a picked folder must be persisted with a security-scoped
  bookmark.
- Capacitor's Filesystem plugin writes to the app sandbox by default. It does not by itself provide iCloud
  Drive or security-scoped bookmark support.
- Face ID/Touch ID is available through LocalAuthentication; a Capacitor plugin must be reviewed before it
  becomes a dependency (D-121).
- Background execution is limited; the iOS scan will likely run only while the app is foregrounded.

### Lock

- `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)` covers biometrics plus the device passcode;
  `.deviceOwnerAuthenticationWithBiometrics` excludes the passcode. The UI must choose one and say which.
- macOS has Touch ID on most modern laptops/desktops; Face ID is not generally available on Macs. The copy
  should say "Touch ID or password" on macOS and "Face ID or passcode" on iOS.
- Electron main can call `systemPreferences.promptTouchID` on macOS, or a small native helper for fuller
  LocalAuthentication control. The helper option needs a build/signing check.
- A PIN verifier belongs in the keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, a random salt,
  a slow KDF (PBKDF2/Argon2), and an app-side attempt counter. The keychain protects the verifier, not the
  library files.
- The lock is a UI gate. Markdown files remain readable by Finder, a terminal and the agent. Claiming
  otherwise would be false.

## Probe plan

Run these before T012; record OS/provider versions and exact results.

| Probe | How | Pass condition |
| --- | --- | --- |
| iCloud materialization | Put a `.md` in iCloud Drive, evict it, read with `fs` and with `NSFileCoordinator` | The app can tell placeholder from empty and materialize it |
| iCloud conflict naming | Edit the same `.md` offline on two devices, reconnect | The conflict file is detected and grouped, not imported as a chapter |
| Google Drive placeholder | Put a `.md` online-only, read from the mounted folder | The app reports "not downloaded" or materializes it |
| iOS folder access | Pick an iCloud Drive folder in Files, relaunch | Access survives and reads the same files |
| macOS LocalAuthentication | Call `canEvaluatePolicy` and a prompt from the shell | Prompt works without weakening the app's signing |
| iOS biometrics | Evaluate Face ID and passcode policies | Both are reported correctly; cancel leaves the UI locked |
| Keychain PIN | Store and read the verifier, relaunch, fail five attempts | Verifier survives relaunch; lockout applies; no plaintext PIN |

## Test matrix (emulated, no network)

| Scenario | Transport behavior | Expected |
| --- | --- | --- |
| Clean propagation | Copy all files after a delay | Report lists the changed chapter; no conflict |
| Concurrent edit | Both sides edit before copying | Both versions preserved; report requires review |
| Offline batch | Hold changes, deliver all at once | One report, no duplicates |
| Delete | Remove a chapter and its sidecar | Tombstone reported; no resurrection |
| Placeholder | Mark a file online-only | Report "not downloaded"; no empty chapter |
| Partial copy | Copy half the bytes | Detected as unreadable/changed; old bytes intact |
| Clock skew | Change mtimes without content | No conflict; hashes decide |
| Corrupt journal | Truncate or delete the journal | Warning, full comparison, no writes |
| Second scan | Scan twice with no changes | Same report, no new conflict copies |

## Harness findings (T004–T005)

- **Trash is not a rename.** Deleting a chapter moves its bytes to `.studio/trash`, so the new trash file
  and the missing chapter have the same hash. The first harness run paired them as `renamed` and hid the
  deletion. Rename pairing now excludes `.studio/trash` on both sides; the report is `remote-deleted` plus
  `new-remote`, with a unit test pinning the rule.
- **A torn copy looks like an external edit until it completes.** It arrives as `remote-changed`; the
  journal must not be updated and the partial bytes must not be opened as prose. A complete copy heals it
  on the next scan, with no duplicate conflict copy.
- **Device identity is inside the synced folder.** `.studio/device.json` is copied by the provider along
  with the books. Two installs can then share one id and write the same journal, so the `deviceId` check
  cannot tell their baselines apart. The harness keeps identity per system and tests a copied journal by
  filename; the identity itself needs D-124.

## Open questions

- Does `NSFileCoordinator` work from Electron's main process without a sandbox entitlement?
- Can the Capacitor shell hold a security-scoped bookmark across launches without an iCloud container?
- What are the exact iCloud/Google Drive conflict-copy names for `.md`?
- Which KDF cost is appropriate for a 6-digit PIN on the oldest supported device?
- Should the lock also cover the browser shell (WebAuthn) or stay native-only? Current assumption: native
  only; the browser has no Face ID claim.
