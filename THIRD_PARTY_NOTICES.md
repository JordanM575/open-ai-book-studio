# Third-party notices

AI Book Studio is Apache-2.0. Some optional capabilities depend on third-party packages with their own
licences. Keep this list current before publishing a release or a hackathon submission.

| Package | Used by | Licence | Notes |
| --- | --- | --- | --- |
| `@meta-sam/parser` | desktop SAM 3.1 cutouts | Meta SAM License (see the package `LICENSE`) | Not Apache-2.0. Include the licence text in the distribution and review compatibility before publishing. The SAM feature is desktop-only and optional. |
| `docx` | desktop Word export | MIT | |
| `ai`, `@ai-sdk/*`, `@openrouter/ai-sdk-provider` | desktop agent and providers | Apache-2.0 / MIT as declared by each package | |
| `@radix-ui/*`, `lucide-react`, `react`, `react-dom` | interface | MIT / ISC / MIT | |
| `fflate` | archives | MIT | |
| `zod` | schemas | MIT | |

The authoritative texts are in each package's `LICENSE` under `node_modules` at install time. A
packaged release must ship the notices for every bundled dependency; the desktop bundler externalises
some Node dependencies, so check the final artifact rather than this table alone.
