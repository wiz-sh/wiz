# Wiz Language for VS Code

This extension registers `.wiz` and `.d.wiz` files and starts `wiz c lsp --stdio`.
It provides diagnostics, hover, navigation, completion, signature help, rename,
semantic highlighting, formatting, and quick fixes through the shared Wiz language server.

The bundled syntax grammar highlights typed declarations and parameters,
declaration-file command and environment APIs, Bash control flow and builtins,
variables, substitutions, arithmetic, conditionals, process substitutions,
redirections, heredocs, comments, and incomplete quoted text.

Wiz files use the bundled shell-document icon in themes that honor language
icons. The extension also contributes typed declaration and function snippets,
shell-aware indentation and folding, documentation-comment continuation, and
context-menu formatting and lint fixes.

IntelliSense uses bundled `.d.wiz` libraries for Bash, coreutils, Wiz, JavaScript runtimes,
network and system tools, databases, cloud CLIs, and developer toolchains, in addition to
declarations from the current workspace.
Literal sourced files are loaded recursively even when they are not open in an
editor tab, and file watching refreshes their symbols after changes.

Install the `wiz` binary on `PATH`, or set `wiz.server.path` to its absolute
path. Commands for project build, check, lint-and-fix, formatting, and
language-server restart are available from the Command Palette. The status-bar
item shows server state and can restart a stopped server; `wiz.server.trace`
enables protocol logs for troubleshooting.

Build and package the self-contained extension with Bun:

```console
bun run --cwd apps/vscode build
bun run --cwd apps/vscode package
```

The package command intentionally excludes dependency traversal because the
language client is already bundled into `dist/extension.js`.
