# Design source

`tokens.json` is a vendored copy of the AI Book Studio design kit (Liquid Glass v20). The kit itself is
not part of this repository; only the tokens are, so a build never depends on files outside the repo.

`scripts/build-tokens.mjs` compiles the tokens to
`src/renderer/src/styles/tokens.generated.css`. Run `pnpm tokens` after changing `tokens.json`, and
never hand-edit the generated file.

To take a kit update: copy the new `tokens.json` over this one, run `pnpm tokens`, and read the diff for
new, renamed or removed tokens. A removed token that the interface still uses will surface as a missing
CSS variable, so the diff is the review.

Component previews in the kit are reference material for the interface (`docs/DESIGN.md`); their markup
is not copied into this repository.
