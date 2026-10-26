# macOS keychain and credential testing

AI Book Studio does not keep provider keys in the library, logs or the renderer. On macOS the desktop
vault is:

1. **Ciphertext** in `<userData>/credentials.json` (mode `0600`). The file contains provider, label,
   dates and an encrypted secret blob; never a plaintext key.
2. **A master key in the macOS login keychain**, created by Electron `safeStorage`. It is the
   `<app name> Safe Storage` item (the dev build can use a different item name than the packaged app).

This is an operating-system-protected vault, not a claim of perfect secrecy. It uses the legacy
file-based keychain, not the Data Protection Keychain, and it is not gated by Touch ID. A process
running as the same macOS user may be able to use the item depending on its ACL. The app never reads or
prints the master key.

## Add a credential

1. Open **Settings → Provider connections**.
2. Paste the provider key and choose **Add key**. The key is validated first; a rejected key is not
   saved.
3. The status row should say **Unlocked · macOS Keychain** with the connection count.
4. Remove the connection when the test is done. Removing it deletes the record; it does not touch the
   manuscript.

## Unlock the keychain for a manual test

The login keychain normally unlocks when you log in. If it is locked, the app's status row says
**Locked or unavailable** and adding a key refuses with an explanation. Unlock it in one of these ways:

```bash
# Prompts for your login password; do not pass a password as an argument.
security unlock-keychain ~/Library/Keychains/login.keychain-db

# Check whether it is locked.
security show-keychain-info ~/Library/Keychains/login.keychain-db

# Lock it deliberately to test the failure state.
security lock-keychain ~/Library/Keychains/login.keychain-db
```

Or open **Keychain Access**, select `login`, and choose **Unlock Keychain "login"**. To find the
safeStorage item, search for `Safe Storage`; do not reveal its password in a terminal or a screenshot.

After unlocking, press **Check keychain** in Settings. The button forces one in-memory
encrypt/decrypt probe through `safeStorage` and updates the status. It never displays a key.

## Test with a throwaway profile

The test profile has its own `credentials.json`, but **it uses the same login keychain master key** as
the normal app because the keychain item belongs to the app, not the profile. Use a throwaway provider
key, and remove the connection afterwards.

```bash
PROFILE="$(mktemp -d)"
STUDIO_TEST=1 STUDIO_VISIBLE=1 STUDIO_USER_DATA="$PROFILE" bun run dev
```

`STUDIO_TEST=1` isolates settings and credentials; `STUDIO_VISIBLE=1` shows the window so the Settings
screen can be used. Without `STUDIO_VISIBLE`, the same command is headless and is suitable for the smoke
harness.

The profile path is printed in the app log. Delete it when finished:

```bash
rm -rf "$PROFILE"
```

Do not copy a real `credentials.json` into a test profile, and do not use the author's real library.

## Locked-state test

1. Lock the login keychain with `security lock-keychain …`.
2. Open **Settings → Provider connections** and press **Check keychain**.
3. Expect **Locked or unavailable**, the “unlock your keychain” sentence, and a refused Add key.
4. Unlock the keychain, press **Check keychain** again, and add the throwaway key.

The agent never receives a key; the main process reads it only for the selected provider call.

## What happens if the keychain item is lost

If the macOS keychain item is deleted, reset, or recreated under a different app identity, the existing
ciphertext cannot be decrypted. The app does not fall back to plaintext. It reports that the connection
cannot be read; remove the connection and add the key again. The library and manuscripts are untouched.

This commonly happens when moving between the development app and a packaged build, because the keychain
item is scoped to the app name. Reconnect in the build you are using.

## CI and automated tests

- Unit and contract tests use `MemoryVault`; they do not need a keychain.
- The hidden smoke run uses an isolated profile and never adds a provider credential.
- Live provider tests are opt-in (`LIVE_PROVIDER_TESTS`) and must use a throwaway key and fixture
  library. Do not run them on a shared CI machine with a real key.
- A locked keychain must fail closed: no plaintext file, no silent fallback, no agent turn.

## Security limits, stated plainly

- The credential file's metadata (provider, label, dates) is visible to anyone who can read the file;
  the secret is ciphertext.
- The legacy keychain item is accessible to the logged-in user's processes subject to its ACL. It is not
  a hardware-bound or Touch ID-gated secret.
- The browser build has no keychain; it uses origin storage with the disclosure in the app.
- A compromised macOS session can read what the app can read. The vault protects against casual file
  copying and accidental commits, not a fully compromised account.
