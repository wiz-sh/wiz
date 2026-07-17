# Wiz CLI

Wiz is the command-line entry point for the Wiz shell language and its multi-source package manager. It runs `.wiz` programs directly, compiles them to supported shells, manages registry, Git, local, and workspace dependencies, and exposes the formatter, linter, language server, and project tooling through one command.

The wider project is split into focused repositories under the [`wiz-sh`](https://github.com/wiz-sh) organization. This repository owns the user-facing CLI, runnable examples, and cross-product integration tests.

## Install

Wiz requires [Bun](https://bun.sh).

```console
bun add --global @wiz-sh/wiz
wiz --version
```

Create a project and run its entry point:

```console
wiz create
cd my-wiz-project
wiz run src/index.wiz
```

## Everyday commands

```console
wiz run src/index.wiz -- argument
wiz watch src/index.wiz
wiz build
wiz check
wiz format --check .
wiz lint .

wiz install
wiz install @scope/package
wiz publish
wiz root
wiz needs curl
```

`wiz c` remains the compiler command group for explicit target and project operations. Run `wiz help` or `wiz <command> --help` for the complete command surface.

## Development

```console
bun install
bun run check
bun run build
bun run example -- list
```

The integration suite under `tests/` exercises the assembled CLI against the published component packages. Examples are selectable through `bun run example` and are intended to remain executable documentation.

## Related repositories

- [Compiler](https://github.com/wiz-sh/compiler)
- [Package manager and runtime](https://github.com/wiz-sh/package-manager)
- [Registry and client](https://github.com/wiz-sh/registry)
- [Formatter and linter](https://github.com/wiz-sh/linter)
- [Language service and LSP](https://github.com/wiz-sh/lsp)
- [Declaration packages](https://github.com/wiz-sh/types)
- [Documentation](https://github.com/wiz-sh/docs)
- [VS Code extension](https://github.com/wiz-sh/vscode-extension)

Wiz is available under the [MIT License](LICENSE).
