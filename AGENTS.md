# Working on Wiz

This guide is for coding agents and contributors changing Wiz itself. Read
`WIZ.md` first when you need the product model or command examples.

## Ground rules

- Use Bun for dependency management, scripts, builds, runtime, and tests.
- Keep TypeScript strict and ESNext. Use four spaces, double quotes, and
  semicolons.
- Prefer spacious control flow. Separate setup, decisions, and side effects
  with blank lines instead of compressing them into dense expressions.
- Comments should preserve a reason, invariant, compatibility constraint, or
  non-obvious shell behavior. Let the code explain routine mechanics.
- Add JSDoc to stable public APIs and abstractions whose contract is not obvious
  from their signature.
- Classes are welcome when identity, state, lifecycle, or invariants make them
  clearer than loose functions.
- Do not create empty directories. Avoid a directory for one file, and split a
  crowded directory only when at least two cohesive modules belong together.
- Do not edit or commit generated `dist` output.

## Architecture boundaries

- `packages/pm` owns manifests, Git dependencies, lockfiles, stores,
  workspaces, linking, and installation. It must not import `@wiz/runtime`.
- `packages/runtime` owns executable lookup, environment construction, process
  execution, temporary runs, `root`, and `needs`. It may consume `@wiz/pm`.
- `packages/compiler` owns every Wiz compiler phase and exposes stable APIs
  from `src/index.ts`. Keep phase internals inside this package.
- `packages/formatter` and `packages/linter` consume compiler syntax and
  semantics; they must not implement competing parsers.
- `packages/language-service` contains editor intelligence. `packages/lsp`
  should only translate between that API and LSP messages.
- `apps/cli` and `apps/vscode` are thin applications, not shared libraries.
- `apps/registry` uses Drizzle ORM with the Bun SQL PostgreSQL driver. All application queries,
  transactions, schemas, and migrations must go through Drizzle; do not add raw Bun `SQL` access,
  `pg`, postgres.js, or a second migration system.

Wiz targets Bash, Zsh, and portable `sh`. Bash is the default. Shared syntax is
lowered by the common printer, while unsupported `sh` features must produce a
diagnostic instead of silently changing behavior.

Bundled ambient APIs and independently installable declarations live in
`wiz/types/`. Update those packages, compiler tests, and IntelliSense tests
together. Optional declarations use the Bash-native `source -T` form.

## Workflow

Start by checking the worktree and reading the closest tests. Preserve unrelated
user changes. After a focused edit, run the smallest relevant Bun test target,
then run the repository gates:

```console
bun run format:fix
bun run lint
bun run typecheck
bun run build
bun test
```

Before handing off a structural or release-facing change, also verify a clean
build without relying on stale output:

```console
rm -rf apps/*/dist packages/*/dist
bun install
bun run build
bun test
```

`bun cloc` reports product source only. Package-manager migrations require
regression tests for manifests and lockfiles. Compiler changes require emitted
shell syntax checks and execution tests when safe. LSP changes require protocol
or language-service tests, and extension contributions require manifest tests.

## Shell safety

Quoting, exit status, signals, argument order, and source locations are product
behavior. Never normalize shell text unless equivalence is established. New
target lowering must pass the target shell's syntax checker. Reject a construct
when a backend cannot preserve it.
