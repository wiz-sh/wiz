---
title: "Testing"
description: "Run unit, golden, differential, protocol, migration, example, and clean-checkout verification with Bun."
---


Use Bun for every workflow:

```console
bun install
bun run check
bun run lint
bun run format:check
bun run build
bun test
```

Compiler golden tests compare Bash, maps, and diagnostics, then run `bash -n` and safe output.
Differential tests compare untyped Bash with emitted behavior. The complete-project test covers
configuration, discovery, checking, linting, formatting, emission, maps, execution, hover,
definition, and completion. Clean builds remove every workspace `dist` first.

## Migration baseline

Before moving the CLI and splitting `packages/core`, the original suite passed
74 tests with 0 failures and 383 assertions. The completed architecture passes
159 tests with 0 failures and 1,197 assertions, including the original package
manager/runtime workflows and the new Wiz, monorepo, editor, and clean-build
coverage.
