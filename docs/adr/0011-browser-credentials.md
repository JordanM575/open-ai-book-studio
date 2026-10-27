# ADR 0011: Browser credentials and OAuth callback

- **Status**: Accepted
- **Related**: D-101, D-104, D-105; specs 010 and 011; constitution §3; ADR 0009

## Context

The browser target has no operating-system keychain and calls only providers that pass the browser-access check. D-104 had accepted a loopback callback for desktop but left the web callback open. D-105 asked whether visible disclosure was enough or a passphrase was needed to encrypt browser credentials.

## Decision

- OpenRouter web sign-in returns to the studio's own origin. The flow uses PKCE S256, validates and consumes state once, exchanges the authorization code once, and removes callback parameters from the address bar/history after processing. Desktop keeps its ephemeral loopback callback.
- Store browser credentials in an origin-scoped IndexedDB vault with an explicit disclosure. Do not add a passphrase in v1 and do not claim this equals an OS-protected keychain or is encrypted at rest.
- Before saving the first credential, explain that it is kept in this site's browser profile, is accessible to scripts executing on this origin, may be lost when site data is cleared, and is sent directly to the selected provider only when the author requests an agent action.
- Never put credentials in localStorage, the library, archive, URLs, logs, crash reports or public assets. Forget removes the stored credential and cached account data in one action.
- The web build ships its own scripts and styles, uses a restrictive same-origin content security policy, and loads no third-party script, analytics or remote runtime. The browser-access registry remains authoritative; no provider proxy is introduced.
- An author using a shared or untrusted browser profile should not store a valuable provider key there.

## Consequences

- A browser profile is a weaker trust boundary than the OS vault. A same-origin script compromise can expose or use the credential; an app-managed non-extractable Web Crypto key does not prevent malicious same-origin code from asking the browser to use it.
- Clearing origin data may remove credentials and browser-stored libraries. The UI explains this and offers library export independently from credential storage.
- No key recovery or account is provided. The author reconnects after removal or data loss.
- Browser providers remain disabled until their direct CORS/access test passes; CORS failures do not trigger a server-side proxy.

## Rejected alternatives

- **Passphrase-encrypted vault** — creates a second secret, recovery burden and recurring friction. It does not protect against same-origin code while unlocked and is not required by spec 011's accepted disclosure model.
- **Web Crypto wrapping key stored beside the credential** — protects at most a copied database file, not against a script executing on the same origin; it would imply stronger security than it provides.
- **Studio proxy** — would receive both author credentials and manuscript content, violating local-first/no-custody principles.
