# Dependency and license evidence

Resolved from the installed packages and `bun.lock`, November 7, 2026. Direct
versions are pinned. `probes/bundle.mjs` reproduces this inventory, prints each
complete installed LICENSE and its SHA-256, and measures the isolated bundle.
All twelve packages declare MIT. This file retains their copyright notices and
the shared permission/warranty text below; it is not a whole-product license gate.

| Package | Version | Notice | SHA-256 of installed LICENSE |
| --- | --- | --- | --- |
| @codemirror/commands | 6.11.1 | A | 05c6130cda97e7600ca91427a41e8a065efcf82365fc0293e7de80faec494c07 |
| @codemirror/state | 6.7.6 | A | 05c6130cda97e7600ca91427a41e8a065efcf82365fc0293e7de80faec494c07 |
| @codemirror/view | 6.43.15 | A | 05c6130cda97e7600ca91427a41e8a065efcf82365fc0293e7de80faec494c07 |
| @codemirror/language | 6.13.1 | A | 05c6130cda97e7600ca91427a41e8a065efcf82365fc0293e7de80faec494c07 |
| @codemirror/streamparser | 6.0.0 | A | 05c6130cda97e7600ca91427a41e8a065efcf82365fc0293e7de80faec494c07 |
| @lezer/common | 1.5.5 | B | 568902fb66eaf1f11750e966b33fd7b5d7c618e65af09f35ef843635bcf5f1ba |
| @lezer/highlight | 1.2.5 | B | 568902fb66eaf1f11750e966b33fd7b5d7c618e65af09f35ef843635bcf5f1ba |
| @lezer/lr | 1.4.12 | B | 568902fb66eaf1f11750e966b33fd7b5d7c618e65af09f35ef843635bcf5f1ba |
| @marijn/find-cluster-break | 1.0.4 | C | 9360b00fdd091f05c783b568bdd46c679c41b72415599252de98949462ea1acb |
| crelt | 1.0.7 | D | 23852ebf6aef7fadffc92514b3c5df163a8651f2c3ed0dbb494cb49d93bd5de5 |
| style-mod | 4.1.4 | E | cb4474e26547397169061d3586c00022cda5330a1b64fa13e872319f3b63aff1 |
| w3c-keyname | 2.2.8 | F | 869c30f368eb08735e779027b9f4bc9fea2f39624351856aebe42741f0bc0884 |

The first three are direct dependencies. Commands brings language/Lezer modules
transitively even though the surface enables no language parser or syntax extension.
No `basicSetup`, `history` or `historyKeymap` is enabled. Package presence does not
mean its entire code is shipped; the eventual build's module graph owns that answer.

## Copyright notices

- **A:** Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- **B:** Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- **C:** Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin>
- **D:** Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>
- **E:** Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- **F:** Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

## MIT permission and warranty (applies to each notice/package above)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Eventual product integration

The existing `scripts/licenses.mjs` records bundled modules and desktop production
dependency closure, generates each target's license report and notices, and leaves
license acceptance to the existing gate. The integration owner must regenerate and
check those outputs on the actual mounted build. No central notices, allowlist,
license gate, bundle baseline or performance threshold is changed by this leaf.
