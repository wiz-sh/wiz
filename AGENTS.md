# Working on Wiz CLI

Read `WIZ.md` for the product model before changing public behavior.

## Ownership

This repository owns the `wiz` command-line application and the cross-product
integration suite under `tests/`. Keep the application thin: package operations
belong in `@wiz-sh/pm`, execution in `@wiz-sh/runtime`, compilation in
`@wiz-sh/compiler`, and editor protocol behavior in `@wiz-sh/lsp`. The aggregate
examples live here because they exercise the public CLI across those packages.

## Engineering rules

- Use Bun for installs, scripts, builds, runtime, and tests.
- Keep TypeScript strict and ESNext.
- Use four spaces, double quotes, semicolons, and spacious control flow.
- Comments should explain an invariant, tradeoff, compatibility constraint, or non-obvious reason.
- Add JSDoc to stable public APIs when the contract is not obvious from the signature.
- Classes are welcome when identity, lifecycle, state, or invariants make them clearer.
- Do not create empty directories or one-file directory hierarchies without a real ownership boundary.
- Do not commit generated `dist` output.
- Preserve shell quoting, argument order, exit status, signals, and source locations.

## Verification

Run the narrowest relevant test while editing, then run:

```console
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

Cross-product tests may use the sibling repository layout documented by the
local file overrides in `package.json`. Unit tests must remain independently
runnable after the dependencies are published.
